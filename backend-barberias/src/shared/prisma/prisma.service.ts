import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ['query', 'warn', 'error'],
    });
  }

  async onModuleInit() {
    let retries = 3;
    while (retries > 0) {
      try {
        await this.$connect();
        break;
      } catch (error: any) {
        retries--;
        this.logger.warn(
          `Conexión con Neon Postgres en espera o suspendida: ${error.message}. Reintentando despertar el pooler... (${retries} restantes)`,
        );
        if (retries === 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
