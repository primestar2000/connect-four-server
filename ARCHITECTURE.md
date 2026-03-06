# Backend Architecture

## Tech Stack

- **NestJS** - Progressive Node.js framework
- **Socket.IO** - Real-time WebSocket communication
- **TypeScript** - Strict typing with no `any` types

## Project Structure

```
connect-four-server/
├── src/
│   ├── game/
│   │   ├── game.gateway.ts    # WebSocket event handlers
│   │   ├── game.service.ts    # Game logic & state management
│   │   └── game.module.ts     # NestJS module definition
│   ├── types/
│   │   └── game.types.ts      # Shared type definitions
│   ├── app.module.ts          # Root module
│   └── main.ts                # Application entry point
├── tsconfig.json              # TypeScript configuration
├── .eslintrc.js               # ESLint rules
└── package.json               # Dependencies & scripts
```

## Core Components

### GameGateway (`game.gateway.ts`)

WebSocket gateway handling client connections and events:

- `handleConnection` - New client connects
- `handleDisconnect` - Client disconnects (cleanup rooms)
- `handleCreateRoom` - Create new game room
- `handleJoinRoom` - Join existing room
- `handleMakeMove` - Process player move
- `handleResetGame` - Reset game state
- `handleGetGameState` - Retrieve current state

### GameService (`game.service.ts`)

Business logic and state management:

- `createRoom()` - Initialize new game room
- `joinRoom()` - Add player to room
- `makeMove()` - Validate and execute move
- `checkWinner()` - Detect winning condition
- `resetGame()` - Clear board state
- `removePlayerFromRoom()` - Handle disconnections

### Type Definitions (`game.types.ts`)

Strongly typed interfaces:

- `GameRoom` - Room state with players and board
- `GameState` - Current game snapshot
- `Player` - Player information
- `MoveResult` - Move validation result
- `CellColor` - Board cell type

## Game Flow

1. **Room Creation**
   - Player 1 creates room → receives room ID
   - Room stored in memory with empty board
   - Player 1 assigned red color, role "one"

2. **Room Joining**
   - Player 2 joins with room ID
   - Assigned yellow color, role "two"
   - Both players receive initial game state

3. **Gameplay**
   - Players take turns making moves
   - Server validates: correct turn, valid column, not full
   - Move broadcast to both players
   - Winner detection after each move

4. **Game End**
   - Winner detected → game state frozen
   - Players can reset to play again
   - Disconnect → room cleaned up

## State Management

- **In-Memory Storage**: `Map<roomId, GameRoom>`
- **Room Lifecycle**: Created → Active → Deleted on disconnect
- **No Persistence**: Rooms exist only while players connected

## Validation

- Turn validation (only current player can move)
- Column validation (not full)
- Game state validation (not already won)
- Room existence validation

## Error Handling

- Invalid room ID → error response
- Full column → error response
- Wrong turn → error response
- Disconnection → cleanup and notify

## Type Safety

Strict TypeScript configuration:
```json
{
  "noImplicitAny": true,
  "strict": true,
  "strictNullChecks": true
}
```

ESLint rule enforced:
```javascript
'@typescript-eslint/no-explicit-any': 'error'
```

## Scalability Considerations

Current implementation:
- Single server instance
- In-memory state
- No persistence

For production scale:
- Add Redis for shared state
- Implement room persistence
- Add horizontal scaling
- Implement reconnection logic
- Add rate limiting
