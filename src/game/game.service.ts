import { Injectable } from '@nestjs/common';
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
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    return room;
  }

  joinRoom(roomId: string, playerId: string, socketId: string): GameRoom | null {
    const room = this.rooms.get(roomId);
    if (!room || room.players.length >= 2) {
      return null;
    }

    const player: Player = {
      id: playerId,
      role: 'two',
      color: 'yellow',
      socketId,
    };

    room.players.push(player);
    this.rooms.set(roomId, room);
    return room;
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
        error: 'Not your turn',
      };
    }

    if (room.winner) {
      return {
        success: false,
        board: room.board,
        currentTurn: room.currentTurn,
        winner: room.winner,
        winningLine: room.winningLine,
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
    };
  }

  resetGame(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.board = this.createEmptyBoard();
    room.currentTurn = 'one';
    room.winner = null;
    room.winningLine = null;

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
        room.players.splice(playerIndex, 1);

        if (room.players.length === 0) {
          this.rooms.delete(roomId);
          return { roomId, remainingPlayers: 0 };
        }

        return { roomId, remainingPlayers: room.players.length };
      }
    }
    return null;
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

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}
