import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

export interface CreateAnonymousPlayerDto {
  username: string;
  avatar?: string;
  avatarType?: string;
}

export interface LinkAccountDto {
  token: string;
  email: string;
  password: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

@Injectable()
export class PlayerService {
  constructor(private readonly prisma: PrismaService) {}

  // Create anonymous player with token
  async createAnonymousPlayer(data: CreateAnonymousPlayerDto) {
    console.log('🔍 [DEBUG] createAnonymousPlayer called');
    console.log('🔍 [DEBUG] Username:', data.username);
    console.log('🔍 [DEBUG] Avatar type:', data.avatarType);

    const player = await this.prisma.player.create({
      data: {
        username: data.username,
        avatar: data.avatar,
        avatarType: data.avatarType || 'emoji',
        isAnonymous: true,
      },
    });

    console.log('🔍 [DEBUG] Player created successfully');
    console.log('🔍 [DEBUG] Player ID:', player.id);
    console.log('🔍 [DEBUG] Player token:', player.token);

    return player;
  }

  // Get player by token
  async getPlayerByToken(token: string) {
    return this.prisma.player.findUnique({
      where: { token },
      select: {
        id: true,
        token: true,
        username: true,
        avatar: true,
        avatarType: true,
        email: true,
        isAnonymous: true,
        createdAt: true,
      },
    });
  }

  // Update player profile
  async updatePlayer(
    token: string,
    data: { username?: string; avatar?: string; avatarType?: string },
  ) {
    return this.prisma.player.update({
      where: { token },
      data,
      select: {
        id: true,
        token: true,
        username: true,
        avatar: true,
        avatarType: true,
        email: true,
        isAnonymous: true,
      },
    });
  }

  // Link anonymous account to email/password
  async linkAccount(data: LinkAccountDto) {
    const player = await this.getPlayerByToken(data.token);
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    if (!player.isAnonymous) {
      throw new ConflictException('Account already linked');
    }

    // Check if email already exists
    const existingEmail = await this.prisma.player.findUnique({
      where: { email: data.email },
    });

    if (existingEmail) {
      throw new ConflictException('Email already in use');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Update player to linked account
    return this.prisma.player.update({
      where: { token: data.token },
      data: {
        email: data.email,
        password: hashedPassword,
        isAnonymous: false,
      },
      select: {
        id: true,
        token: true,
        username: true,
        avatar: true,
        avatarType: true,
        email: true,
        isAnonymous: true,
      },
    });
  }

  // Login with email/password
  async login(data: LoginDto) {
    const player = await this.prisma.player.findUnique({
      where: { email: data.email },
    });

    if (!player || !player.password) {
      throw new NotFoundException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(data.password, player.password);
    if (!isPasswordValid) {
      throw new NotFoundException('Invalid credentials');
    }

    return {
      id: player.id,
      token: player.token,
      username: player.username,
      avatar: player.avatar,
      avatarType: player.avatarType,
      email: player.email,
      isAnonymous: player.isAnonymous,
    };
  }

  // Legacy methods for backward compatibility
  async getPlayer(playerId: string) {
    return this.prisma.player.findUnique({
      where: { id: playerId },
    });
  }

  async getPlayerByUsername(username: string) {
    return this.prisma.player.findFirst({
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
