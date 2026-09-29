import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const dbUrl = process.env.DATABASE_URL;
    let urlWithPool = dbUrl;
    if (dbUrl && !dbUrl.includes('connection_limit=')) {
      const separator = dbUrl.includes('?') ? '&' : '?';
      urlWithPool = `${dbUrl}${separator}connection_limit=25&pool_timeout=20`;
    }

    super({
      datasources: urlWithPool ? { db: { url: urlWithPool } } : undefined,
      log: process.env.DEBUG_PRISMA === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
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
