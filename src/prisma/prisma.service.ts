import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
    console.log('Prisma connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    console.log('Prisma disconnected from database');
  }
}
