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
import { TournamentService } from '../tournament/tournament.service';
import {
  CreateRoomResponse,
  JoinRoomResponse,
  MakeMovePayload,
  MoveResult,
  GameState,
  PlayerRole,
} from '../types/game.types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly tournamentService: TournamentService,
  ) {}

  handleConnection(client: Socket): void {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    console.log(`Client disconnected: ${client.id}`);

    const result = this.gameService.removePlayerFromRoom(client.id);
    if (result) {
      // Notify remaining player about disconnect
      this.server.to(result.roomId).emit('playerDisconnected', {
        message: 'Opponent disconnected',
        remainingPlayers: result.remainingPlayers,
      });

      // Start 30-second countdown for opponent to reconnect
      if (result.remainingPlayers === 1) {
        console.log(`Starting 30s reconnect countdown for room ${result.roomId}`);

        setTimeout(async () => {
          const room = this.gameService.getRoom(result.roomId);
          if (room?.players.length === 1) {
            // Opponent didn't reconnect - award win to remaining player
            console.log(
              `Opponent didn't reconnect. Awarding win to remaining player in room ${result.roomId}`,
            );

            // Find the remaining player
            const remainingPlayer = room.players.find((p) => p.socketId !== '');

            if (remainingPlayer) {
              // Notify remaining player
              this.server.to(result.roomId).emit('opponentForfeit', {
                message: 'Opponent failed to reconnect. You win!',
              });

              // Check if this is a tournament game and complete it
              try {
                const dbGame = await this.tournamentService['prisma'].game.findUnique({
                  where: { id: result.roomId },
                  include: { tournament: true },
                });

                if (dbGame?.tournamentId) {
                  console.log(`Tournament game ${result.roomId} - completing with forfeit`);

                  // Determine winner ID from database player IDs
                  const winnerDbId =
                    remainingPlayer.role === 'one' ? dbGame.playerOneId : dbGame.playerTwoId;

                  // Complete the tournament game
                  await this.tournamentService.completeGame(result.roomId, winnerDbId, false);

                  console.log(`Tournament game completed. Winner: ${winnerDbId}`);

                  // Notify tournament gateway to broadcast updates
                  this.server.emit('tournamentUpdated', {
                    tournamentId: dbGame.tournamentId,
                  });
                }
              } catch (error) {
                console.error('Error completing tournament game on forfeit:', error);
              }
            }

            // Clean up room after a delay
            setTimeout(() => {
              this.gameService.removeRoom(result.roomId);
            }, 5000);
          }
        }, 30000); // 30 seconds
      }

      if (result.remainingPlayers === 0) {
        console.log(`Room ${result.roomId} deleted - no players remaining`);

        // Check if this was a tournament game with both players disconnected
        setTimeout(async () => {
          try {
            const dbGame = await this.tournamentService['prisma'].game.findUnique({
              where: { id: result.roomId },
              include: { tournament: true },
            });

            if (dbGame?.tournamentId && dbGame.status !== 'COMPLETED') {
              console.log(`Both players disconnected from tournament game ${result.roomId}`);
              // Mark as draw or handle according to rules
              await this.tournamentService.completeGame(result.roomId, null, true);

              this.server.emit('tournamentUpdated', {
                tournamentId: dbGame.tournamentId,
              });
            }
          } catch (error) {
            console.error('Error handling both players disconnect:', error);
          }
        }, 30000); // Wait 30 seconds to see if anyone reconnects
      }
    }
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @MessageBody() data: { playerId?: string },
    @ConnectedSocket() client: Socket,
  ): CreateRoomResponse {
    const playerId = data.playerId || this.generatePlayerId();
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
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; playerId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<JoinRoomResponse | { error: string }> {
    const playerId = data.playerId || this.generatePlayerId();
    console.log(`[joinRoom] Player ${playerId} attempting to join room ${data.roomId}`);

    const room = await this.gameService.joinRoom(data.roomId, playerId, client.id);

    if (!room) {
      console.log(`[joinRoom] Failed to join room ${data.roomId}`);
      return { error: 'Room not found or full' };
    }

    client.join(room.id);
    console.log(`[joinRoom] Player ${playerId} joined socket room ${room.id}`);

    const gameState = this.gameService.getGameState(room.id);
    if (!gameState) {
      console.log(`[joinRoom] Failed to get game state for room ${room.id}`);
      return { error: 'Failed to get game state' };
    }

    // Determine player role based on which player slot they filled
    const playerRole: PlayerRole =
      room.players.findIndex((p) => p.socketId === client.id) === 0 ? 'one' : 'two';

    console.log(`[joinRoom] Player ${playerId} assigned role: ${playerRole}`);

    // Notify the other player
    client.to(room.id).emit('opponentJoined', {
      message: 'Opponent joined the game',
      gameState,
    });

    console.log(`[joinRoom] Successfully joined. Returning response.`);

    return {
      roomId: room.id,
      playerId,
      playerRole,
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
        isDraw: result.isDraw,
        columnIndex: result.columnIndex,
        rowIndex: result.rowIndex,
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
