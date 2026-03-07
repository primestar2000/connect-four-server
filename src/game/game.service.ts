import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GameRoom,
  GameBoard,
  PlayerRole,
  Player,
  GameState,
  MoveResult,
} from '../types/game.types';

@Injectable()
export class GameService {
  private rooms: Map<string, GameRoom> = new Map();
  private readonly ROWS = 6;
  private readonly COLS = 7;

  constructor(private readonly prisma: PrismaService) {}

  createRoom(playerId: string, socketId: string): GameRoom {
    const roomId = this.generateRoomId();
    const player: Player = {
      id: playerId,
      role: 'one',
      color: 'red',
      socketId,
    };

    const room: GameRoom = {
      id: roomId,
      players: [player],
      board: this.createEmptyBoard(),
      currentTurn: 'one',
      winner: null,
      winningLine: null,
      isDraw: false,
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    return room;
  }

  async joinRoom(roomId: string, playerId: string, socketId: string): Promise<GameRoom | null> {
    // First check if room already exists in memory
    let room = this.rooms.get(roomId);

    if (room) {
      // Room exists - check if player is already in it (reconnecting or tournament game)
      const existingPlayer = room.players.find((p) => p.socketId === socketId || p.id === playerId);

      if (existingPlayer) {
        // Player reconnecting or joining their assigned slot - update socket ID
        existingPlayer.socketId = socketId;
        this.rooms.set(roomId, room);
        console.log(
          `Player ${playerId} reconnected to room ${roomId} as player ${existingPlayer.role}`,
        );
        return room;
      }

      // For tournament games, check if this player matches one of the pre-assigned slots
      const matchingPlayer = room.players.find((p) => {
        // Extract username from player ID (database ID format is different)
        // We need to check if this is their assigned slot
        return p.socketId === '' && p.id !== playerId;
      });

      if (matchingPlayer && room.players.length === 2) {
        // This might be a tournament game - check if username matches
        // We'll let the database check below handle this
        console.log(`Room has 2 players but checking if this is a tournament game assignment`);
      } else if (room.players.length >= 2) {
        // Regular game that's full
        console.log(`Room ${roomId} is full with ${room.players.length} players`);
        return null;
      } else {
        // Add as second player in regular game
        const player: Player = {
          id: playerId,
          role: 'two',
          color: 'yellow',
          socketId,
        };

        room.players.push(player);
        this.rooms.set(roomId, room);
        console.log(`Player ${playerId} joined existing room ${roomId} as player two`);
        return room;
      }
    }

    // Check if it's a tournament game in the database
    try {
      const dbGame = await this.prisma.game.findUnique({
        where: { id: roomId },
        include: {
          playerOne: true,
          playerTwo: true,
        },
      });

      if (dbGame && dbGame.status === 'IN_PROGRESS') {
        console.log(`Loading tournament game ${roomId} from database`);
        console.log(`Player One: ${dbGame.playerOne.username} (${dbGame.playerOneId})`);
        console.log(`Player Two: ${dbGame.playerTwo.username} (${dbGame.playerTwoId})`);
        console.log(`Joining player ID: ${playerId}`);

        // Check if room already exists (might have been created by first player)
        room = this.rooms.get(roomId);

        if (room) {
          // Room exists, find the matching player slot by username
          const usernameFromPlayerId = playerId.split('_')[1];

          if (usernameFromPlayerId === dbGame.playerOne.username) {
            const player1 = room.players.find((p) => p.role === 'one');
            if (player1) {
              player1.socketId = socketId;
              player1.id = playerId; // Update with the actual playerId
              this.rooms.set(roomId, room);
              console.log(`Matched to Player One by username: ${usernameFromPlayerId}`);
              return room;
            }
          } else if (usernameFromPlayerId === dbGame.playerTwo.username) {
            const player2 = room.players.find((p) => p.role === 'two');
            if (player2) {
              player2.socketId = socketId;
              player2.id = playerId; // Update with the actual playerId
              this.rooms.set(roomId, room);
              console.log(`Matched to Player Two by username: ${usernameFromPlayerId}`);
              return room;
            }
          }

          console.log(`Could not match username ${usernameFromPlayerId} to either player`);
          return null;
        }

        // Create new room for tournament game
        const gameRoom: GameRoom = {
          id: dbGame.id,
          players: [],
          board: dbGame.boardState ? (dbGame.boardState as GameBoard) : this.createEmptyBoard(),
          currentTurn: 'one',
          winner: null,
          winningLine: null,
          isDraw: dbGame.isDraw,
          createdAt: dbGame.createdAt,
        };

        // Create player slots with database IDs
        const player1: Player = {
          id: dbGame.playerOneId,
          role: 'one',
          color: 'red',
          socketId: '',
        };

        const player2: Player = {
          id: dbGame.playerTwoId,
          role: 'two',
          color: 'yellow',
          socketId: '',
        };

        gameRoom.players.push(player1, player2);

        // Determine which player is joining by checking username in playerId
        // playerId format: player_username_randomid
        const usernameFromPlayerId = playerId.split('_')[1];

        if (usernameFromPlayerId === dbGame.playerOne.username) {
          gameRoom.players[0].socketId = socketId;
          gameRoom.players[0].id = playerId; // Use the generated playerId
          console.log(`Matched to Player One by username: ${usernameFromPlayerId}`);
        } else if (usernameFromPlayerId === dbGame.playerTwo.username) {
          gameRoom.players[1].socketId = socketId;
          gameRoom.players[1].id = playerId; // Use the generated playerId
          console.log(`Matched to Player Two by username: ${usernameFromPlayerId}`);
        } else {
          console.log(`Could not match username ${usernameFromPlayerId} to either player`);
          return null;
        }

        this.rooms.set(roomId, gameRoom);
        return gameRoom;
      }
    } catch (error) {
      console.error('Error checking database for game:', error);
    }

    return null;
  }

  getRoom(roomId: string): GameRoom | null {
    return this.rooms.get(roomId) || null;
  }

  makeMove(roomId: string, playerId: string, columnIndex: number): MoveResult {
    const room = this.rooms.get(roomId);

    if (!room) {
      return {
        success: false,
        board: [],
        currentTurn: 'one',
        winner: null,
        winningLine: null,
        isDraw: false,
        error: 'Room not found',
      };
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      return {
        success: false,
        board: room.board,
        currentTurn: room.currentTurn,
        winner: room.winner,
        winningLine: room.winningLine,
        isDraw: room.isDraw,
        error: 'Player not in room',
      };
    }

    if (player.role !== room.currentTurn) {
      return {
        success: false,
        board: room.board,
        currentTurn: room.currentTurn,
        winner: room.winner,
        winningLine: room.winningLine,
        isDraw: room.isDraw,
        error: 'Not your turn',
      };
    }

    if (room.winner || room.isDraw) {
      return {
        success: false,
        board: room.board,
        currentTurn: room.currentTurn,
        winner: room.winner,
        winningLine: room.winningLine,
        isDraw: room.isDraw,
        error: 'Game already finished',
      };
    }

    // Find lowest empty cell in column
    let targetRow = -1;
    for (let r = this.ROWS - 1; r >= 0; r--) {
      if (room.board[r][columnIndex] === null) {
        targetRow = r;
        break;
      }
    }

    if (targetRow === -1) {
      return {
        success: false,
        board: room.board,
        currentTurn: room.currentTurn,
        winner: room.winner,
        winningLine: room.winningLine,
        isDraw: room.isDraw,
        error: 'Column is full',
      };
    }

    // Make the move
    room.board[targetRow][columnIndex] = player.color;

    // Check for winner
    const winResult = this.checkWinner(room.board);
    if (winResult) {
      room.winner = winResult.winner;
      room.winningLine = winResult.line;
    } else if (this.checkDraw(room.board)) {
      room.isDraw = true;
    } else {
      // Switch turns
      room.currentTurn = room.currentTurn === 'one' ? 'two' : 'one';
    }

    this.rooms.set(roomId, room);

    return {
      success: true,
      board: room.board,
      currentTurn: room.currentTurn,
      winner: room.winner,
      winningLine: room.winningLine,
      isDraw: room.isDraw,
      columnIndex,
      rowIndex: targetRow,
    };
  }

  resetGame(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.board = this.createEmptyBoard();
    room.currentTurn = 'one';
    room.winner = null;
    room.winningLine = null;
    room.isDraw = false;

    this.rooms.set(roomId, room);
    return true;
  }

  getGameState(roomId: string): GameState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      board: room.board,
      currentTurn: room.currentTurn,
      winner: room.winner,
      winningLine: room.winningLine,
      isDraw: room.isDraw,
      players: {
        playerOne: room.players[0] ? { id: room.players[0].id, connected: true } : null,
        playerTwo: room.players[1] ? { id: room.players[1].id, connected: true } : null,
      },
    };
  }

  removePlayerFromRoom(socketId: string): { roomId: string; remainingPlayers: number } | null {
    for (const [roomId, room] of this.rooms.entries()) {
      const playerIndex = room.players.findIndex((p) => p.socketId === socketId);
      if (playerIndex !== -1) {
        // Mark player as disconnected but don't remove them yet (allow reconnect)
        room.players[playerIndex].socketId = '';

        if (room.players.length === 0 || room.players.every((p) => p.socketId === '')) {
          this.rooms.delete(roomId);
          return { roomId, remainingPlayers: 0 };
        }

        const connectedPlayers = room.players.filter((p) => p.socketId !== '').length;
        return { roomId, remainingPlayers: connectedPlayers };
      }
    }
    return null;
  }

  removeRoom(roomId: string): void {
    this.rooms.delete(roomId);
    console.log(`Room ${roomId} removed`);
  }

  private createEmptyBoard(): GameBoard {
    return Array.from({ length: this.ROWS }, () => Array.from({ length: this.COLS }, () => null));
  }

  private checkWinner(board: GameBoard): { winner: PlayerRole; line: [number, number][] } | null {
    const directions: [number, number][] = [
      [0, 1], // Horizontal
      [1, 0], // Vertical
      [1, 1], // Diagonal \
      [1, -1], // Diagonal /
    ];

    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const cell = board[r][c];
        if (!cell) continue;

        for (const [dr, dc] of directions) {
          let count = 1;
          const line: [number, number][] = [[r, c]];

          for (let i = 1; i < 4; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (nr >= 0 && nr < this.ROWS && nc >= 0 && nc < this.COLS && board[nr][nc] === cell) {
              count++;
              line.push([nr, nc]);
            } else {
              break;
            }
          }

          if (count === 4) {
            return {
              winner: cell === 'red' ? 'one' : 'two',
              line,
            };
          }
        }
      }
    }
    return null;
  }

  private checkDraw(board: GameBoard): boolean {
    // Check if all cells are filled
    return board.every((row) => row.every((cell) => cell !== null));
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}
