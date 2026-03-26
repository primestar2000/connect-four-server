import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MatchmakingService } from './matchmaking.service';
import { GameService } from '../game/game.service';

interface FindMatchResponse {
  status: 'searching' | 'matched';
  queueSize?: number;
  roomId?: string;
  playerId?: string;
  playerRole?: 'one' | 'two';
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MatchmakingGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly gameService: GameService,
  ) {
    // Check for matches every 500ms
    setInterval(() => {
      this.processMatchmaking();
    }, 500);
  }

  @SubscribeMessage('findMatch')
  handleFindMatch(@ConnectedSocket() client: Socket): FindMatchResponse {
    const playerId = this.generatePlayerId();

    // Add player to queue
    this.matchmakingService.addToQueue(client.id, playerId);

    return {
      status: 'searching',
      queueSize: this.matchmakingService.getQueueSize(),
    };
  }

  @SubscribeMessage('cancelMatchmaking')
  handleCancelMatchmaking(@ConnectedSocket() client: Socket): { success: boolean } {
    const removed = this.matchmakingService.removeFromQueue(client.id);
    return { success: removed };
  }

  @SubscribeMessage('getQueueStatus')
  handleGetQueueStatus(@ConnectedSocket() client: Socket): { inQueue: boolean; queueSize: number } {
    return {
      inQueue: this.matchmakingService.isInQueue(client.id),
      queueSize: this.matchmakingService.getQueueSize(),
    };
  }

  private async processMatchmaking(): Promise<void> {
    const match = this.matchmakingService.findMatch();

    if (!match) {
      return;
    }

    const { player1, player2 } = match;

    // Create a game room
    const room = await this.gameService.createRoom(player1.playerId, player1.socketId);

    // Join player 2 to the room
    const joinedRoom = await this.gameService.joinRoom(room.id, player2.playerId, player2.socketId);

    if (!joinedRoom) {
      console.error('Failed to join player 2 to room');
      return;
    }

    // Get game state
    const gameState = await this.gameService.getGameState(room.id);

    if (!gameState) {
      console.error('Failed to get game state');
      return;
    }

    // Get socket instances
    const socket1 = this.server.sockets.sockets.get(player1.socketId);
    const socket2 = this.server.sockets.sockets.get(player2.socketId);

    if (!socket1 || !socket2) {
      console.error('Failed to get socket instances');
      return;
    }

    // Join both players to the room
    socket1.join(room.id);
    socket2.join(room.id);

    // Notify both players
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

    console.log(`Match created: Room ${room.id} - ${player1.playerId} vs ${player2.playerId}`);
  }

  private generatePlayerId(): string {
    return `player_${Math.random().toString(36).substring(2, 11)}`;
  }
}
