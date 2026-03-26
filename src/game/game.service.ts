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
  private readonly rooms: Map<string, GameRoom> = new Map();
  private readonly forfeitTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly ROWS = 6;
  private readonly COLS = 7;
  private readonly TOURNAMENT_JOIN_TIMEOUT = 120000; // 2 minutes for players to join tournament game

  constructor(private readonly prisma: PrismaService) {}

  async createRoom(playerId: string, socketId: string): Promise<GameRoom> {
    const roomId = this.generateRoomId();

    console.log('🔍 [DEBUG] createRoom called');
    console.log('🔍 [DEBUG] Received playerId (token):', playerId);
    console.log('🔍 [DEBUG] Socket ID:', socketId);

    // Look up player by token to get database ID
    const dbPlayer = await this.prisma.player.findUnique({
      where: { token: playerId },
    });

    console.log(
      '🔍 [DEBUG] Database lookup result:',
      dbPlayer ? `Found: ${dbPlayer.username}` : 'NOT FOUND',
    );

    if (!dbPlayer) {
      throw new Error('Player not found. Please create a profile first.');
    }

    const player: Player = {
      id: playerId, // Keep token as id for socket communication
      username: dbPlayer.username,
      avatar: dbPlayer.avatar ?? undefined,
      avatarType: dbPlayer.avatarType ?? undefined,
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
    console.log(`🎮 Room created: ${roomId} by player ${dbPlayer.username} (token: ${playerId})`);
    return room;
  }

  async joinRoom(roomId: string, playerId: string, socketId: string): Promise<GameRoom | null> {
    // First check if room already exists in memory
    let room = this.rooms.get(roomId);

    if (room) {
      console.log(`Room ${roomId} found in memory. Players: ${room.players.length}`);
      room.players.forEach((p, idx) => {
        console.log(
          `  Player ${idx}: id=${p.id}, role=${p.role}, socketId=${p.socketId || '(empty)'}`,
        );
      });

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

      // Check if room is full (both slots taken by connected players)
      const connectedPlayers = room.players.filter((p) => p.socketId !== '').length;
      console.log(`Connected players: ${connectedPlayers}, Total players: ${room.players.length}`);

      if (room.players.length >= 2 && connectedPlayers >= 2) {
        // Both slots taken and both players connected
        console.log(`Room ${roomId} is full with 2 connected players`);
        return null;
      }

      if (room.players.length === 1) {
        // Only one player in room - add second player
        // Look up player by token to get database ID
        const dbPlayer = await this.prisma.player.findUnique({
          where: { token: playerId },
        });

        if (!dbPlayer) {
          throw new Error('Player not found. Please create a profile first.');
        }

        const player: Player = {
          id: playerId, // Keep token as id for socket communication
          username: dbPlayer.username,
          avatar: dbPlayer.avatar ?? undefined,
          avatarType: dbPlayer.avatarType ?? undefined,
          role: 'two',
          color: 'yellow',
          socketId,
        };

        room.players.push(player);
        this.rooms.set(roomId, room);
        console.log(
          `Player ${dbPlayer.username} (token: ${playerId}) joined existing room ${roomId} as player two`,
        );
        return room;
      }

      // If we get here, room has 2 players but at least one is disconnected
      // Check if this is a tournament game
      console.log(`Room has 2 players, checking if tournament game...`);
    }

    // Check if it's a tournament game in the database
    try {
      const dbGame = await this.prisma.game.findUnique({
        where: { id: roomId },
        include: {
          playerOne: true,
          playerTwo: true,
          tournament: true,
        },
      });

      if (dbGame && dbGame.status === 'IN_PROGRESS') {
        console.log(`Loading tournament game ${roomId} from database`);
        console.log(`Player One: ${dbGame.playerOne.username} (${dbGame.playerOneId})`);
        console.log(`Player Two: ${dbGame.playerTwo.username} (${dbGame.playerTwoId})`);
        console.log(`Joining player token: ${playerId}`);

        // Look up the joining player by token
        const joiningPlayer = await this.prisma.player.findUnique({
          where: { token: playerId },
        });

        if (!joiningPlayer) {
          console.error(`Player with token ${playerId} not found`);
          return null;
        }

        console.log(`Joining player: ${joiningPlayer.username} (DB ID: ${joiningPlayer.id})`);

        // Check if player is in this game
        if (joiningPlayer.id !== dbGame.playerOneId && joiningPlayer.id !== dbGame.playerTwoId) {
          console.log(`Player ${joiningPlayer.username} (${joiningPlayer.id}) not in this game`);
          console.log(`Expected: ${dbGame.playerOneId} or ${dbGame.playerTwoId}`);
          return null;
        }

        // Check if player is eliminated from tournament
        if (dbGame.tournamentId) {
          const tournamentPlayer = await this.prisma.tournamentPlayer.findFirst({
            where: {
              tournamentId: dbGame.tournamentId,
              playerId: joiningPlayer.id,
            },
          });

          if (tournamentPlayer?.isEliminated) {
            console.log(`Player ${joiningPlayer.username} is eliminated from tournament`);
            return null;
          }
        }

        // Check if room already exists (might have been created by first player)
        room = this.rooms.get(roomId);

        if (room) {
          // Room exists, find the matching player slot by database ID
          if (joiningPlayer.id === dbGame.playerOneId) {
            const player1 = room.players.find((p) => p.role === 'one');
            if (player1) {
              player1.socketId = socketId;
              player1.id = playerId; // Update with the token
              this.rooms.set(roomId, room);
              console.log(`Matched to Player One: ${joiningPlayer.username}`);
              return room;
            }
          } else if (joiningPlayer.id === dbGame.playerTwoId) {
            const player2 = room.players.find((p) => p.role === 'two');
            if (player2) {
              player2.socketId = socketId;
              player2.id = playerId; // Update with the token
              this.rooms.set(roomId, room);
              console.log(`Matched to Player Two: ${joiningPlayer.username}`);
              return room;
            }
          }

          console.log(`Player ${joiningPlayer.username} (${joiningPlayer.id}) not in this game`);
          return null;
        }

        // Create new room for tournament game
        // Get tournament timeout if this is a tournament game
        let tournamentTimeout = 30; // Default
        if (dbGame.tournamentId) {
          const tournament = await this.prisma.tournament.findUnique({
            where: { id: dbGame.tournamentId },
          });
          tournamentTimeout = tournament?.moveTimeoutSeconds ?? 30;
        }

        const gameRoom: GameRoom = {
          id: dbGame.id,
          players: [],
          board: dbGame.boardState ? (dbGame.boardState as GameBoard) : this.createEmptyBoard(),
          currentTurn: 'one',
          winner: null,
          winningLine: null,
          isDraw: dbGame.isDraw,
          createdAt: dbGame.createdAt,
          tournamentId: dbGame.tournamentId ?? undefined,
          moveTimeoutSeconds: tournamentTimeout,
        };

        // Create player slots with tokens as IDs (for socket communication)
        const player1: Player = {
          id: dbGame.playerOneId, // Temporarily use DB ID, will be replaced with token when they join
          username: dbGame.playerOne.username,
          avatar: dbGame.playerOne.avatar ?? undefined,
          avatarType: dbGame.playerOne.avatarType ?? undefined,
          role: 'one',
          color: 'red',
          socketId: '',
        };

        const player2: Player = {
          id: dbGame.playerTwoId, // Temporarily use DB ID, will be replaced with token when they join
          username: dbGame.playerTwo.username,
          avatar: dbGame.playerTwo.avatar ?? undefined,
          avatarType: dbGame.playerTwo.avatarType ?? undefined,
          role: 'two',
          color: 'yellow',
          socketId: '',
        };

        gameRoom.players.push(player1, player2);

        // Determine which player is joining by matching database ID
        if (joiningPlayer.id === dbGame.playerOneId) {
          gameRoom.players[0].socketId = socketId;
          gameRoom.players[0].id = playerId; // Use the token
          console.log(`Matched to Player One: ${joiningPlayer.username}`);
        } else if (joiningPlayer.id === dbGame.playerTwoId) {
          gameRoom.players[1].socketId = socketId;
          gameRoom.players[1].id = playerId; // Use the token
          console.log(`Matched to Player Two: ${joiningPlayer.username}`);
        } else {
          console.log(`Player ${joiningPlayer.username} (${joiningPlayer.id}) not in this game`);
          console.log(`Expected: ${dbGame.playerOneId} or ${dbGame.playerTwoId}`);
          return null;
        }

        this.rooms.set(roomId, gameRoom);
        console.log(`✅ Created tournament game room ${roomId} for ${joiningPlayer.username}`);
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

    // Clear move timer since move was made
    this.clearMoveTimer(roomId);

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

  async getGameState(roomId: string): Promise<GameState | null> {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Look up player info from database by token
    const getPlayerInfo = async (player: Player) => {
      try {
        const dbPlayer = await this.prisma.player.findUnique({
          where: { token: player.id },
          select: { username: true, avatar: true, avatarType: true },
        });

        return {
          id: player.id,
          connected: player.socketId !== '',
          username: dbPlayer?.username || 'Unknown',
          avatar: dbPlayer?.avatar ?? undefined,
          avatarType: dbPlayer?.avatarType ?? undefined,
        };
      } catch (error) {
        console.error(`Error looking up player ${player.id}:`, error);
        return {
          id: player.id,
          connected: player.socketId !== '',
          username: 'Unknown',
        };
      }
    };

    const [playerOne, playerTwo] = await Promise.all([
      room.players[0] ? getPlayerInfo(room.players[0]) : Promise.resolve(null),
      room.players[1] ? getPlayerInfo(room.players[1]) : Promise.resolve(null),
    ]);

    return {
      board: room.board,
      currentTurn: room.currentTurn,
      winner: room.winner,
      winningLine: room.winningLine,
      isDraw: room.isDraw,
      players: {
        playerOne,
        playerTwo,
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
    this.clearMoveTimer(roomId);
    this.rooms.delete(roomId);
    this.clearForfeitTimer(roomId);
    console.log(`Room ${roomId} removed`);
  }

  clearForfeitTimer(roomId: string): void {
    const timer = this.forfeitTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.forfeitTimers.delete(roomId);
      console.log(`Cleared forfeit timer for room ${roomId}`);
    }
  }

  setForfeitTimer(
    roomId: string,
    callback: () => void,
    timeout: number = this.TOURNAMENT_JOIN_TIMEOUT,
  ): void {
    // Clear any existing timer
    this.clearForfeitTimer(roomId);

    // Set new timer
    const timer = setTimeout(() => {
      console.log(`Forfeit timer expired for room ${roomId}`);
      callback();
      this.forfeitTimers.delete(roomId);
    }, timeout);

    this.forfeitTimers.set(roomId, timer);
    console.log(`Set forfeit timer for room ${roomId} (${timeout}ms)`);
  }

  /**
   * Start move timer for a game
   */
  startMoveTimer(roomId: string, timeoutSeconds: number, onTimeout: () => void): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Clear any existing timer
    this.clearMoveTimer(roomId);

    // Set move start time
    room.moveStartTime = new Date();
    room.moveTimeoutSeconds = timeoutSeconds;

    // Start timer
    room.moveTimer = setTimeout(() => {
      console.log(`⏰ Move timeout for room ${roomId}`);
      onTimeout();
    }, timeoutSeconds * 1000);

    this.rooms.set(roomId, room);
    console.log(`⏱️ Started ${timeoutSeconds}s move timer for room ${roomId}`);
  }

  /**
   * Clear move timer for a game
   */
  clearMoveTimer(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.moveTimer) {
      clearTimeout(room.moveTimer);
      room.moveTimer = undefined;
      room.moveStartTime = undefined;
      console.log(`⏱️ Cleared move timer for room ${roomId}`);
    }
  }

  /**
   * Get remaining time for current move
   */
  getRemainingTime(roomId: string): number | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.moveStartTime || !room.moveTimeoutSeconds) {
      return null;
    }

    const elapsed = Date.now() - room.moveStartTime.getTime();
    const remaining = room.moveTimeoutSeconds * 1000 - elapsed;
    return Math.max(0, Math.ceil(remaining / 1000)); // Return seconds
  }

  /**
   * Pause move timer (for disconnections)
   */
  pauseMoveTimer(roomId: string): number | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.moveTimer) return null;

    const remaining = this.getRemainingTime(roomId);
    this.clearMoveTimer(roomId);

    console.log(`⏸️ Paused move timer for room ${roomId}, ${remaining}s remaining`);
    return remaining;
  }

  /**
   * Resume move timer (after reconnection)
   */
  resumeMoveTimer(roomId: string, remainingSeconds: number, onTimeout: () => void): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Clear any existing timer
    this.clearMoveTimer(roomId);

    // Set new start time based on remaining time
    room.moveStartTime = new Date();
    room.moveTimeoutSeconds = remainingSeconds;

    // Start timer with remaining time
    room.moveTimer = setTimeout(() => {
      console.log(`⏰ Move timeout for room ${roomId} (resumed)`);
      onTimeout();
    }, remainingSeconds * 1000);

    this.rooms.set(roomId, room);
    console.log(`▶️ Resumed move timer for room ${roomId}, ${remainingSeconds}s remaining`);
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
