import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { MatchmakingService } from './matchmaking.service';
import { GameService } from '../game/game.service';
import { PrismaService } from '../prisma/prisma.service';

interface FindMatchResponse {
  status: 'searching' | 'error';
  queueSize?: number;
  error?: string;
}

const TICK_MS = 500;

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MatchmakingGateway implements OnModuleInit, OnModuleDestroy, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MatchmakingGateway.name);
  private tickHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly gameService: GameService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.tickHandle = setInterval(() => {
      void this.processMatchmaking();
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  handleDisconnect(client: Socket): void {
    // Leaving the page has to take you out of the queue, otherwise the next player
    // to search gets paired with somebody who is no longer there.
    this.matchmakingService.removeFromQueue(client.id);
  }

  @SubscribeMessage('findMatch')
  async handleFindMatch(
    @MessageBody() data: { playerId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<FindMatchResponse> {
    // The player's real token has to be used here. Inventing one meant every
    // subsequent database lookup missed and the match was silently abandoned.
    const playerId = data?.playerId;

    if (!playerId) {
      return { status: 'error', error: 'Missing player id. Please create a profile first.' };
    }

    const player = await this.prisma.player.findUnique({ where: { token: playerId } });
    if (!player) {
      return { status: 'error', error: 'Player not found. Please create a profile first.' };
    }

    this.matchmakingService.addToQueue(client.id, playerId);

    return {
      status: 'searching',
      queueSize: this.matchmakingService.getQueueSize(),
    };
  }

  @SubscribeMessage('cancelMatchmaking')
  handleCancelMatchmaking(@ConnectedSocket() client: Socket): { success: boolean } {
    return { success: this.matchmakingService.removeFromQueue(client.id) };
  }

  @SubscribeMessage('getQueueStatus')
  handleGetQueueStatus(@ConnectedSocket() client: Socket): { inQueue: boolean; queueSize: number } {
    return {
      inQueue: this.matchmakingService.isInQueue(client.id),
      queueSize: this.matchmakingService.getQueueSize(),
    };
  }

  private async processMatchmaking(): Promise<void> {
    const match = this.matchmakingService.peekMatch();
    if (!match) return;

    const { player1, player2 } = match;

    const socket1 = this.server?.sockets?.sockets?.get(player1.socketId);
    const socket2 = this.server?.sockets?.sockets?.get(player2.socketId);

    // Drop anyone whose socket has gone away and let the other player keep waiting
    // rather than burning the pair.
    if (!socket1 || !socket2) {
      if (!socket1) this.matchmakingService.removeFromQueue(player1.socketId);
      if (!socket2) this.matchmakingService.removeFromQueue(player2.socketId);
      return;
    }

    // Only commit to the pairing once we know we can serve it.
    this.matchmakingService.removeFromQueue(player1.socketId);
    this.matchmakingService.removeFromQueue(player2.socketId);

    let roomId: string | null = null;

    try {
      const room = await this.gameService.createRoom(player1.playerId, player1.socketId);
      roomId = room.id;

      const joined = await this.gameService.joinRoom(room.id, player2.playerId, player2.socketId);
      if (!joined) throw new Error('Failed to seat the second player');

      const gameState = this.gameService.getGameState(room.id);
      if (!gameState) throw new Error('Failed to build game state');

      await socket1.join(room.id);
      await socket2.join(room.id);

      socket1.emit('matchFound', {
        roomId: room.id,
        playerId: player1.playerId,
        playerRole: 'one',
        gameState,
      });

      socket2.emit('matchFound', {
        roomId: room.id,
        playerId: player2.playerId,
        playerRole: 'two',
        gameState,
      });

      this.logger.log(`Match created in room ${room.id}`);
    } catch (error) {
      this.logger.error('Failed to create a match', error as Error);

      if (roomId) this.gameService.removeRoom(roomId);

      const message = error instanceof Error ? error.message : 'Could not start the match';
      socket1.emit('matchmakingError', { message });
      socket2.emit('matchmakingError', { message });
    }
  }
}
