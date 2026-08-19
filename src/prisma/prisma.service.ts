import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // The connection URL comes from `env("DATABASE_URL")` in schema.prisma.
    // Overriding `datasources` here as well meant the same setting was declared in
    // two places that could quietly disagree, and it bypassed the schema's
    // datasource block entirely.
    super({
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
