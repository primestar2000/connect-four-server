import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TournamentService } from './tournament.service';
import { GameService } from '../game/game.service';
import { Inject, forwardRef } from '@nestjs/common';

interface CreateTournamentPayload {
  name: string;
  maxPlayers: number;
  creatorId: string;
  isPrivate?: boolean;
  avatar?: string;
  avatarType?: string;
}

interface JoinTournamentPayload {
  tournamentId: string;
  playerId: string;
  inviteCode?: string;
  avatar?: string;
  avatarType?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class TournamentGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tournamentService: TournamentService,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
  ) {}

  afterInit() {
    console.log('TournamentGateway initialized with GameService');
  }

  @SubscribeMessage('createTournament')
  async handleCreateTournament(
    @MessageBody() data: CreateTournamentPayload,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const tournament = await this.tournamentService.createTournament(data);

      // Join socket room for tournament updates
      client.join(`tournament:${tournament.id}`);

      return {
        success: true,
        tournament,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create tournament',
      };
    }
  }

  @SubscribeMessage('joinTournament')
  async handleJoinTournament(
    @MessageBody() data: JoinTournamentPayload,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const tournament = await this.tournamentService.joinTournament(data);

      // Join socket room for tournament updates
      client.join(`tournament:${tournament.id}`);

      // Notify all players in tournament
      this.server.to(`tournament:${tournament.id}`).emit('tournamentUpdated', {
        tournament,
      });

      return {
        success: true,
        tournament,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to join tournament',
      };
    }
  }

  @SubscribeMessage('startTournament')
  async handleStartTournament(@MessageBody() data: { tournamentId: string }) {
    try {
      const tournament = await this.tournamentService.startTournament(data.tournamentId);

      if (tournament) {
        // Notify all players
        this.server.to(`tournament:${tournament.id}`).emit('tournamentStarted', {
          tournament,
        });

        // Set up forfeit timers for all games in the first round
        if (tournament.games && tournament.games.length > 0) {
          tournament.games.forEach((game) => {
            if (game.round === 1 && game.status === 'IN_PROGRESS') {
              this.setupGameForfeitTimer(
                game.id,
                game.playerOneId,
                game.playerTwoId,
                tournament.id,
              );
            }
          });
        }
      }

      return {
        success: true,
        tournament,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start tournament',
      };
    }
  }

  // Set up forfeit timer for a tournament game
  private setupGameForfeitTimer(
    gameId: string,
    playerOneId: string,
    playerTwoId: string,
    tournamentId: string,
  ) {
    if (!this.gameService) {
      console.error('GameService not available for forfeit timer');
      return;
    }

    const FORFEIT_TIMEOUT = 120000; // 2 minutes

    this.gameService.setForfeitTimer(
      gameId,
      async () => {
        console.log(`Forfeit timer expired for game ${gameId}`);

        // Check if both players have joined
        const room = this.gameService.getRoom(gameId);

        if (!room) {
          console.log(`Room ${gameId} not found, checking database...`);

          // Game room doesn't exist - neither player joined
          // Forfeit both players
          await this.tournamentService.forfeitTournamentGame(gameId, playerOneId);
          await this.tournamentService.forfeitTournamentGame(gameId, playerTwoId);

          this.server.to(`tournament:${tournamentId}`).emit('tournamentUpdated', {
            tournamentId,
            message: 'Game forfeited - neither player joined',
          });

          return;
        }

        // Check which players are connected
        const player1Connected = room.players.some(
          (p) => p.id === playerOneId && p.socketId !== '',
        );
        const player2Connected = room.players.some(
          (p) => p.id === playerTwoId && p.socketId !== '',
        );

        if (!player1Connected && !player2Connected) {
          // Neither player joined - both forfeit (draw/elimination)
          console.log(`Neither player joined game ${gameId} - both forfeit`);
          await this.tournamentService.forfeitTournamentGame(gameId, playerOneId);

          this.server.to(`tournament:${tournamentId}`).emit('tournamentUpdated', {
            tournamentId,
            message: 'Game forfeited - neither player joined',
          });
        } else if (!player1Connected) {
          // Player 1 didn't join - player 2 wins
          console.log(`Player 1 didn't join game ${gameId} - Player 2 wins by forfeit`);
          const result = await this.tournamentService.forfeitTournamentGame(gameId, playerOneId);

          if (result) {
            this.server.to(gameId).emit('opponentForfeit', {
              message: `${result.loserName} failed to join. ${result.winnerName} wins by forfeit!`,
            });

            this.server.to(`tournament:${tournamentId}`).emit('tournamentUpdated', {
              tournamentId,
            });
          }
        } else if (!player2Connected) {
          // Player 2 didn't join - player 1 wins
          console.log(`Player 2 didn't join game ${gameId} - Player 1 wins by forfeit`);
          const result = await this.tournamentService.forfeitTournamentGame(gameId, playerTwoId);

          if (result) {
            this.server.to(gameId).emit('opponentForfeit', {
              message: `${result.loserName} failed to join. ${result.winnerName} wins by forfeit!`,
            });

            this.server.to(`tournament:${tournamentId}`).emit('tournamentUpdated', {
              tournamentId,
            });
          }
        }
        // If both players joined, timer is cleared automatically
      },
      FORFEIT_TIMEOUT,
    );
  }

  @SubscribeMessage('getTournament')
  async handleGetTournament(@MessageBody() data: { tournamentId: string }) {
    try {
      const tournament = await this.tournamentService.getTournament(data.tournamentId);

      if (!tournament) {
        return {
          success: false,
          error: 'Tournament not found',
        };
      }

      return {
        success: true,
        tournament,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get tournament',
      };
    }
  }

  @SubscribeMessage('listTournaments')
  async handleListTournaments() {
    try {
      const tournaments = await this.tournamentService.listTournaments();

      return {
        success: true,
        tournaments,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list tournaments',
      };
    }
  }

  @SubscribeMessage('getTournamentByInviteCode')
  async handleGetTournamentByInviteCode(@MessageBody() data: { inviteCode: string }) {
    try {
      const tournament = await this.tournamentService.getTournamentByInviteCode(data.inviteCode);

      if (!tournament) {
        return {
          success: false,
          error: 'Tournament not found',
        };
      }

      return {
        success: true,
        tournament,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get tournament',
      };
    }
  }

  // Notify tournament participants of game completion
  async notifyGameComplete(tournamentId: string, gameId: string) {
    const tournament = await this.tournamentService.getTournament(tournamentId);

    if (tournament) {
      this.server.to(`tournament:${tournamentId}`).emit('gameCompleted', {
        tournament,
        gameId,
      });
    }
  }

  // Notify tournament participants of round completion
  async notifyRoundComplete(tournamentId: string, round: number) {
    const tournament = await this.tournamentService.getTournament(tournamentId);

    if (tournament) {
      this.server.to(`tournament:${tournamentId}`).emit('roundCompleted', {
        tournament,
        round,
      });

      // Set up forfeit timers for new round games
      if (tournament.games && tournament.games.length > 0) {
        const nextRound = round + 1;
        const newRoundGames = tournament.games.filter(
          (game) => game.round === nextRound && game.status === 'IN_PROGRESS',
        );

        console.log(
          `Setting up forfeit timers for ${newRoundGames.length} games in round ${nextRound}`,
        );

        newRoundGames.forEach((game) => {
          this.setupGameForfeitTimer(game.id, game.playerOneId, game.playerTwoId, tournamentId);
        });
      }
    }
  }

  // Notify tournament completion
  async notifyTournamentComplete(tournamentId: string) {
    const tournament = await this.tournamentService.getTournament(tournamentId);

    if (tournament) {
      this.server.to(`tournament:${tournamentId}`).emit('tournamentCompleted', {
        tournament,
      });
    }
  }

  @SubscribeMessage('leaveTournament')
  async handleLeaveTournament(
    @MessageBody() data: { tournamentId: string; playerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const result = await this.tournamentService.leaveTournament(data.tournamentId, data.playerId);

      // Leave socket room
      client.leave(`tournament:${data.tournamentId}`);

      if (result.deleted) {
        // Tournament was deleted (no players left)
        this.server.emit('tournamentDeleted', {
          tournamentId: data.tournamentId,
        });

        return {
          success: true,
          deleted: true,
          message: 'Tournament deleted (no players remaining)',
        };
      }

      // Notify remaining players
      this.server.to(`tournament:${data.tournamentId}`).emit('tournamentUpdated', {
        tournament: result.tournament,
      });

      return {
        success: true,
        deleted: false,
        tournament: result.tournament,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to leave tournament',
      };
    }
  }

  @SubscribeMessage('deleteTournament')
  async handleDeleteTournament(@MessageBody() data: { tournamentId: string; requesterId: string }) {
    try {
      const result = await this.tournamentService.deleteTournament(
        data.tournamentId,
        data.requesterId,
      );

      // Notify all players in tournament
      this.server.to(`tournament:${data.tournamentId}`).emit('tournamentDeleted', {
        tournamentId: data.tournamentId,
        message: 'Tournament has been deleted by the creator',
      });

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete tournament',
      };
    }
  }

  @SubscribeMessage('getPlayerActiveTournament')
  async handleGetPlayerActiveTournament(
    @MessageBody() data: { playerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const tournament = await this.tournamentService.getPlayerActiveTournament(data.playerId);

      if (!tournament) {
        return {
          success: false,
          error: 'No active tournament found',
        };
      }

      // Rejoin socket room for tournament updates
      client.join(`tournament:${tournament.id}`);

      return {
        success: true,
        tournament,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get active tournament',
      };
    }
  }
}
