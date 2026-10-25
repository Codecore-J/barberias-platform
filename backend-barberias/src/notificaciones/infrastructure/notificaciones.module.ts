import { Module } from '@nestjs/common';
import { NotificacionesListener } from '../application/notificaciones.listener.js';
import { RecordatoriosCronService } from '../application/recordatorios-cron.service.js';
import { EMAIL_PROVIDER } from '../domain/port/email.provider.js';
import { WHATSAPP_PROVIDER } from '../domain/port/whatsapp.provider.js';
import { MockEmailProvider } from './mock-email.provider.js';
import { MockWhatsAppProvider } from './mock-whatsapp.provider.js';

/**
 * Fase 7 · Notificaciones event-driven y retención.
 *
 * Este módulo NO lo importa `ReservaModule`: el desacople es el bus. El servicio
 * de reservas inyecta `EventEmitter2` y publica hechos; aquí alguien los escucha.
 * Añadir un canal nuevo (SMS, push) es otro adaptador y otro `@OnEvent`, sin
 * tocar la reserva.
 *
 * `ScheduleModule.forRoot()` y `EventEmitterModule.forRoot()` viven en
 * `AppModule`, junto al resto de la infraestructura transversal; aquí solo se
 * declaran los consumidores.
 *
 * Convivir con `NotificacionModule` (singular, BullMQ) es intencional: aquel
 * conserva el despacho con reintentos y el historial en `notificaciones`. Este
 * cubre el camino nuevo —eventos de dominio y recordatorio de 2 h— y lo
 * sustituirá cuando el histórico migre.
 */
@Module({
  providers: [
    NotificacionesListener,
    RecordatoriosCronService,
    // Puertos → adaptadores. Cambiar a un proveedor real es cambiar estas dos
    // líneas (o el binding según el entorno) sin tocar dominio ni pruebas.
    { provide: EMAIL_PROVIDER, useClass: MockEmailProvider },
    { provide: WHATSAPP_PROVIDER, useClass: MockWhatsAppProvider },
  ],
  exports: [EMAIL_PROVIDER, WHATSAPP_PROVIDER],
})
export class NotificacionesModule {}
