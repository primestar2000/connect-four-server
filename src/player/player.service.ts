import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlayerService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlayer(username: string) {
    try {
      const player = await this.prisma.player.create({
        data: {
          username,
        },
      });
      return player;
    } catch (error) {
      // If username already exists, return existing player
      const existingPlayer = await this.prisma.player.findUnique({
        where: { username },
      });

      if (existingPlayer) {
        return existingPlayer;
      }

      throw error;
    }
  }

  async getPlayer(playerId: string) {
    return this.prisma.player.findUnique({
      where: { id: playerId },
    });
  }

  async getPlayerByUsername(username: string) {
    return this.prisma.player.findUnique({
      where: { username },
    });
  }

  async listPlayers() {
    return this.prisma.player.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
