import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import {
  CreateRoomResponse,
  JoinRoomResponse,
  MakeMovePayload,
  MoveResult,
  GameState,
} from '../types/game.types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly gameService: GameService) {}

  handleConnection(client: Socket): void {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    console.log(`Client disconnected: ${client.id}`);

    const result = this.gameService.removePlayerFromRoom(client.id);
    if (result) {
      this.server.to(result.roomId).emit('playerDisconnected', {
        message: 'Opponent disconnected',
        remainingPlayers: result.remainingPlayers,
      });

      if (result.remainingPlayers === 0) {
        console.log(`Room ${result.roomId} deleted - no players remaining`);
      }
    }
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(@ConnectedSocket() client: Socket): CreateRoomResponse {
    const playerId = this.generatePlayerId();
    const room = this.gameService.createRoom(playerId, client.id);

    client.join(room.id);

    console.log(`Room created: ${room.id} by player ${playerId}`);

    return {
      roomId: room.id,
      playerId,
      playerRole: 'one',
    };
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ): JoinRoomResponse | { error: string } {
    const playerId = this.generatePlayerId();
    const room = this.gameService.joinRoom(data.roomId, playerId, client.id);

    if (!room) {
      return { error: 'Room not found or full' };
    }

    client.join(room.id);

    const gameState = this.gameService.getGameState(room.id);
    if (!gameState) {
      return { error: 'Failed to get game state' };
    }

    // Notify the other player
    client.to(room.id).emit('opponentJoined', {
      message: 'Opponent joined the game',
      gameState,
    });

    console.log(`Player ${playerId} joined room ${room.id}`);

    return {
      roomId: room.id,
      playerId,
      playerRole: 'two',
      gameState,
    };
  }

  @SubscribeMessage('makeMove')
  handleMakeMove(@MessageBody() data: MakeMovePayload): MoveResult {
    const result = this.gameService.makeMove(data.roomId, data.playerId, data.columnIndex);

    if (result.success) {
      // Broadcast move to all players in the room
      this.server.to(data.roomId).emit('moveMade', {
        board: result.board,
        currentTurn: result.currentTurn,
        winner: result.winner,
        winningLine: result.winningLine,
      });
    }

    return result;
  }

  @SubscribeMessage('resetGame')
  handleResetGame(@MessageBody() data: { roomId: string }): { success: boolean } {
    const success = this.gameService.resetGame(data.roomId);

    if (success) {
      const gameState = this.gameService.getGameState(data.roomId);
      this.server.to(data.roomId).emit('gameReset', gameState);
    }

    return { success };
  }

  @SubscribeMessage('getGameState')
  handleGetGameState(@MessageBody() data: { roomId: string }): GameState | { error: string } {
    const gameState = this.gameService.getGameState(data.roomId);

    if (!gameState) {
      return { error: 'Room not found' };
    }

    return gameState;
  }

  private generatePlayerId(): string {
    return `player_${Math.random().toString(36).substring(2, 11)}`;
  }
}
