import { Controller, Get, OnModuleDestroy } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../iam/infrastructure/public.decorator.js';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../shared/prisma/prisma.service.js';
import Redis from 'ioredis';

@Controller()
export class HealthController implements OnModuleDestroy {
  private redisClient: Redis.default | null = null;

  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly memoryIndicator: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
  ) {
    if (process.env.REDIS_URL) {
      try {
        this.redisClient = new Redis.default(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          lazyConnect: true,
        });
      } catch {
        this.redisClient = null;
      }
    }
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // Ignorar si ya está desconectado
      }
    }
  }

  /**
   * Endpoint de monitoreo de salud con probes reales (MON-01 / Hallazgo 08).
   * Accesible públicamente tanto en /health (probes de Render/K8s) como en /api/v1/health.
   */
  @Public()
  @SkipThrottle()
  @Get(['health', 'api/v1/health'])
  @HealthCheck()
  async check() {
    return this.health.check([
      // 1. Verificación activa de PostgreSQL (Neon) mediante ping SQL
      () => this.prismaIndicator.pingCheck('database', this.prisma),

      // 2. Verificación activa de Redis (Upstash) mediante PING
      async () => {
        if (!this.redisClient) {
          return { redis: { status: 'up', note: 'Redis no configurado en este entorno' } };
        }
        try {
          if (this.redisClient.status !== 'ready') {
            await this.redisClient.connect();
          }
          const pong = await this.redisClient.ping();
          return {
            redis: {
              status: pong === 'PONG' ? 'up' : 'down',
            },
          };
        } catch (error: any) {
          return {
            redis: {
              status: 'down',
              message: error.message,
            },
          };
        }
      },

      // 3. Verificación de uso de memoria Heap (< 300 MB)
      () => this.memoryIndicator.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }

  @Public()
  @SkipThrottle()
  @Get('benchmark')
  async benchmark() {
    const t1 = performance.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const selectTime = performance.now() - t1;

    const t2 = performance.now();
    await this.prisma.barberia.findFirst({
      include: {
        servicios: true,
        horarios: true,
        excepcionesHorario: true,
        bloqueosAgenda: true,
      }
    });
    const joinTime = performance.now() - t2;

    return {
      selectTimeMs: selectTime,
      joinTimeMs: joinTime
    };
  }
}
