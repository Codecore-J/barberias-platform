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
   * Sonda de VIDA (liveness) — H64.
   *
   * POR QUÉ EXISTE: `check()` comprueba Base de Datos **y Redis**, así que con
   * Redis caído devuelve 503 aunque el proceso esté perfectamente vivo y
   * sirviendo. `render.yaml` usaba esa ruta como `healthCheckPath`, de modo que
   * el orquestador podía reiniciar en bucle una instancia sana y anular la
   * degradación elegante del arranque (H63).
   *
   * QUÉ COMPRUEBA: nada externo. Solo que el proceso responde. Ni base de datos
   * ni Redis: una sonda de vida que dependa de un servicio de terceros convierte
   * el parpadeo de ese servicio en un reinicio. Tampoco usa `@HealthCheck()`
   * (Terminus) para no arrastrar indicadores: responde directo y en milisegundos.
   *
   * LA PREPARACIÓN sigue en `check()` (`/health`, `/api/v1/health`): eso es lo que
   * debe mirar el balanceador o la alerta antes de mandar tráfico.
   */
  @Public()
  @SkipThrottle()
  @Get(['health/liveness', 'api/v1/health/liveness'])
  liveness() {
    return {
      status: 'ok',
      // Datos del proceso: útiles para distinguir "vivo y recién arrancado" de
      // "vivo tras un reinicio" sin tocar nada externo.
      uptimeSegundos: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Sonda de PREPARACIÓN (readiness) — MON-01 / Hallazgo 08.
   *
   * Comprueba lo que hace falta para atender tráfico de verdad: Base de Datos,
   * Redis y memoria. Accesible públicamente tanto en /health como en /api/v1/health.
   * Devuelve 503 si algo falta, y eso es correcto: NO se usa como sonda de vida.
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
}
