import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GameRoom,
  PlayerRole,
  Player,
  GameState,
  MoveResult,
  PublicPlayer,
  ROLE_COLOR,
} from '../types/game.types';
import {
  checkDraw,
  checkWinner,
  createEmptyBoard,
  deriveCurrentTurn,
  findDropRow,
  isValidColumn,
  normaliseBoard,
} from './board.logic';

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  private readonly rooms: Map<string, GameRoom> = new Map();
  private readonly forfeitTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly TOURNAMENT_JOIN_TIMEOUT = 120000; // 2 minutes for players to join tournament game

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Room lifecycle
  // ---------------------------------------------------------------------------

  async createRoom(playerId: string, socketId: string): Promise<GameRoom> {
    const roomId = this.generateRoomId();

    const dbPlayer = await this.prisma.player.findUnique({
      where: { token: playerId },
    });

    if (!dbPlayer) {
      throw new Error('Player not found. Please create a profile first.');
    }

    const room: GameRoom = {
      id: roomId,
      players: [this.toRoomPlayer(dbPlayer, playerId, 'one', socketId)],
      board: createEmptyBoard(),
      currentTurn: 'one',
      winner: null,
      winningLine: null,
      isDraw: false,
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.logger.log(`Room created: ${roomId} by ${dbPlayer.username}`);
    return room;
  }

  async joinRoom(roomId: string, playerId: string, socketId: string): Promise<GameRoom | null> {
    const existingRoom = this.rooms.get(roomId);

    if (existingRoom) {
      const joined = await this.joinExistingRoom(existingRoom, playerId, socketId);
      if (joined) return joined;
      // Fall through: the room exists but this player has no seat in it. For a
      // tournament game that may still be resolvable from the database below.
    }

    return this.joinTournamentGameFromDb(roomId, playerId, socketId);
  }

  /** Seats a player in a room that is already in memory. Returns null if they have no seat. */
  private async joinExistingRoom(
    room: GameRoom,
    playerId: string,
    socketId: string,
  ): Promise<GameRoom | null> {
    // Reconnecting, or claiming a slot that was pre-allocated for them.
    const existingPlayer = room.players.find((p) => p.id === playerId || p.socketId === socketId);

    if (existingPlayer) {
      existingPlayer.socketId = socketId;
      this.logger.log(`${existingPlayer.username} reconnected to ${room.id} as player ${existingPlayer.role}`);
      return room;
    }

    // Every seat is taken by somebody else.
    if (room.players.length >= 2) {
      this.logger.log(`Room ${room.id} already has two players`);
      return null;
    }

    const dbPlayer = await this.prisma.player.findUnique({ where: { token: playerId } });
    if (!dbPlayer) {
      throw new Error('Player not found. Please create a profile first.');
    }

    room.players.push(this.toRoomPlayer(dbPlayer, playerId, 'two', socketId));
    this.logger.log(`${dbPlayer.username} joined room ${room.id} as player two`);
    return room;
  }

  /**
   * Materialises a tournament game room from the database. This is what happens when
   * the first player opens a game the tournament scheduler created, and also what
   * happens when a room is rebuilt after the server restarted mid-game.
   */
  private async joinTournamentGameFromDb(
    roomId: string,
    playerId: string,
    socketId: string,
  ): Promise<GameRoom | null> {
    let dbGame;
    try {
      dbGame = await this.prisma.game.findUnique({
        where: { id: roomId },
        include: { playerOne: true, playerTwo: true, tournament: true },
      });
    } catch (error) {
      this.logger.error(`Error loading game ${roomId} from database`, error as Error);
      return null;
    }

    if (!dbGame || dbGame.status !== 'IN_PROGRESS') return null;

    const joiningPlayer = await this.prisma.player.findUnique({ where: { token: playerId } });
    if (!joiningPlayer) {
      this.logger.warn(`Player with token ${playerId} not found`);
      return null;
    }

    const role = this.roleInDbGame(joiningPlayer.id, dbGame.playerOneId, dbGame.playerTwoId);
    if (!role) {
      this.logger.warn(`${joiningPlayer.username} is not a participant in game ${roomId}`);
      return null;
    }

    if (dbGame.tournamentId) {
      const tournamentPlayer = await this.prisma.tournamentPlayer.findFirst({
        where: { tournamentId: dbGame.tournamentId, playerId: joiningPlayer.id },
      });

      if (tournamentPlayer?.isEliminated) {
        this.logger.log(`${joiningPlayer.username} is eliminated from the tournament`);
        return null;
      }
    }

    const room = this.rooms.get(roomId) ?? this.buildRoomFromDbGame(dbGame);

    const seat = room.players.find((p) => p.role === role);
    if (!seat) return null;

    // Bind the seat to this connection. The seat starts out keyed by database id
    // and is re-keyed to the player's token once they actually connect.
    seat.id = playerId;
    seat.dbId = joiningPlayer.id;
    seat.socketId = socketId;

    this.rooms.set(roomId, room);
    this.logger.log(`${joiningPlayer.username} seated in tournament game ${roomId} as player ${role}`);
    return room;
  }

  private buildRoomFromDbGame(dbGame: {
    id: string;
    boardState: unknown;
    isDraw: boolean;
    createdAt: Date;
    tournamentId: string | null;
    playerOneId: string;
    playerTwoId: string;
    playerOne: { username: string; avatar: string | null; avatarType: string | null };
    playerTwo: { username: string; avatar: string | null; avatarType: string | null };
    tournament: { moveTimeoutSeconds: number } | null;
  }): GameRoom {
    // Rebuild the full game state from the persisted board rather than assuming a
    // fresh game. Getting this wrong is what made resumed games hand the turn back
    // to player one and forget a finished result.
    const board = normaliseBoard(dbGame.boardState);
    const win = checkWinner(board);

    const room: GameRoom = {
      id: dbGame.id,
      players: [
        this.toRoomPlayer(
          { ...dbGame.playerOne, id: dbGame.playerOneId },
          dbGame.playerOneId,
          'one',
          '',
        ),
        this.toRoomPlayer(
          { ...dbGame.playerTwo, id: dbGame.playerTwoId },
          dbGame.playerTwoId,
          'two',
          '',
        ),
      ],
      board,
      currentTurn: deriveCurrentTurn(board),
      winner: win?.winner ?? null,
      winningLine: win?.line ?? null,
      isDraw: win ? false : dbGame.isDraw || checkDraw(board),
      createdAt: dbGame.createdAt,
      tournamentId: dbGame.tournamentId ?? undefined,
      moveTimeoutSeconds: dbGame.tournament?.moveTimeoutSeconds ?? 30,
    };

    return room;
  }

  private roleInDbGame(
    dbPlayerId: string,
    playerOneId: string,
    playerTwoId: string,
  ): PlayerRole | null {
    if (dbPlayerId === playerOneId) return 'one';
    if (dbPlayerId === playerTwoId) return 'two';
    return null;
  }

  private toRoomPlayer(
    dbPlayer: { id: string; username: string; avatar: string | null; avatarType: string | null },
    id: string,
    role: PlayerRole,
    socketId: string,
  ): Player {
    return {
      id,
      dbId: dbPlayer.id,
      username: dbPlayer.username,
      avatar: dbPlayer.avatar ?? undefined,
      avatarType: dbPlayer.avatarType ?? undefined,
      role,
      color: ROLE_COLOR[role],
      socketId,
    };
  }

  getRoom(roomId: string): GameRoom | null {
    return this.rooms.get(roomId) || null;
  }

  /** How many seats in the room currently have a live socket attached. */
  connectedCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    return room.players.filter((p) => p.socketId !== '').length;
  }

  /** True when the given database player id is seated and connected. */
  isConnectedByDbId(roomId: string, dbPlayerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.players.some((p) => p.dbId === dbPlayerId && p.socketId !== '');
  }

  // ---------------------------------------------------------------------------
  // Gameplay
  // ---------------------------------------------------------------------------

  makeMove(roomId: string, playerId: string, columnIndex: number): MoveResult {
    const room = this.rooms.get(roomId);

    if (!room) return this.failedMove(null, 'Room not found');

    // Order matters: a finished game is reported as finished, not as "not your
    // turn", so the client can show the right thing to the losing player.
    if (room.winner || room.isDraw) return this.failedMove(room, 'Game already finished');

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return this.failedMove(room, 'Player not in room');

    if (player.role !== room.currentTurn) return this.failedMove(room, 'Not your turn');

    if (!isValidColumn(columnIndex)) return this.failedMove(room, 'Invalid column');

    const targetRow = findDropRow(room.board, columnIndex);
    if (targetRow === -1) return this.failedMove(room, 'Column is full');

    room.board[targetRow][columnIndex] = player.color;

    // The move landed, so the current player is no longer on the clock.
    this.clearMoveTimer(roomId);

    const winResult = checkWinner(room.board);
    if (winResult) {
      room.winner = winResult.winner;
      room.winningLine = winResult.line;
    } else if (checkDraw(room.board)) {
      room.isDraw = true;
    } else {
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

  /**
   * Ends a game without a move being played (move timeout, forfeit). Recording the
   * result on the room is what stops play continuing on a game the server has
   * already reported as over.
   */
  endGame(roomId: string, winner: PlayerRole | null, isDraw = false): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (room.winner || room.isDraw) return false; // already finished - stay idempotent

    this.clearMoveTimer(roomId);
    room.winner = winner;
    room.isDraw = isDraw;
    this.rooms.set(roomId, room);
    return true;
  }

  private failedMove(room: GameRoom | null, error: string): MoveResult {
    return {
      success: false,
      board: room?.board ?? [],
      currentTurn: room?.currentTurn ?? 'one',
      winner: room?.winner ?? null,
      winningLine: room?.winningLine ?? null,
      isDraw: room?.isDraw ?? false,
      error,
    };
  }

  resetGame(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    this.clearMoveTimer(roomId);

    room.board = createEmptyBoard();
    room.currentTurn = 'one';
    room.winner = null;
    room.winningLine = null;
    room.isDraw = false;

    this.rooms.set(roomId, room);
    return true;
  }

  /**
   * Builds the state sent to clients. Player details come from the room itself -
   * they were read from the database when the seat was created, so there is no
   * per-request lookup here and no dependency on whether the seat is currently
   * keyed by token or by database id.
   */
  getGameState(roomId: string): GameState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const publicPlayer = (player: Player | undefined): PublicPlayer | null =>
      player
        ? {
            id: player.id,
            role: player.role,
            connected: player.socketId !== '',
            username: player.username,
            avatar: player.avatar,
            avatarType: player.avatarType,
          }
        : null;

    return {
      board: room.board,
      currentTurn: room.currentTurn,
      winner: room.winner,
      winningLine: room.winningLine,
      isDraw: room.isDraw,
      players: {
        playerOne: publicPlayer(room.players.find((p) => p.role === 'one')),
        playerTwo: publicPlayer(room.players.find((p) => p.role === 'two')),
      },
    };
  }

  /** Persists the board so a tournament game survives a room eviction or restart. */
  async persistBoard(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    try {
      await this.prisma.game.update({
        where: { id: roomId },
        data: { boardState: room.board as unknown as object },
      });
    } catch {
      // Casual rooms have no database row; that is expected and not an error.
    }
  }

  // ---------------------------------------------------------------------------
  // Disconnects
  // ---------------------------------------------------------------------------

  /**
   * Marks a socket's seat as disconnected. The room is deliberately kept in memory
   * so the player can reconnect and so a second player can still join a room whose
   * creator briefly dropped; reaping empty rooms is the gateway's job.
   */
  removePlayerFromRoom(socketId: string): { roomId: string; remainingPlayers: number } | null {
    for (const [roomId, room] of this.rooms.entries()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (!player) continue;

      player.socketId = '';
      return { roomId, remainingPlayers: this.connectedCount(roomId) };
    }
    return null;
  }

  removeRoom(roomId: string): void {
    this.clearMoveTimer(roomId);
    this.clearForfeitTimer(roomId);
    this.rooms.delete(roomId);
    this.logger.log(`Room ${roomId} removed`);
  }

  // ---------------------------------------------------------------------------
  // Forfeit timers (waiting for players to show up to a scheduled game)
  // ---------------------------------------------------------------------------

  clearForfeitTimer(roomId: string): void {
    const timer = this.forfeitTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.forfeitTimers.delete(roomId);
      this.logger.log(`Cleared forfeit timer for room ${roomId}`);
    }
  }

  setForfeitTimer(
    roomId: string,
    callback: () => void,
    timeout: number = this.TOURNAMENT_JOIN_TIMEOUT,
  ): void {
    this.clearForfeitTimer(roomId);

    const timer = setTimeout(() => {
      this.forfeitTimers.delete(roomId);
      callback();
    }, timeout);

    this.forfeitTimers.set(roomId, timer);
    this.logger.log(`Set forfeit timer for room ${roomId} (${timeout}ms)`);
  }

  // ---------------------------------------------------------------------------
  // Move timers
  // ---------------------------------------------------------------------------

  startMoveTimer(roomId: string, timeoutSeconds: number, onTimeout: () => void): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.clearMoveTimer(roomId);

    room.moveStartTime = new Date();
    room.moveTimeoutSeconds = timeoutSeconds;
    room.moveTimer = setTimeout(() => {
      room.moveTimer = undefined;
      onTimeout();
    }, timeoutSeconds * 1000);

    this.rooms.set(roomId, room);
    this.logger.log(`Started ${timeoutSeconds}s move timer for room ${roomId}`);
  }

  clearMoveTimer(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.moveTimer) {
      clearTimeout(room.moveTimer);
      room.moveTimer = undefined;
    }
    room.moveStartTime = undefined;
  }

  /** Seconds left on the current move, or null when no timer is running. */
  getRemainingTime(roomId: string): number | null {
    const room = this.rooms.get(roomId);
    if (!room?.moveStartTime || !room.moveTimeoutSeconds) return null;

    const elapsed = Date.now() - room.moveStartTime.getTime();
    return Math.max(0, Math.ceil((room.moveTimeoutSeconds * 1000 - elapsed) / 1000));
  }

  pauseMoveTimer(roomId: string): number | null {
    const room = this.rooms.get(roomId);
    if (!room?.moveTimer) return null;

    const remaining = this.getRemainingTime(roomId);
    this.clearMoveTimer(roomId);
    this.logger.log(`Paused move timer for room ${roomId}, ${remaining}s remaining`);
    return remaining;
  }

  resumeMoveTimer(roomId: string, remainingSeconds: number, onTimeout: () => void): void {
    this.startMoveTimer(roomId, remainingSeconds, onTimeout);
    this.logger.log(`Resumed move timer for room ${roomId}, ${remainingSeconds}s remaining`);
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}
