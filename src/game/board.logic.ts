import { BOARD, CellColor, GameBoard, PlayerRole, ROLE_COLOR } from '../types/game.types';

/**
 * Pure board helpers. No state, no side effects - everything here is safe to call
 * from anywhere and easy to reason about in isolation.
 */

export function createEmptyBoard(): GameBoard {
  return Array.from({ length: BOARD.ROWS }, () =>
    Array.from({ length: BOARD.COLS }, () => null as CellColor),
  );
}

/**
 * Coerces an untrusted value (e.g. a JSON column loaded from the database) into a
 * board of the right shape. Anything that does not look like a board becomes an
 * empty board rather than corrupting the game.
 */
export function normaliseBoard(value: unknown): GameBoard {
  if (!Array.isArray(value) || value.length !== BOARD.ROWS) {
    return createEmptyBoard();
  }

  const board = createEmptyBoard();

  for (let r = 0; r < BOARD.ROWS; r++) {
    const row: unknown = value[r];
    if (!Array.isArray(row) || row.length !== BOARD.COLS) {
      return createEmptyBoard();
    }
    for (let c = 0; c < BOARD.COLS; c++) {
      const cell: unknown = row[c];
      board[r][c] = cell === 'red' || cell === 'yellow' ? cell : null;
    }
  }

  return board;
}

export function isValidColumn(columnIndex: unknown): columnIndex is number {
  return (
    typeof columnIndex === 'number' &&
    Number.isInteger(columnIndex) &&
    columnIndex >= 0 &&
    columnIndex < BOARD.COLS
  );
}

/**
 * Returns the row a piece dropped into `columnIndex` would land on,
 * or -1 when the column is full.
 */
export function findDropRow(board: GameBoard, columnIndex: number): number {
  if (!isValidColumn(columnIndex)) return -1;

  for (let r = BOARD.ROWS - 1; r >= 0; r--) {
    if (board[r][columnIndex] === null) return r;
  }
  return -1;
}

const DIRECTIONS: readonly [number, number][] = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal \
  [1, -1], // diagonal /
];

export function checkWinner(
  board: GameBoard,
): { winner: PlayerRole; line: [number, number][] } | null {
  for (let r = 0; r < BOARD.ROWS; r++) {
    for (let c = 0; c < BOARD.COLS; c++) {
      const cell = board[r][c];
      if (!cell) continue;

      for (const [dr, dc] of DIRECTIONS) {
        const line: [number, number][] = [[r, c]];

        for (let i = 1; i < BOARD.CONNECT; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (
            nr < 0 ||
            nr >= BOARD.ROWS ||
            nc < 0 ||
            nc >= BOARD.COLS ||
            board[nr][nc] !== cell
          ) {
            break;
          }
          line.push([nr, nc]);
        }

        if (line.length === BOARD.CONNECT) {
          return { winner: cell === ROLE_COLOR.one ? 'one' : 'two', line };
        }
      }
    }
  }
  return null;
}

export function checkDraw(board: GameBoard): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

export function countPieces(board: GameBoard, color: 'red' | 'yellow'): number {
  return board.reduce(
    (total, row) => total + row.filter((cell) => cell === color).length,
    0,
  );
}

/**
 * Works out whose turn it is purely from the board.
 *
 * Player one (red) always moves first, so the two colours are either level
 * (player one to move) or red is one ahead (player two to move). This is what
 * lets a game be resumed from its persisted board without the turn silently
 * resetting to player one.
 */
export function deriveCurrentTurn(board: GameBoard): PlayerRole {
  const red = countPieces(board, ROLE_COLOR.one);
  const yellow = countPieces(board, ROLE_COLOR.two);
  return red > yellow ? 'two' : 'one';
}
