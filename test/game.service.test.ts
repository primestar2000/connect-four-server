/**
 * Scenario checks for GameService, run against an in-memory stand-in for the
 * database. These cover turn order, move validation, what survives a disconnect,
 * and resuming a tournament game from its persisted board.
 *
 * Run with:  npm run test:game
 */
import { GameService } from '../src/game/game.service';
import type { PrismaService } from '../src/prisma/prisma.service';

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

const players = [
  { id: 'db-alice', token: 'tok-alice', username: 'Alice', avatar: null, avatarType: null },
  { id: 'db-bob', token: 'tok-bob', username: 'Bob', avatar: null, avatarType: null },
];

/** A board with red and yellow alternating along the bottom row: r y r -> yellow to move. */
const resumedBoard = [
  [null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
  ['red', 'yellow', 'red', null, null, null, null],
];

const tournamentGame = {
  id: 'game-1',
  status: 'IN_PROGRESS',
  boardState: resumedBoard,
  isDraw: false,
  createdAt: new Date(),
  tournamentId: 'tourney-1',
  playerOneId: 'db-alice',
  playerTwoId: 'db-bob',
  playerOne: players[0],
  playerTwo: players[1],
  tournament: { id: 'tourney-1', moveTimeoutSeconds: 30 },
};

const prisma = {
  player: {
    findUnique: async ({ where }: any) =>
      players.find((p) => p.token === where.token || p.id === where.id) ?? null,
  },
  game: {
    findUnique: async ({ where }: any) => (where.id === tournamentGame.id ? tournamentGame : null),
    update: async () => ({}),
  },
  tournamentPlayer: {
    findFirst: async () => ({ isEliminated: false }),
  },
} as unknown as PrismaService;

async function main() {
  // ---------------------------------------------------------------- casual room
  const service = new GameService(prisma);

  const room = await service.createRoom('tok-alice', 'socket-alice');
  check('creator is seated as player one', room.players[0].role, 'one');
  check('creator keeps their database id', room.players[0].dbId, 'db-alice');

  await service.joinRoom(room.id, 'tok-bob', 'socket-bob');
  check('second player is seated as player two', service.getRoom(room.id)!.players[1].role, 'two');
  check('two players connected', service.connectedCount(room.id), 2);

  // Turn order and validation.
  check('player two cannot move first', service.makeMove(room.id, 'tok-bob', 3).error, 'Not your turn');
  check('out-of-range column rejected', service.makeMove(room.id, 'tok-alice', 9).error, 'Invalid column');
  check('negative column rejected', service.makeMove(room.id, 'tok-alice', -1).error, 'Invalid column');
  check('stranger cannot move', service.makeMove(room.id, 'tok-nobody', 0).error, 'Player not in room');

  const first = service.makeMove(room.id, 'tok-alice', 3);
  check('first move succeeds', first.success, true);
  check('first move lands on the bottom row', first.rowIndex, 5);
  check('turn passes to player two', first.currentTurn, 'two');

  // Play out a win for player one along the bottom row.
  service.makeMove(room.id, 'tok-bob', 0);
  service.makeMove(room.id, 'tok-alice', 4);
  service.makeMove(room.id, 'tok-bob', 0);
  service.makeMove(room.id, 'tok-alice', 5);
  service.makeMove(room.id, 'tok-bob', 0);
  const winning = service.makeMove(room.id, 'tok-alice', 6);
  check('player one wins with four in a row', winning.winner, 'one');
  check('winning line is reported', winning.winningLine?.length, 4);

  // A finished game says so, rather than blaming the turn order.
  check(
    'moves after the game ends are refused as finished',
    service.makeMove(room.id, 'tok-bob', 1).error,
    'Game already finished',
  );

  service.resetGame(room.id);
  check('reset clears the winner', service.getRoom(room.id)!.winner, null);
  check('reset returns the turn to player one', service.getRoom(room.id)!.currentTurn, 'one');

  // ------------------------------------------------------- disconnect behaviour
  const dropped = service.removePlayerFromRoom('socket-alice');
  check('disconnect is attributed to the right room', dropped?.roomId, room.id);
  check('one player remains connected', dropped?.remainingPlayers, 1);
  check('the room survives a disconnect', service.getRoom(room.id) !== null, true);
  check('the seat is kept for a reconnect', service.getRoom(room.id)!.players.length, 2);

  service.removePlayerFromRoom('socket-bob');
  check(
    'the room survives even when everyone has left, so players can return',
    service.getRoom(room.id) !== null,
    true,
  );
  check('nobody is connected', service.connectedCount(room.id), 0);

  await service.joinRoom(room.id, 'tok-alice', 'socket-alice-2');
  check('a player can rejoin their old room', service.connectedCount(room.id), 1);
  check('rejoining does not create a third seat', service.getRoom(room.id)!.players.length, 2);

  // ------------------------------------------------- resuming a tournament game
  const resumed = new GameService(prisma);
  const tRoom = await resumed.joinRoom('game-1', 'tok-bob', 'socket-bob');

  check('the tournament game is loaded', tRoom?.id, 'game-1');
  check(
    'the persisted board is restored',
    tRoom!.board[5].slice(0, 3),
    ['red', 'yellow', 'red'],
  );
  check('the turn is restored from the board, not reset to player one', tRoom!.currentTurn, 'two');
  check('the joining player takes their own seat', tRoom!.players[1].socketId, 'socket-bob');
  check('the absent player has no socket yet', tRoom!.players[0].socketId, '');
  check('the absent seat still knows its database id', tRoom!.players[0].dbId, 'db-alice');
  check(
    'forfeit checks can find a connected player by database id',
    resumed.isConnectedByDbId('game-1', 'db-bob'),
    true,
  );
  check(
    'forfeit checks see the absent player as absent',
    resumed.isConnectedByDbId('game-1', 'db-alice'),
    false,
  );

  // A player who has not joined the room cannot move in it.
  check(
    'a player who has not joined cannot move',
    resumed.makeMove('game-1', 'tok-alice', 0).error,
    'Player not in room',
  );

  await resumed.joinRoom('game-1', 'tok-alice', 'socket-alice');
  check('both players are now connected', resumed.connectedCount('game-1'), 2);
  check(
    'the player who moved last is still not on the clock',
    resumed.makeMove('game-1', 'tok-alice', 0).error,
    'Not your turn',
  );

  // The whole point of restoring the turn: play continues where it left off.
  const resumedMove = resumed.makeMove('game-1', 'tok-bob', 3);
  check('the player whose turn it is can move', resumedMove.success, true);
  check('their piece is yellow', resumedMove.board[5][3], 'yellow');
  check('the turn then passes back', resumedMove.currentTurn, 'one');

  const state = resumed.getGameState('game-1');
  check('game state names both players', [state!.players.playerOne!.username, state!.players.playerTwo!.username], ['Alice', 'Bob']);
  check('game state reports connection status', [state!.players.playerOne!.connected, state!.players.playerTwo!.connected], [true, true]);

  // ------------------------------------------------------- ending without a move
  check('a game can be ended by forfeit', resumed.endGame('game-1', 'two'), true);
  check('ending an already finished game is a no-op', resumed.endGame('game-1', 'one'), false);
  check('the forfeit winner stands', resumed.getRoom('game-1')!.winner, 'two');

  console.log(failures === 0 ? '\nAll scenario checks passed.' : `\n${failures} scenario check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
