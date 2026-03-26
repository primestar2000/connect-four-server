export type CellColor = 'red' | 'yellow' | null;
export type PlayerRole = 'one' | 'two';
export type GameBoard = CellColor[][];

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
