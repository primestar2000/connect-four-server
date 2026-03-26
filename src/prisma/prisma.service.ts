import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Configure connection pool for Supabase pooler
      // Supabase Session mode has limited connections (typically 3-15)
      log: ['error', 'warn'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    console.log('Prisma connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    console.log('Prisma disconnected from database');
  }

  // Helper to ensure connections are properly released
  async cleanupIdleConnections(): Promise<void> {
    try {
      await this.$disconnect();
      await this.$connect();
      console.log('Prisma connection pool refreshed');
    } catch (error) {
      console.error('Error refreshing connection pool:', error);
    }
  }
}
