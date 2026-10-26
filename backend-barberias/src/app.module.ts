import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SharedModule } from './shared/shared.module.js';
import { IamModule } from './iam/iam.module.js';
import { JwtAuthGuard } from './iam/infrastructure/jwt-auth.guard.js';
import { RolesGuard } from './iam/infrastructure/roles.guard.js';
import { BarberiaModule } from './barberia/barberia.module.js';
import { CatalogoModule } from './catalogo/catalogo.module.js';
import { HorarioModule } from './horario/infrastructure/horario.module.js';
import { AgendaModule } from './agenda/infrastructure/agenda.module.js';

import { BullModule } from '@nestjs/bullmq';
import { ReservaModule } from './reserva/infrastructure/reserva.module.js';
import { PagoModule } from './pago/infrastructure/pago.module.js';
import { AntecedenteModule } from './antecedente/infrastructure/antecedente.module.js';
import { NotificacionModule } from './notificacion/infrastructure/notificacion.module.js';
import { AuditoriaModule } from './auditoria/infrastructure/auditoria.module.js';
import { PlataformaUsuariosModule } from './iam/infrastructure/plataforma-usuarios.module.js';
import { ListaEsperaModule } from './lista-espera/lista-espera.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { HealthModule } from './health/health.module.js';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
// Fase 7: bus de eventos de dominio (reserva.*) y scheduler de los recordatorios
// preventivos. Se registran aquí, con la infraestructura transversal.
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificacionesModule } from './notificaciones/infrastructure/notificaciones.module.js';
import { AppCacheModule } from './shared/cache/app-cache.module.js';
import { SentryInterceptor } from './shared/observability/sentry.interceptor.js';
import Redis from 'ioredis';

@Module({
  imports: [
    HealthModule,
    // Caché de analíticas: Redis si hay REDIS_URL, memoria si no. `isGlobal`
    // deja CACHE_MANAGER y CACHE_STORE disponibles en todo el árbol.
    AppCacheModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60000, // 1 minuto
          limit: 120, // 120 peticiones/min para tráfico estándar
        },
      ],
      errorMessage: 'Demasiadas solicitudes desde esta dirección IP. Por favor espere antes de reintentar.',
    }),
    BullModule.forRoot({
      connection: process.env.REDIS_URL
        ? new Redis.default(process.env.REDIS_URL, { maxRetriesPerRequest: null })
        : {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
          },
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    SharedModule,
    IamModule,
    BarberiaModule,
    CatalogoModule,
    HorarioModule,
    AgendaModule,
    ReservaModule,
    PagoModule,
    AntecedenteModule,
    NotificacionModule,
    // Fase 7 · consumidor de `reserva.*` y cron de recordatorios de 2 h. No lo
    // importa `ReservaModule`: el servicio solo publica en el bus.
    NotificacionesModule,
    AuditoriaModule,
    // E4-02 · D22: Carril B. Este módulo expone el alta de la suscripción y,
    // además, es el consumidor de `HUECO_LIBERADO`: cuando `ReservaService`
    // libera un bloque, aquí corre el matcher FIFO que avisa al cliente al que
    // le cabe.
    ListaEsperaModule,
    // E4-03/5: la suspensión de cuentas desde plataforma (audita con
    // `AuditoriaModule`, por eso no cuelga de `IamModule`).
    PlataformaUsuariosModule,
    // H22: desactivado hasta E4-05. ClienteController expone /clientes/:id/ficha
    // y /clientes/:id/notas. El modulo sigue en src/cliente/, sin registrar:
    // mientras tanto esas rutas responden 404.
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Observabilidad · todo error 5xx (y cualquier excepción no HTTP) viaja a
    // Sentry con la ruta y el usuario del token. Sin SENTRY_DSN el interceptor
    // no hace nada y la respuesta al cliente es idéntica.
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryInterceptor,
    },
    // Guard de Rate Limiting global (SEC-02): intercepta ráfagas abusivas antes de procesar peticiones
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Guard global: todos los endpoints requieren JWT salvo los marcados @Public()
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Guard global: verifica acceso por roles después del JWT
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
