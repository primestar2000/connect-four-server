import { Injectable, Logger } from '@nestjs/common';

interface WaitingPlayer {
  socketId: string;
  playerId: string;
  joinedAt: Date;
}

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);
  private waitingPlayers: WaitingPlayer[] = [];

  addToQueue(socketId: string, playerId: string): void {
    if (this.waitingPlayers.some((p) => p.socketId === socketId)) return;

    this.waitingPlayers.push({ socketId, playerId, joinedAt: new Date() });
    this.logger.log(`Player queued. Queue size: ${this.waitingPlayers.length}`);
  }

  removeFromQueue(socketId: string): boolean {
    const index = this.waitingPlayers.findIndex((p) => p.socketId === socketId);
    if (index === -1) return false;

    this.waitingPlayers.splice(index, 1);
    this.logger.log(`Player left queue. Queue size: ${this.waitingPlayers.length}`);
    return true;
  }

  /**
   * Returns the two longest-waiting players *without* removing them. The caller
   * removes them only once it has actually created a game, so a failure part-way
   * through does not quietly swallow both players.
   */
  peekMatch(): { player1: WaitingPlayer; player2: WaitingPlayer } | null {
    if (this.waitingPlayers.length < 2) return null;
    return { player1: this.waitingPlayers[0], player2: this.waitingPlayers[1] };
  }

  getQueueSize(): number {
    return this.waitingPlayers.length;
  }

  isInQueue(socketId: string): boolean {
    return this.waitingPlayers.some((p) => p.socketId === socketId);
  }
}
