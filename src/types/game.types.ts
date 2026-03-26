export type CellColor = 'red' | 'yellow' | null;
export type PlayerRole = 'one' | 'two';
export type GameBoard = CellColor[][];

// Move timer configuration constants
export const MOVE_TIMEOUT = {
  DEFAULT_CASUAL: 60, // 1 minute
  DEFAULT_MATCHMAKING: 45, // 45 seconds
  DEFAULT_TOURNAMENT: 30, // 30 seconds
  MIN: 10, // 10 seconds minimum
  MAX: 120, // 2 minutes maximum

  // Grace periods for disconnection (milliseconds)
  GRACE_PERIOD_CASUAL: 30000, // 30 seconds
  GRACE_PERIOD_TOURNAMENT: 15000, // 15 seconds
  GRACE_PERIOD_MATCHMAKING: 20000, // 20 seconds

  // Warning thresholds (seconds)
  WARNING_THRESHOLD: 10, // Show warning at 10s
  CRITICAL_THRESHOLD: 5, // Critical warning at 5s
};

export interface Player {
  id: string; // token
  username: string;
  avatar?: string;
  avatarType?: string;
  role: PlayerRole;
  color: 'red' | 'yellow';
  socketId: string;
}

export interface GameRoom {
  id: string;
  players: Player[];
  board: GameBoard;
  currentTurn: PlayerRole;
  winner: PlayerRole | null;
  winningLine: [number, number][] | null;
  isDraw: boolean;
  createdAt: Date;

  // Timer fields
  moveTimer?: NodeJS.Timeout;
  moveStartTime?: Date;
  moveTimeoutSeconds?: number;
  tournamentId?: string;
}

export interface CreateRoomResponse {
  roomId: string;
  playerId: string;
  playerRole: PlayerRole;
}

export interface JoinRoomResponse {
  roomId: string;
  playerId: string;
  playerRole: PlayerRole;
  gameState: GameState;
}

export interface GameState {
  board: GameBoard;
  currentTurn: PlayerRole;
  winner: PlayerRole | null;
  winningLine: [number, number][] | null;
  isDraw: boolean;
  players: {
    playerOne: {
      id: string;
      connected: boolean;
      username: string;
      avatar?: string;
      avatarType?: string;
    } | null;
    playerTwo: {
      id: string;
      connected: boolean;
      username: string;
      avatar?: string;
      avatarType?: string;
    } | null;
  };
}

export interface MakeMovePayload {
  roomId: string;
  playerId: string;
  columnIndex: number;
}

export interface MoveResult {
  success: boolean;
  board: GameBoard;
  currentTurn: PlayerRole;
  winner: PlayerRole | null;
  winningLine: [number, number][] | null;
  isDraw: boolean;
  columnIndex?: number;
  rowIndex?: number;
  error?: string;
}
