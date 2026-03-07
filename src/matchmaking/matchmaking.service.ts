import { Injectable } from '@nestjs/common';

interface WaitingPlayer {
  socketId: string;
  playerId: string;
  joinedAt: Date;
}

@Injectable()
export class MatchmakingService {
  private waitingPlayers: WaitingPlayer[] = [];

  addToQueue(socketId: string, playerId: string): void {
    // Check if player is already in queue
    const existingIndex = this.waitingPlayers.findIndex((p) => p.socketId === socketId);

    if (existingIndex !== -1) {
      return; // Already in queue
    }

    this.waitingPlayers.push({
      socketId,
      playerId,
      joinedAt: new Date(),
    });

    console.log(
      `Player ${playerId} added to matchmaking queue. Queue size: ${this.waitingPlayers.length}`,
    );
  }

  removeFromQueue(socketId: string): boolean {
    const index = this.waitingPlayers.findIndex((p) => p.socketId === socketId);

    if (index !== -1) {
      const removed = this.waitingPlayers.splice(index, 1)[0];
      console.log(
        `Player ${removed.playerId} removed from queue. Queue size: ${this.waitingPlayers.length}`,
      );
      return true;
    }

    return false;
  }

  findMatch(): { player1: WaitingPlayer; player2: WaitingPlayer } | null {
    if (this.waitingPlayers.length < 2) {
      return null;
    }

    // Get the two players who have been waiting the longest
    const player1 = this.waitingPlayers.shift()!;
    const player2 = this.waitingPlayers.shift()!;

    console.log(
      `Match found: ${player1.playerId} vs ${player2.playerId}. Queue size: ${this.waitingPlayers.length}`,
    );

    return { player1, player2 };
  }

  getQueueSize(): number {
    return this.waitingPlayers.length;
  }

  isInQueue(socketId: string): boolean {
    return this.waitingPlayers.some((p) => p.socketId === socketId);
  }
}
