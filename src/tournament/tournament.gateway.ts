import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TournamentService } from './tournament.service';

interface CreateTournamentPayload {
  name: string;
  maxPlayers: number;
  creatorId: string;
  isPrivate?: boolean;
}

interface JoinTournamentPayload {
  tournamentId: string;
  playerId: string;
  inviteCode?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class TournamentGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly tournamentService: TournamentService) {}

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
}
