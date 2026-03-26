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

                  // Get updated tournament data and broadcast
                  const updatedTournament = await this.tournamentService.getTournament(
                    dbGame.tournamentId,
                  );
                  if (updatedTournament) {
                    console.log('📢 Broadcasting tournament update after game completion');
                    console.log(
                      'Tournament players:',
                      updatedTournament.players.map((p) => ({
                        username: p.player.username,
                        isEliminated: p.isEliminated,
                        hasBye: p.hasBye,
                      })),
                    );

                    this.server.to(`tournament:${dbGame.tournamentId}`).emit('tournamentUpdated', {
                      tournament: updatedTournament,
                    });
                  }
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
        console.log(`Room ${result.roomId} empty - scheduling deletion in 10 minutes`);

        // Schedule room deletion after 10 minutes grace period
        // This allows Player 2 to join even if Player 1 disconnected temporarily
        setTimeout(async () => {
          const room = this.gameService.getRoom(result.roomId);

          // Only delete if room still exists and is still empty
          if (room && room.players.every((p) => p.socketId === '')) {
            console.log(`Deleting empty room ${result.roomId} after grace period`);

            // Check if this was a tournament game with both players disconnected
            try {
              const dbGame = await this.tournamentService['prisma'].game.findUnique({
                where: { id: result.roomId },
                include: { tournament: true },
              });

              if (dbGame?.tournamentId && dbGame.status !== 'COMPLETED') {
                console.log(`Both players disconnected from tournament game ${result.roomId}`);
                // Mark as draw or handle according to rules
                await this.tournamentService.completeGame(result.roomId, null, true);

                // Get updated tournament data and broadcast
                const updatedTournament = await this.tournamentService.getTournament(
                  dbGame.tournamentId,
                );
                if (updatedTournament) {
                  this.server.to(`tournament:${dbGame.tournamentId}`).emit('tournamentUpdated', {
                    tournament: updatedTournament,
                  });
                }
              }
            } catch (error) {
              console.error('Error handling both players disconnect:', error);
            }

            // Finally delete the room
            this.gameService.removeRoom(result.roomId);
          } else {
            console.log(`Room ${result.roomId} has players - keeping alive`);
          }
        }, 600000); // 10 minutes = 600,000 milliseconds
      }
    }
  }

  @SubscribeMessage('createRoom')
  async handleCreateRoom(
    @MessageBody() data: { playerId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<CreateRoomResponse | { error: string }> {
    const playerId = data.playerId || this.generatePlayerId();

    try {
      const room = await this.gameService.createRoom(playerId, client.id);

      client.join(room.id);

      console.log(`Room created: ${room.id} by player ${playerId}`);

      return {
        roomId: room.id,
        playerId,
        playerRole: 'one',
      };
    } catch (error: unknown) {
      console.error('Error creating room:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create room';
      return { error: errorMessage };
    }
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

    // Clear any pending forfeit timer for this game
    this.gameService.clearForfeitTimer(room.id);

    const gameState = await this.gameService.getGameState(room.id);
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

    // Check if both players are connected and start timer if needed
    const connectedPlayers = room.players.filter((p) => p.socketId !== '').length;

    if (connectedPlayers === 2 && room.moveTimeoutSeconds) {
      // Both players connected - start move timer
      console.log(`[joinRoom] Both players connected, starting ${room.moveTimeoutSeconds}s timer`);
      this.startMoveTimerForRoom(room.id, room.moveTimeoutSeconds);
    }

    return {
      roomId: room.id,
      playerId,
      playerRole,
      gameState,
    };
  }

  @SubscribeMessage('makeMove')
  async handleMakeMove(@MessageBody() data: MakeMovePayload): Promise<MoveResult> {
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

      // If game not ended, restart timer for next player
      if (!result.winner && !result.isDraw) {
        const room = this.gameService.getRoom(data.roomId);
        if (room?.moveTimeoutSeconds) {
          console.log(`[makeMove] Restarting timer for next player's turn`);
          this.startMoveTimerForRoom(data.roomId, room.moveTimeoutSeconds);
        }
      }

      // If game ended (winner or draw), handle tournament completion
      if (result.winner || result.isDraw) {
        console.log(`Game ${data.roomId} ended. Winner: ${result.winner}, Draw: ${result.isDraw}`);

        try {
          // Check if this is a tournament game
          const dbGame = await this.tournamentService['prisma'].game.findUnique({
            where: { id: data.roomId },
            include: { tournament: true, playerOne: true, playerTwo: true },
          });

          if (dbGame?.tournamentId) {
            console.log(`Tournament game ${data.roomId} completed`);

            // Determine winner database ID
            let winnerDbId: string | null = null;
            if (result.winner) {
              const room = this.gameService.getRoom(data.roomId);
              if (room) {
                const winningPlayer = room.players.find((p) => p.role === result.winner);
                if (winningPlayer) {
                  // Look up database ID from token
                  const dbPlayer = await this.tournamentService['prisma'].player.findUnique({
                    where: { token: winningPlayer.id },
                  });
                  if (dbPlayer) {
                    winnerDbId = dbPlayer.id;
                  }
                }
              }
            }

            // Complete the tournament game
            const completionResult = await this.tournamentService.completeGame(
              data.roomId,
              winnerDbId,
              result.isDraw,
            );

            console.log(
              `Tournament game completed. Winner DB ID: ${winnerDbId}, Draw: ${result.isDraw}`,
            );
            console.log(
              `Round complete: ${completionResult.roundResult.roundComplete}, Tournament complete: ${completionResult.roundResult.tournamentComplete}`,
            );

            // Get updated tournament and broadcast to all tournament participants
            const updatedTournament = await this.tournamentService.getTournament(
              dbGame.tournamentId,
            );
            if (updatedTournament) {
              console.log('📢 Broadcasting tournament update after game completion');
              console.log('Tournament status:', updatedTournament.status);
              console.log('Current round:', updatedTournament.currentRound);
              console.log(
                'Tournament players:',
                updatedTournament.players.map((p) => ({
                  username: p.player.username,
                  isEliminated: p.isEliminated,
                  hasBye: p.hasBye,
                })),
              );

              this.server.to(`tournament:${dbGame.tournamentId}`).emit('tournamentUpdated', {
                tournament: updatedTournament,
              });

              // Emit gameCompleted event
              this.server.to(`tournament:${dbGame.tournamentId}`).emit('gameCompleted', {
                tournament: updatedTournament,
                gameId: data.roomId,
              });

              // If round completed, emit roundCompleted event
              if (
                completionResult.roundResult.roundComplete &&
                !completionResult.roundResult.tournamentComplete
              ) {
                console.log(`📢 Broadcasting round completion for round ${dbGame.round}`);
                this.server.to(`tournament:${dbGame.tournamentId}`).emit('roundCompleted', {
                  tournament: updatedTournament,
                  round: dbGame.round,
                });
              }

              // If tournament completed, emit tournamentCompleted event
              if (completionResult.roundResult.tournamentComplete) {
                console.log(`📢 Broadcasting tournament completion`);
                this.server.to(`tournament:${dbGame.tournamentId}`).emit('tournamentCompleted', {
                  tournament: updatedTournament,
                });
              }
            }
          }
        } catch (error) {
          console.error('Error completing tournament game:', error);
        }
      }
    }

    return result;
  }

  @SubscribeMessage('resetGame')
  async handleResetGame(@MessageBody() data: { roomId: string }): Promise<{ success: boolean }> {
    const success = this.gameService.resetGame(data.roomId);

    if (success) {
      const gameState = await this.gameService.getGameState(data.roomId);
      this.server.to(data.roomId).emit('gameReset', gameState);
    }

    return { success };
  }

  @SubscribeMessage('getGameState')
  async handleGetGameState(
    @MessageBody() data: { roomId: string },
  ): Promise<GameState | { error: string }> {
    const gameState = await this.gameService.getGameState(data.roomId);

    if (!gameState) {
      return { error: 'Room not found' };
    }

    return gameState;
  }

  private generatePlayerId(): string {
    return `player_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Start move timer and broadcast updates
   */
  private startMoveTimerForRoom(roomId: string, timeoutSeconds: number): void {
    this.gameService.startMoveTimer(roomId, timeoutSeconds, async () => {
      // Timer expired - handle timeout
      await this.handleMoveTimeout(roomId);
    });

    // Broadcast timer started
    this.server.to(roomId).emit('moveTimerStarted', {
      timeoutSeconds,
    });

    // Start broadcasting timer updates every second
    this.broadcastTimerUpdates(roomId);
  }

  /**
   * Broadcast timer updates every second
   */
  private broadcastTimerUpdates(roomId: string): void {
    const interval = setInterval(() => {
      const remaining = this.gameService.getRemainingTime(roomId);

      if (remaining === null) {
        // Timer cleared or room gone
        clearInterval(interval);
        return;
      }

      // Broadcast current time
      this.server.to(roomId).emit('moveTimerUpdate', {
        timeRemaining: remaining,
      });

      // Emit warnings at thresholds
      if (remaining === 10) {
        this.server.to(roomId).emit('moveTimerWarning', {
          timeRemaining: remaining,
          level: 'warning',
        });
      } else if (remaining === 5) {
        this.server.to(roomId).emit('moveTimerWarning', {
          timeRemaining: remaining,
          level: 'critical',
        });
      }

      // Stop broadcasting when timer expires
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
  }

  /**
   * Handle move timeout - forfeit current player
   */
  private async handleMoveTimeout(roomId: string): Promise<void> {
    const room = this.gameService.getRoom(roomId);
    if (!room) return;

    console.log(`⏰ Move timeout in room ${roomId}, current turn: ${room.currentTurn}`);

    // Determine winner (opposite of current turn)
    const winnerRole: PlayerRole = room.currentTurn === 'one' ? 'two' : 'one';
    const winner = room.players.find((p) => p.role === winnerRole);

    if (!winner) return;

    // Broadcast timeout event
    this.server.to(roomId).emit('moveTimeout', {
      message: 'Time expired! Game forfeited.',
      winner: winnerRole,
    });

    // Look up winner's database ID
    const dbWinner = await this.tournamentService['prisma'].player.findUnique({
      where: { token: winner.id },
    });

    if (!dbWinner) return;

    // Check if tournament game
    const dbGame = await this.tournamentService['prisma'].game.findUnique({
      where: { id: roomId },
      include: { tournament: true },
    });

    if (dbGame?.tournamentId) {
      // Complete tournament game
      await this.tournamentService.completeGame(roomId, dbWinner.id, false);

      // Broadcast tournament update
      const updatedTournament = await this.tournamentService.getTournament(dbGame.tournamentId);

      if (updatedTournament) {
        this.server.to(`tournament:${dbGame.tournamentId}`).emit('tournamentUpdated', {
          tournament: updatedTournament,
        });
      }
    }

    // Clean up room
    setTimeout(() => {
      this.gameService.removeRoom(roomId);
    }, 5000);
  }
}
