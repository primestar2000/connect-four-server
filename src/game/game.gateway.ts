import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { TournamentService } from '../tournament/tournament.service';
import { TournamentGateway } from '../tournament/tournament.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRoomResponse,
  JoinRoomResponse,
  MakeMovePayload,
  MoveResult,
  GameState,
  MOVE_TIMEOUT,
  PlayerRole,
} from '../types/game.types';

/** How long a player has to reconnect before they forfeit the game. */
const RECONNECT_GRACE_MS = 30000;
/** How long an entirely empty room is kept alive so players can come back to it. */
const EMPTY_ROOM_GRACE_MS = 600000;
/** How long the finished-game state lingers before the room is reclaimed. */
const FINISHED_ROOM_LINGER_MS = 5000;

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);

  /**
   * The per-room interval that streams the countdown to clients. Tracked so that
   * starting a new turn replaces the previous interval instead of stacking another
   * one on top of it - unbounded stacking is what made the timer jitter and fire
   * its warnings repeatedly as a game went on.
   */
  private readonly timerBroadcasts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly gameService: GameService,
    @Inject(forwardRef(() => TournamentService))
    private readonly tournamentService: TournamentService,
    @Inject(forwardRef(() => TournamentGateway))
    private readonly tournamentGateway: TournamentGateway,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);

    const result = this.gameService.removePlayerFromRoom(client.id);
    if (!result) return;

    const { roomId, remainingPlayers } = result;

    this.server.to(roomId).emit('playerDisconnected', {
      message: 'Opponent disconnected',
      remainingPlayers,
    });

    // Nobody is on the clock while a player is away.
    this.stopTimerBroadcast(roomId);
    this.gameService.clearMoveTimer(roomId);

    if (remainingPlayers === 1) {
      this.scheduleReconnectForfeit(roomId);
    } else if (remainingPlayers === 0) {
      this.scheduleEmptyRoomCleanup(roomId);
    }
  }

  /** Award the game to whoever is still here if the other player never comes back. */
  private scheduleReconnectForfeit(roomId: string): void {
    this.logger.log(`Starting ${RECONNECT_GRACE_MS / 1000}s reconnect window for room ${roomId}`);

    setTimeout(() => {
      void this.resolveReconnectForfeit(roomId);
    }, RECONNECT_GRACE_MS);
  }

  private async resolveReconnectForfeit(roomId: string): Promise<void> {
    const room = this.gameService.getRoom(roomId);
    if (!room) return;

    // The check is on live sockets, not on the size of the players array. Seats are
    // never removed on disconnect, so counting seats here would mean this forfeit
    // never actually triggered.
    const connected = room.players.filter((p) => p.socketId !== '');
    if (connected.length !== 1 || room.winner || room.isDraw) return;

    const remainingPlayer = connected[0];
    this.logger.log(`Opponent did not reconnect - awarding room ${roomId} to ${remainingPlayer.username}`);

    this.gameService.endGame(roomId, remainingPlayer.role);

    this.server.to(roomId).emit('opponentForfeit', {
      message: 'Opponent failed to reconnect. You win!',
      winner: remainingPlayer.role,
    });

    if (remainingPlayer.dbId) {
      await this.completeTournamentGame(roomId, remainingPlayer.dbId, false);
    }

    setTimeout(() => this.gameService.removeRoom(roomId), FINISHED_ROOM_LINGER_MS);
  }

  /** Reclaim a room only if it is still empty when the grace period expires. */
  private scheduleEmptyRoomCleanup(roomId: string): void {
    this.logger.log(`Room ${roomId} is empty - reclaiming in ${EMPTY_ROOM_GRACE_MS / 60000} minutes`);

    setTimeout(() => {
      void this.reclaimEmptyRoom(roomId);
    }, EMPTY_ROOM_GRACE_MS);
  }

  private async reclaimEmptyRoom(roomId: string): Promise<void> {
    const room = this.gameService.getRoom(roomId);
    if (!room) return;

    if (this.gameService.connectedCount(roomId) > 0) {
      this.logger.log(`Room ${roomId} has players again - keeping it`);
      return;
    }

    if (room.tournamentId && !room.winner && !room.isDraw) {
      this.logger.log(`Both players abandoned tournament game ${roomId}`);
      await this.completeTournamentGame(roomId, null, true);
    }

    this.stopTimerBroadcast(roomId);
    this.gameService.removeRoom(roomId);
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  @SubscribeMessage('createRoom')
  async handleCreateRoom(
    @MessageBody() data: { playerId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<CreateRoomResponse | { error: string }> {
    if (!data?.playerId) {
      return { error: 'Missing player id. Please create a profile first.' };
    }

    try {
      const room = await this.gameService.createRoom(data.playerId, client.id);
      await client.join(room.id);

      return {
        roomId: room.id,
        playerId: data.playerId,
        playerRole: 'one',
      };
    } catch (error: unknown) {
      this.logger.error('Error creating room', error as Error);
      return { error: error instanceof Error ? error.message : 'Failed to create room' };
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; playerId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<JoinRoomResponse | { error: string }> {
    if (!data?.playerId) {
      return { error: 'Missing player id. Please create a profile first.' };
    }
    if (!data.roomId) {
      return { error: 'Missing room code' };
    }

    let room;
    try {
      room = await this.gameService.joinRoom(data.roomId, data.playerId, client.id);
    } catch (error: unknown) {
      this.logger.error(`Error joining room ${data.roomId}`, error as Error);
      return { error: error instanceof Error ? error.message : 'Failed to join room' };
    }

    if (!room) {
      return { error: 'Room not found or full' };
    }

    await client.join(room.id);

    const seat = room.players.find((p) => p.socketId === client.id);
    if (!seat) {
      return { error: 'Failed to take a seat in this game' };
    }

    const gameState = this.gameService.getGameState(room.id);
    if (!gameState) {
      return { error: 'Failed to get game state' };
    }

    client.to(room.id).emit('opponentJoined', {
      message: 'Opponent joined the game',
      gameState,
    });

    const connectedPlayers = this.gameService.connectedCount(room.id);

    // Only stand down the "did anyone turn up?" timer once both players are here.
    // Clearing it when the first player arrives is what stopped no-shows ever
    // being forfeited.
    if (connectedPlayers === 2) {
      this.gameService.clearForfeitTimer(room.id);

      if (room.moveTimeoutSeconds && !room.winner && !room.isDraw) {
        this.startMoveTimerForRoom(room.id, room.moveTimeoutSeconds);
      }
    }

    return {
      roomId: room.id,
      playerId: data.playerId,
      // Take the role from the seat the player actually occupies rather than
      // inferring it from array position.
      playerRole: seat.role,
      gameState,
    };
  }

  @SubscribeMessage('makeMove')
  async handleMakeMove(@MessageBody() data: MakeMovePayload): Promise<MoveResult> {
    const result = this.gameService.makeMove(data.roomId, data.playerId, data.columnIndex);

    if (!result.success) return result;

    this.server.to(data.roomId).emit('moveMade', {
      board: result.board,
      currentTurn: result.currentTurn,
      winner: result.winner,
      winningLine: result.winningLine,
      isDraw: result.isDraw,
      columnIndex: result.columnIndex,
      rowIndex: result.rowIndex,
    });

    await this.gameService.persistBoard(data.roomId);

    const gameOver = Boolean(result.winner) || result.isDraw;

    if (!gameOver) {
      const room = this.gameService.getRoom(data.roomId);
      if (room?.moveTimeoutSeconds) {
        this.startMoveTimerForRoom(data.roomId, room.moveTimeoutSeconds);
      }
      return result;
    }

    this.stopTimerBroadcast(data.roomId);
    this.logger.log(`Game ${data.roomId} ended. Winner: ${result.winner}, draw: ${result.isDraw}`);

    const room = this.gameService.getRoom(data.roomId);
    const winnerDbId = result.winner
      ? (room?.players.find((p) => p.role === result.winner)?.dbId ?? null)
      : null;

    await this.completeTournamentGame(data.roomId, winnerDbId, result.isDraw);

    return result;
  }

  @SubscribeMessage('resetGame')
  handleResetGame(@MessageBody() data: { roomId: string }): { success: boolean } {
    this.stopTimerBroadcast(data.roomId);

    const success = this.gameService.resetGame(data.roomId);

    if (success) {
      this.server.to(data.roomId).emit('gameReset', this.gameService.getGameState(data.roomId));

      const room = this.gameService.getRoom(data.roomId);
      if (room?.moveTimeoutSeconds && this.gameService.connectedCount(data.roomId) === 2) {
        this.startMoveTimerForRoom(data.roomId, room.moveTimeoutSeconds);
      }
    }

    return { success };
  }

  @SubscribeMessage('getGameState')
  handleGetGameState(@MessageBody() data: { roomId: string }): GameState | { error: string } {
    return this.gameService.getGameState(data.roomId) ?? { error: 'Room not found' };
  }

  // ---------------------------------------------------------------------------
  // Tournament plumbing
  // ---------------------------------------------------------------------------

  /**
   * Records a finished game against its tournament and broadcasts the fallout.
   * Safe to call for casual games (it no-ops) and safe to call twice for the same
   * game - completeGame itself is idempotent.
   */
  private async completeTournamentGame(
    gameId: string,
    winnerDbId: string | null,
    isDraw: boolean,
  ): Promise<void> {
    try {
      const dbGame = await this.prisma.game.findUnique({ where: { id: gameId } });
      if (!dbGame?.tournamentId) return;

      const { roundResult, alreadyCompleted } = await this.tournamentService.completeGame(
        gameId,
        winnerDbId,
        isDraw,
      );

      if (alreadyCompleted) {
        this.logger.log(`Game ${gameId} was already completed - skipping broadcast`);
        return;
      }

      const tournament = await this.tournamentService.getTournament(dbGame.tournamentId);
      if (!tournament) return;

      const tournamentRoom = `tournament:${dbGame.tournamentId}`;

      this.server.to(tournamentRoom).emit('tournamentUpdated', { tournament });
      this.server.to(tournamentRoom).emit('gameCompleted', { tournament, gameId });

      if (roundResult.roundComplete && !roundResult.tournamentComplete) {
        this.server.to(tournamentRoom).emit('roundCompleted', {
          tournament,
          round: dbGame.round,
        });

        if (roundResult.nextRound) {
          // Games created for the new round need their own no-show timers; without
          // this only round one was ever supervised.
          this.tournamentGateway.scheduleRoundForfeitTimers(
            dbGame.tournamentId,
            roundResult.nextRound,
          );
        }
      }

      if (roundResult.tournamentComplete) {
        this.server.to(tournamentRoom).emit('tournamentCompleted', { tournament });
      }
    } catch (error) {
      this.logger.error(`Error completing tournament game ${gameId}`, error as Error);
    }
  }

  // ---------------------------------------------------------------------------
  // Move timer
  // ---------------------------------------------------------------------------

  private startMoveTimerForRoom(roomId: string, timeoutSeconds: number): void {
    this.gameService.startMoveTimer(roomId, timeoutSeconds, () => {
      void this.handleMoveTimeout(roomId);
    });

    this.server.to(roomId).emit('moveTimerStarted', { timeoutSeconds });
    this.startTimerBroadcast(roomId);
  }

  private startTimerBroadcast(roomId: string): void {
    this.stopTimerBroadcast(roomId);

    let lastWarned: number | null = null;

    const interval = setInterval(() => {
      const remaining = this.gameService.getRemainingTime(roomId);

      if (remaining === null) {
        this.stopTimerBroadcast(roomId);
        return;
      }

      this.server.to(roomId).emit('moveTimerUpdate', { timeRemaining: remaining });

      if (remaining !== lastWarned) {
        if (remaining === MOVE_TIMEOUT.WARNING_THRESHOLD) {
          this.server.to(roomId).emit('moveTimerWarning', {
            timeRemaining: remaining,
            level: 'warning',
          });
          lastWarned = remaining;
        } else if (remaining === MOVE_TIMEOUT.CRITICAL_THRESHOLD) {
          this.server.to(roomId).emit('moveTimerWarning', {
            timeRemaining: remaining,
            level: 'critical',
          });
          lastWarned = remaining;
        }
      }

      if (remaining <= 0) {
        this.stopTimerBroadcast(roomId);
      }
    }, 1000);

    this.timerBroadcasts.set(roomId, interval);
  }

  private stopTimerBroadcast(roomId: string): void {
    const interval = this.timerBroadcasts.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.timerBroadcasts.delete(roomId);
    }
  }

  /** The player on the clock ran out of time; their opponent takes the game. */
  private async handleMoveTimeout(roomId: string): Promise<void> {
    const room = this.gameService.getRoom(roomId);
    if (!room || room.winner || room.isDraw) return;

    this.stopTimerBroadcast(roomId);

    const winnerRole: PlayerRole = room.currentTurn === 'one' ? 'two' : 'one';
    const winner = room.players.find((p) => p.role === winnerRole);
    if (!winner) return;

    this.logger.log(`Move timeout in room ${roomId} - ${winner.username} wins`);

    // Record the result before announcing it, so a late click cannot land a move
    // on a game the server has already called.
    this.gameService.endGame(roomId, winnerRole);

    this.server.to(roomId).emit('moveTimeout', {
      message: 'Time expired! Game forfeited.',
      winner: winnerRole,
    });

    if (winner.dbId) {
      await this.completeTournamentGame(roomId, winner.dbId, false);
    }

    setTimeout(() => this.gameService.removeRoom(roomId), FINISHED_ROOM_LINGER_MS);
  }
}
