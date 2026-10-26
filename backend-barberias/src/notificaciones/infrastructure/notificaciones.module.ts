import { Logger, Module } from '@nestjs/common';
import { NotificacionesListener } from '../application/notificaciones.listener.js';
import { RecordatoriosCronService } from '../application/recordatorios-cron.service.js';
import { WhatsappWebhookService } from '../application/whatsapp-webhook.service.js';
import { EMAIL_PROVIDER } from '../domain/port/email.provider.js';
import { WHATSAPP_PROVIDER } from '../domain/port/whatsapp.provider.js';
import { MockEmailProvider } from './mock-email.provider.js';
import { MockWhatsAppProvider } from './mock-whatsapp.provider.js';
import { HttpWhatsAppProvider } from './http-whatsapp.provider.js';
import { ResendEmailProvider } from './resend-email.provider.js';
import { NotificacionesWebhookController } from './notificaciones-webhook.controller.js';
// El webhook responde sobre la MISMA reserva que ya existe, por la vía que usa
// la sede (aceptar / cancelar): por eso este módulo sí depende de `ReservaModule`.
import { ReservaModule } from '../../reserva/infrastructure/reserva.module.js';

const logger = new Logger('NotificacionesModule');

/**
 * Fase 7 · Notificaciones event-driven, retención y webhook.
 *
 * Este módulo NO lo importa `ReservaModule`: el desacople es el bus. El servicio
 * de reservas inyecta `EventEmitter2` y publica hechos; aquí alguien los escucha.
 *
 * Los adaptadores se eligen en tiempo de ARRANQUE con `useFactory`, según lo que
 * haya en el entorno:
 *
 *  - `RESEND_API_KEY` → correo REAL vía Resend; sin ella, el Mock que solo
 *    registra en log (arranque sin credenciales, pruebas, entorno local).
 *  - `WHATSAPP_API_URL` + `WHATSAPP_API_TOKEN` → WhatsApp REAL por HTTP; si
 *    falta alguno de los dos, Mock.
 *
 * La selección es consciente: si falta la API key se avisa en el arranque para
 * que nadie crea que está enviando de verdad.
 *
 * Convivir con `NotificacionModule` (singular, BullMQ) es intencional: aquel
 * conserva el despacho con reintentos y el histórico en `notificaciones`. Este
 * cubre el camino nuevo —eventos de dominio, recordatorio de 2 h y respuesta
 * desde el chat—.
 *
 * `ScheduleModule.forRoot()` y `EventEmitterModule.forRoot()` viven en
 * `AppModule`, junto al resto de la infraestructura transversal.
 */
@Module({
  imports: [ReservaModule],
  controllers: [NotificacionesWebhookController],
  providers: [
    NotificacionesListener,
    RecordatoriosCronService,
    WhatsappWebhookService,
    {
      provide: EMAIL_PROVIDER,
      useFactory: () => {
        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.EMAIL_FROM;

        if (apiKey) {
          if (!from) {
            logger.warn(
              'RESEND_API_KEY presente sin EMAIL_FROM: se usará el remitente por defecto de Resend.',
            );
          }
          return new ResendEmailProvider({ apiKey, from });
        }

        logger.log(
          'RESEND_API_KEY no definida: el correo sale por MockEmailProvider (solo log).',
        );
        return new MockEmailProvider();
      },
    },
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: () => {
        const apiUrl = process.env.WHATSAPP_API_URL;
        const token = process.env.WHATSAPP_API_TOKEN;

        if (apiUrl && token) {
          return new HttpWhatsAppProvider({ apiUrl, token });
        }

        logger.log(
          'WHATSAPP_API_URL/WHATSAPP_API_TOKEN no definidos: WhatsApp sale por MockWhatsAppProvider (solo log).',
        );
        return new MockWhatsAppProvider();
      },
    },
  ],
  exports: [EMAIL_PROVIDER, WHATSAPP_PROVIDER],
})
export class NotificacionesModule {}