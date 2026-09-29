import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SharedModule } from './shared/shared.module.js';
import { IamModule } from './iam/iam.module.js';
import { JwtAuthGuard } from './iam/infrastructure/jwt-auth.guard.js';
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
import Redis from 'ioredis';

@Module({
  imports: [
    BullModule.forRoot({
      connection: process.env.REDIS_URL
        ? new Redis.default(process.env.REDIS_URL, { maxRetriesPerRequest: null })
        : {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
          },
    }),
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
    AuditoriaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard global: todos los endpoints requieren JWT salvo los marcados @Public()
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
