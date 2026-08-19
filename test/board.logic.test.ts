/**
 * Rules checks for the board logic - the part of the game that decides who has won,
 * whose turn it is, and where a piece lands.
 *
 * Run with:  npm run test:logic
 *
 * These are plain assertions with no test framework, so they can be run against a
 * checkout without any extra setup.
 */
import {
  checkDraw,
  checkWinner,
  createEmptyBoard,
  deriveCurrentTurn,
  findDropRow,
  isValidColumn,
  normaliseBoard,
} from '../src/game/board.logic';
import type { GameBoard } from '../src/types/game.types';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

/** Build a board from rows of characters: '.' empty, 'r' red, 'y' yellow. */
function board(...rows: string[]): GameBoard {
  const b = createEmptyBoard();
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      b[r][c] = ch === 'r' ? 'red' : ch === 'y' ? 'yellow' : null;
    }),
  );
  return b;
}

// --- geometry ---------------------------------------------------------------
check('empty board is 6x7', [createEmptyBoard().length, createEmptyBoard()[0].length], [6, 7]);
check('drop into empty column lands on the floor', findDropRow(createEmptyBoard(), 3), 5);
check('drop stacks on top of a piece', findDropRow(board('.......','.......','.......','.......','.......','...r...'), 3), 4);
check('full column reports -1', findDropRow(board('...r...','...y...','...r...','...y...','...r...','...y...'), 3), -1);
check('column 7 is out of bounds', findDropRow(createEmptyBoard(), 7), -1);
check('column -1 is out of bounds', findDropRow(createEmptyBoard(), -1), -1);
check('non-integer column rejected', isValidColumn(2.5), false);
check('string column rejected', isValidColumn('3'), false);

// --- win detection ----------------------------------------------------------
check('no winner on an empty board', checkWinner(createEmptyBoard()), null);
check('horizontal four for red', checkWinner(board('.......','.......','.......','.......','.......','..rrrr.'))?.winner, 'one');
check('vertical four for yellow', checkWinner(board('.......','.......','..y....','..y....','..y....','..y....'))?.winner, 'two');
check('down-right diagonal', checkWinner(board('.......','.......','r......','.r.....','..r....','...r...'))?.winner, 'one');
check('down-left diagonal', checkWinner(board('.......','.......','...y...','..y....','.y.....','y......'))?.winner, 'two');
check('three in a row is not a win', checkWinner(board('.......','.......','.......','.......','.......','..rrr..')), null);
check('four broken by a gap is not a win', checkWinner(board('.......','.......','.......','.......','.......','.rr.rr.')), null);
check('mixed colours are not a win', checkWinner(board('.......','.......','.......','.......','.......','.rryrr.')), null);
check('winning line has four cells', checkWinner(board('.......','.......','.......','.......','.......','..rrrr.'))?.line.length, 4);
check('win at the right edge', checkWinner(board('.......','.......','.......','.......','.......','...rrrr'))?.winner, 'one');

// --- draw -------------------------------------------------------------------
const fullNoWin = board(
  'yrryrry',
  'yrryrry',
  'ryyrryr',
  'ryyrryr',
  'yrryrry',
  'yrryrry',
);
check('full board is a draw', checkDraw(fullNoWin), true);
check('partially filled board is not a draw', checkDraw(board('.......','.......','.......','.......','.......','..rrr..')), false);

// --- turn derivation (the resumed-game fix) ---------------------------------
check('empty board: player one to move', deriveCurrentTurn(createEmptyBoard()), 'one');
check('after red moves: player two', deriveCurrentTurn(board('.......','.......','.......','.......','.......','...r...')), 'two');
check('after both move: player one', deriveCurrentTurn(board('.......','.......','.......','.......','.......','...ry..')), 'one');
check('mid-game odd count: player two', deriveCurrentTurn(board('.......','.......','.......','.......','...r...','..ryry.')), 'two');

// --- persisted board coercion ----------------------------------------------
check('null board state becomes empty', normaliseBoard(null), createEmptyBoard());
check('garbage board state becomes empty', normaliseBoard({ nope: true }), createEmptyBoard());
check('wrong-sized board becomes empty', normaliseBoard([[null]]), createEmptyBoard());
check('valid board round-trips', normaliseBoard(JSON.parse(JSON.stringify(fullNoWin))), fullNoWin);
check('unknown cell values become empty cells', normaliseBoard(
  JSON.parse(JSON.stringify(createEmptyBoard())).map((row: unknown[], r: number) =>
    r === 5 ? ['blue', ...row.slice(1)] : row,
  ),
), createEmptyBoard());

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
