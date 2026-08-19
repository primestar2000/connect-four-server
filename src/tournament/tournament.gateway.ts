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

        this.scheduleRoundForfeitTimers(tournament.id, 1);
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

  /** How long players have to turn up to a scheduled tournament game. */
  private static readonly FORFEIT_TIMEOUT = 120000; // 2 minutes

  /**
   * Arms no-show timers for every open game in a round. Called when the tournament
   * starts and again whenever a new round is generated - previously only round one
   * was ever supervised.
   */
  scheduleRoundForfeitTimers(tournamentId: string, round: number): void {
    void this.tournamentService
      .getTournament(tournamentId)
      .then((tournament) => {
        if (!tournament) return;

        const openGames = tournament.games.filter(
          (game) => game.round === round && game.status === 'IN_PROGRESS',
        );

        console.log(`Arming forfeit timers for ${openGames.length} game(s) in round ${round}`);

        openGames.forEach((game) => {
          this.setupGameForfeitTimer(game.id, game.playerOneId, game.playerTwoId, tournamentId);
        });
      })
      .catch((error) => {
        console.error(`Failed to arm forfeit timers for round ${round}:`, error);
      });
  }

  // Set up forfeit timer for a tournament game
  private setupGameForfeitTimer(
    gameId: string,
    playerOneId: string,
    playerTwoId: string,
    tournamentId: string,
  ) {
    this.gameService.setForfeitTimer(
      gameId,
      () => {
        void this.resolveNoShow(gameId, playerOneId, playerTwoId, tournamentId);
      },
      TournamentGateway.FORFEIT_TIMEOUT,
    );
  }

  private async resolveNoShow(
    gameId: string,
    playerOneId: string,
    playerTwoId: string,
    tournamentId: string,
  ): Promise<void> {
    console.log(`Forfeit timer expired for game ${gameId}`);

    // Connection is checked against the players' database ids. The room re-keys a
    // seat to the player's anonymous token once they connect, so comparing against
    // `player.id` here reported everyone as absent.
    const playerOnePresent = this.gameService.isConnectedByDbId(gameId, playerOneId);
    const playerTwoPresent = this.gameService.isConnectedByDbId(gameId, playerTwoId);

    if (playerOnePresent && playerTwoPresent) {
      return; // both here, nothing to forfeit
    }

    const tournamentRoom = `tournament:${tournamentId}`;

    // Nobody turned up: the game is a dead rubber, recorded as a draw so neither
    // absentee advances.
    if (!playerOnePresent && !playerTwoPresent) {
      console.log(`Neither player joined game ${gameId} - recording a double forfeit`);
      await this.tournamentService.completeGame(gameId, null, true);
      this.server.to(tournamentRoom).emit('tournamentUpdated', {
        tournament: await this.tournamentService.getTournament(tournamentId),
      });
      return;
    }

    const absentPlayerId = playerOnePresent ? playerTwoId : playerOneId;
    const result = await this.tournamentService.forfeitTournamentGame(gameId, absentPlayerId);

    if (!result) return;

    this.server.to(gameId).emit('opponentForfeit', {
      message: `${result.loserName} failed to join. ${result.winnerName} wins by forfeit!`,
    });

    this.server.to(tournamentRoom).emit('tournamentUpdated', {
      tournament: await this.tournamentService.getTournament(tournamentId),
    });
  }

  /**
   * Spectators subscribe to a tournament's broadcast room. Without these handlers
   * the spectator view fetched the bracket once and then never updated, because
   * the events it was listening for were only ever sent to this room.
   */
  @SubscribeMessage('joinTournamentRoom')
  handleJoinTournamentRoom(
    @MessageBody() data: { tournamentId: string },
    @ConnectedSocket() client: Socket,
  ): { success: boolean } {
    if (!data?.tournamentId) return { success: false };

    void client.join(`tournament:${data.tournamentId}`);
    return { success: true };
  }

  @SubscribeMessage('leaveTournamentRoom')
  handleLeaveTournamentRoom(
    @MessageBody() data: { tournamentId: string },
    @ConnectedSocket() client: Socket,
  ): { success: boolean } {
    if (!data?.tournamentId) return { success: false };

    void client.leave(`tournament:${data.tournamentId}`);
    return { success: true };
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
