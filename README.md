# Connect Four - NestJS WebSocket Server

Real-time multiplayer backend for Connect Four game using NestJS and Socket.IO.

## Features

- Real-time WebSocket communication
- Room-based multiplayer
- Game state synchronization
- Move validation
- Winner detection
- Strict TypeScript typing (no `any` types)

## Installation

```bash
npm install
```

## Running the Server

Development mode:
```bash
npm run start:dev
```

Production mode:
```bash
npm run build
npm run start:prod
```

## Scripts

- `npm run build` - Build the project
- `npm run start:dev` - Start in watch mode
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## WebSocket Events

### Client → Server

- `createRoom` - Create a new game room
- `joinRoom` - Join an existing room
- `makeMove` - Make a move in the game
- `resetGame` - Reset the game board
- `getGameState` - Get current game state

### Server → Client

- `moveMade` - Broadcast when a move is made
- `opponentJoined` - Notify when opponent joins
- `playerDisconnected` - Notify when player disconnects
- `gameReset` - Notify when game is reset

## Server Configuration

Default port: `3001`
CORS: Enabled for all origins

## Type Safety

This project uses strict TypeScript configuration with:
- `noImplicitAny: true`
- `strict: true`
- ESLint rule: `@typescript-eslint/no-explicit-any: error`
