import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentStatus } from '@prisma/client';

interface CreateTournamentDto {
  name: string;
  maxPlayers: number;
  creatorId: string;
  isPrivate?: boolean;
  avatar?: string;
  avatarType?: string;
}

interface JoinTournamentDto {
  tournamentId: string;
  playerId: string;
  inviteCode?: string;
  avatar?: string;
  avatarType?: string;
}

@Injectable()
export class TournamentService {
  constructor(private readonly prisma: PrismaService) {}

  async createTournament(data: CreateTournamentDto) {
    // Validate max players (must be power of 2 for single elimination)
    if (!this.isPowerOfTwo(data.maxPlayers)) {
      throw new Error('Max players must be a power of 2 (2, 4, 8, 16, 32, 64)');
    }

    // Generate invite code for private tournaments
    const inviteCode = data.isPrivate ? this.generateInviteCode() : null;

    // Get player by token (creatorId is now the token)
    let player = await this.prisma.player.findUnique({
      where: { token: data.creatorId },
    });

    if (!player) {
      throw new Error('Player not found. Please create a profile first.');
    }

    // Update avatar if provided
    if (data.avatar) {
      player = await this.prisma.player.update({
        where: { id: player.id },
        data: {
          avatar: data.avatar,
          avatarType: data.avatarType || 'emoji',
        },
      });
    }

    // Create tournament and automatically add creator as first player
    const tournament = await this.prisma.tournament.create({
      data: {
        name: data.name,
        maxPlayers: data.maxPlayers,
        status: TournamentStatus.PENDING,
        creatorId: data.creatorId,
        isPrivate: data.isPrivate || false,
        inviteCode,
        players: {
          create: {
            playerId: player.id,
            seed: 1,
          },
        },
      },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
    });

    return tournament;
  }

  async getTournament(tournamentId: string) {
    return this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        players: {
          include: {
            player: true,
          },
          orderBy: {
            seed: 'asc',
          },
        },
        games: {
          include: {
            playerOne: true,
            playerTwo: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  async joinTournament(data: JoinTournamentDto) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: data.tournamentId },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
    });

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Check invite code for private tournaments
    if (tournament.isPrivate && tournament.inviteCode !== data.inviteCode) {
      throw new Error('Invalid invite code');
    }

    if (tournament.status !== TournamentStatus.PENDING) {
      throw new Error('Tournament has already started');
    }

    if (tournament.players.length >= tournament.maxPlayers) {
      throw new Error('Tournament is full');
    }

    // Get player by token (playerId is now the token)
    let player = await this.prisma.player.findUnique({
      where: { token: data.playerId },
    });

    if (!player) {
      throw new Error('Player not found. Please create a profile first.');
    }

    // Update avatar if provided
    if (data.avatar) {
      // Update avatar if provided
      player = await this.prisma.player.update({
        where: { id: player.id },
        data: {
          avatar: data.avatar,
          avatarType: data.avatarType || 'emoji',
        },
      });
    }

    // Check if player already joined using database player ID
    const existingPlayer = tournament.players.find((p) => p.playerId === player.id);

    if (existingPlayer) {
      // Player already in tournament - return current state
      console.log(`Player ${player.username} already in tournament ${data.tournamentId}`);
      return tournament;
    }

    // Add player to tournament using the database player ID
    const tournamentPlayer = await this.prisma.tournamentPlayer.create({
      data: {
        tournamentId: data.tournamentId,
        playerId: player.id, // Use the database player ID
        seed: tournament.players.length + 1,
      },
      include: {
        player: true,
        tournament: {
          include: {
            players: {
              include: {
                player: true,
              },
            },
          },
        },
      },
    });

    return tournamentPlayer.tournament;
  }

  async startTournament(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
    });

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    if (tournament.status !== TournamentStatus.PENDING) {
      throw new Error('Tournament has already started');
    }

    if (tournament.players.length < 2) {
      throw new Error('Need at least 2 players to start tournament');
    }

    // Randomize seeds
    const shuffledPlayers = this.shuffleArray([...tournament.players]);

    // Update seeds
    await Promise.all(
      shuffledPlayers.map((player, index) =>
        this.prisma.tournamentPlayer.update({
          where: { id: player.id },
          data: { seed: index + 1 },
        }),
      ),
    );

    // Update tournament status
    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: TournamentStatus.IN_PROGRESS,
        startedAt: new Date(),
        currentRound: 1,
      },
    });

    // Generate first round matchups
    await this.generateRoundMatchups(tournamentId, 1);

    return this.getTournament(tournamentId);
  }

  async generateRoundMatchups(tournamentId: string, round: number) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        players: {
          where: {
            isEliminated: false,
          },
          include: {
            player: true,
          },
          orderBy: {
            seed: 'asc',
          },
        },
      },
    });

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    const activePlayers = tournament.players;

    // Handle byes if odd number of players
    if (activePlayers.length % 2 !== 0) {
      // Give bye to the first player (lowest seed)
      await this.prisma.tournamentPlayer.update({
        where: { id: activePlayers[0].id },
        data: { hasBye: true },
      });

      // Remove them from matchups
      activePlayers.shift();
    }

    // Create games for pairs
    const games = [];
    for (let i = 0; i < activePlayers.length; i += 2) {
      const game = await this.prisma.game.create({
        data: {
          tournamentId,
          playerOneId: activePlayers[i].playerId,
          playerTwoId: activePlayers[i + 1].playerId,
          round,
          status: 'IN_PROGRESS',
        },
        include: {
          playerOne: true,
          playerTwo: true,
        },
      });
      games.push(game);
      
      console.log(`Created tournament game ${game.id} for round ${round}: ${game.playerOne.username} vs ${game.playerTwo.username}`);
    }

    return games;
  }

  async completeGame(gameId: string, winnerId: string | null, isDraw: boolean) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        tournament: {
          include: {
            players: true,
            games: {
              where: {
                round: {
                  not: null,
                },
              },
            },
          },
        },
      },
    });

    if (!game) {
      throw new Error('Game not found');
    }

    // Update game
    await this.prisma.game.update({
      where: { id: gameId },
      data: {
        winnerId,
        isDraw,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // If tournament game, handle elimination
    if (game.tournamentId && !isDraw && winnerId) {
      const loserId = winnerId === game.playerOneId ? game.playerTwoId : game.playerOneId;

      // Eliminate loser
      await this.prisma.tournamentPlayer.updateMany({
        where: {
          tournamentId: game.tournamentId,
          playerId: loserId,
        },
        data: {
          isEliminated: true,
        },
      });

      console.log(
        `Tournament ${game.tournamentId}: Player ${loserId} eliminated, Player ${winnerId} advances`,
      );

      // Check if round is complete and return the result
      const roundResult = await this.checkRoundComplete(game.tournamentId, game.round!);
      
      return {
        game: await this.prisma.game.findUnique({
          where: { id: gameId },
          include: {
            playerOne: true,
            playerTwo: true,
            tournament: true,
          },
        }),
        roundResult,
      };
    } else if (game.tournamentId && isDraw) {
      // Handle draw - eliminate both players or schedule rematch
      console.log(`Tournament game ${gameId} ended in draw - both players eliminated`);

      await this.prisma.tournamentPlayer.updateMany({
        where: {
          tournamentId: game.tournamentId,
          playerId: {
            in: [game.playerOneId, game.playerTwoId],
          },
        },
        data: {
          isEliminated: true,
        },
      });

      // Check if round is complete
      if (game.round) {
        const roundResult = await this.checkRoundComplete(game.tournamentId, game.round);
        
        return {
          game: await this.prisma.game.findUnique({
            where: { id: gameId },
            include: {
              playerOne: true,
              playerTwo: true,
              tournament: true,
            },
          }),
          roundResult,
        };
      }
    }

    return {
      game: await this.prisma.game.findUnique({
        where: { id: gameId },
        include: {
          playerOne: true,
          playerTwo: true,
          tournament: true,
        },
      }),
      roundResult: { roundComplete: false, tournamentComplete: false },
    };
  }

  async checkRoundComplete(tournamentId: string, round: number): Promise<{ roundComplete: boolean; tournamentComplete: boolean; nextRound?: number }> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        games: {
          where: {
            round,
          },
        },
        players: {
          where: {
            isEliminated: false,
          },
        },
      },
    });

    if (!tournament) return { roundComplete: false, tournamentComplete: false };

    // Check if all games in round are complete
    const allComplete = tournament.games.every((game) => game.status === 'COMPLETED');

    console.log(
      `Tournament ${tournamentId} Round ${round}: ${tournament.games.filter((g) => g.status === 'COMPLETED').length}/${tournament.games.length} games complete`,
    );

    if (!allComplete) return { roundComplete: false, tournamentComplete: false };

    console.log(`Tournament ${tournamentId} Round ${round} complete!`);

    // Count active players (including those with byes)
    const activePlayers = tournament.players.length;

    console.log(`Active players remaining: ${activePlayers}`);

    // If only 1 player left, tournament is complete
    if (activePlayers === 1) {
      console.log(`Tournament ${tournamentId} complete! Winner: ${tournament.players[0].playerId}`);

      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.COMPLETED,
          completedAt: new Date(),
          winnerId: tournament.players[0].playerId,
        },
      });
      return { roundComplete: true, tournamentComplete: true };
    }

    // If no players left (all eliminated in draws), mark as completed with no winner
    if (activePlayers === 0) {
      console.log(`Tournament ${tournamentId} complete with no winner (all eliminated)`);

      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
      return { roundComplete: true, tournamentComplete: true };
    }

    // Start next round
    const nextRound = round + 1;
    console.log(`Starting round ${nextRound} for tournament ${tournamentId}`);

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        currentRound: nextRound,
      },
    });

    // Reset bye flags
    await this.prisma.tournamentPlayer.updateMany({
      where: {
        tournamentId,
        hasBye: true,
      },
      data: {
        hasBye: false,
      },
    });

    // Generate next round matchups
    const newGames = await this.generateRoundMatchups(tournamentId, nextRound);
    console.log(`Generated ${newGames.length} games for round ${nextRound}`);
    
    return { roundComplete: true, tournamentComplete: false, nextRound };
  }

  async listTournaments() {
    return this.prisma.tournament.findMany({
      where: {
        isPrivate: false, // Only show public tournaments
      },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getTournamentByInviteCode(inviteCode: string) {
    return this.prisma.tournament.findUnique({
      where: { inviteCode },
      include: {
        players: {
          include: {
            player: true,
          },
          orderBy: {
            seed: 'asc',
          },
        },
        games: {
          include: {
            playerOne: true,
            playerTwo: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  private generateInviteCode(): string {
    // Generate a 6-character alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude similar looking chars
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Cleanup methods for empty tournaments
  async leaveTournament(tournamentId: string, playerId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        players: true,
      },
    });

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    if (tournament.status !== TournamentStatus.PENDING) {
      throw new Error('Cannot leave tournament that has already started');
    }

    // Remove player from tournament
    await this.prisma.tournamentPlayer.deleteMany({
      where: {
        tournamentId,
        playerId,
      },
    });

    // Check if tournament is now empty
    const remainingPlayers = await this.prisma.tournamentPlayer.count({
      where: { tournamentId },
    });

    // If no players left, delete the tournament
    if (remainingPlayers === 0) {
      console.log(`Deleting empty tournament ${tournamentId}`);
      await this.prisma.tournament.delete({
        where: { id: tournamentId },
      });
      return { deleted: true, tournament: null };
    }

    // Return updated tournament
    const updatedTournament = await this.getTournament(tournamentId);
    return { deleted: false, tournament: updatedTournament };
  }

  async deleteTournament(tournamentId: string, requesterId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Only creator can delete tournament
    if (tournament.creatorId !== requesterId) {
      throw new Error('Only tournament creator can delete the tournament');
    }

    // Can only delete pending tournaments
    if (tournament.status !== TournamentStatus.PENDING) {
      throw new Error('Cannot delete tournament that has already started');
    }

    await this.prisma.tournament.delete({
      where: { id: tournamentId },
    });

    return { success: true, message: 'Tournament deleted successfully' };
  }

  // Cleanup stale tournaments (can be called by a cron job)
  async cleanupStaleTournaments() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Delete pending tournaments with no players that are older than 1 day
    const emptyTournaments = await this.prisma.tournament.findMany({
      where: {
        status: TournamentStatus.PENDING,
        createdAt: {
          lt: oneDayAgo,
        },
        players: {
          none: {},
        },
      },
    });

    if (emptyTournaments.length > 0) {
      await this.prisma.tournament.deleteMany({
        where: {
          id: {
            in: emptyTournaments.map((t) => t.id),
          },
        },
      });

      console.log(`Cleaned up ${emptyTournaments.length} stale tournaments`);
    }

    return {
      cleaned: emptyTournaments.length,
      tournaments: emptyTournaments,
    };
  }

  // Get player's active tournament (not eliminated and tournament not completed)
  async getPlayerActiveTournament(playerId: string) {
    // Get player by token
    const player = await this.prisma.player.findUnique({
      where: { token: playerId },
    });

    if (!player) {
      throw new Error('Player not found');
    }

    // Find active tournament where player is not eliminated
    const tournamentPlayer = await this.prisma.tournamentPlayer.findFirst({
      where: {
        playerId: player.id,
        isEliminated: false,
        tournament: {
          status: {
            in: [TournamentStatus.PENDING, TournamentStatus.IN_PROGRESS],
          },
        },
      },
      include: {
        tournament: {
          include: {
            players: {
              include: {
                player: true,
              },
              orderBy: {
                seed: 'asc',
              },
            },
            games: {
              include: {
                playerOne: true,
                playerTwo: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
      orderBy: {
        tournament: {
          createdAt: 'desc',
        },
      },
    });

    if (!tournamentPlayer) {
      return null;
    }

    return tournamentPlayer.tournament;
  }

  // Handle forfeit when player doesn't join tournament game in time
  async forfeitTournamentGame(gameId: string, absentPlayerId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        tournament: true,
        playerOne: true,
        playerTwo: true,
      },
    });

    if (!game || !game.tournamentId) {
      console.error(`Game ${gameId} not found or not a tournament game`);
      return null;
    }

    if (game.status === 'COMPLETED') {
      console.log(`Game ${gameId} already completed`);
      return null;
    }

    // Determine winner (the player who is NOT absent)
    const winnerId = absentPlayerId === game.playerOneId ? game.playerTwoId : game.playerOneId;
    const winnerName = winnerId === game.playerOneId ? game.playerOne.username : game.playerTwo.username;
    const loserName = absentPlayerId === game.playerOneId ? game.playerOne.username : game.playerTwo.username;

    console.log(`Tournament game ${gameId} forfeit: ${loserName} failed to join, ${winnerName} wins by forfeit`);

    // Complete the game with forfeit
    await this.completeGame(gameId, winnerId, false);

    return {
      gameId,
      winnerId,
      loserId: absentPlayerId,
      winnerName,
      loserName,
      tournamentId: game.tournamentId,
    };
  }
}
