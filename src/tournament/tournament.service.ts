import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentStatus } from '@prisma/client';

interface CreateTournamentDto {
  name: string;
  maxPlayers: number;
  creatorId: string;
  isPrivate?: boolean;
}

interface JoinTournamentDto {
  tournamentId: string;
  playerId: string;
  inviteCode?: string;
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

    // Extract username from creatorId (format: player_username_randomid)
    const username = data.creatorId.split('_')[1] || data.creatorId;

    // Create or get player
    let player = await this.prisma.player.findUnique({
      where: { username },
    });

    if (!player) {
      player = await this.prisma.player.create({
        data: {
          username,
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
        players: true,
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

    // Check if player already joined
    const existingPlayer = tournament.players.find((p) => p.playerId === data.playerId);

    if (existingPlayer) {
      throw new Error('Player already joined this tournament');
    }

    // Create or get player - extract username from playerId
    // Format: player_username_randomid
    const username = data.playerId.split('_')[1] || data.playerId;

    let player = await this.prisma.player.findUnique({
      where: { username },
    });

    if (!player) {
      player = await this.prisma.player.create({
        data: {
          username,
        },
      });
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
        },
        include: {
          playerOne: true,
          playerTwo: true,
        },
      });
      games.push(game);
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

      // Check if round is complete
      await this.checkRoundComplete(game.tournamentId, game.round!);
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
        await this.checkRoundComplete(game.tournamentId, game.round);
      }
    }

    return this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        playerOne: true,
        playerTwo: true,
        tournament: true,
      },
    });
  }

  async checkRoundComplete(tournamentId: string, round: number) {
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

    if (!tournament) return;

    // Check if all games in round are complete
    const allComplete = tournament.games.every((game) => game.status === 'COMPLETED');

    console.log(
      `Tournament ${tournamentId} Round ${round}: ${tournament.games.filter((g) => g.status === 'COMPLETED').length}/${tournament.games.length} games complete`,
    );

    if (!allComplete) return;

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
      return;
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
      return;
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
}
