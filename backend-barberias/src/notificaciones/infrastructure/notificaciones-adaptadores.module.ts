import { Logger, Module } from '@nestjs/common';
import { EMAIL_PROVIDER } from '../domain/port/email.provider.js';
import { WHATSAPP_PROVIDER } from '../domain/port/whatsapp.provider.js';
import { MockEmailProvider } from './mock-email.provider.js';
import { MockWhatsAppProvider } from './mock-whatsapp.provider.js';
import { HttpWhatsAppProvider } from './http-whatsapp.provider.js';
import { ResendEmailProvider } from './resend-email.provider.js';

const logger = new Logger('NotificacionesAdaptadoresModule');

/**
 * V2.1 · Los dos adaptadores de entrega, aislados del resto del grafo.
 *
 * Los proveedores se elegían dentro de `NotificacionesModule`, pero `OtpService`
 * (en `IamModule`) necesita exactamente los mismos dos y `IamModule` DEBE
 * conservar un grafo mínimo: `test/cliente-ficha-roles.e2e-spec.ts` lo monta
 * aislado y allí no existen ni `EventEmitterModule.forRoot()` (lo necesita
 * `RecordatoriosCronService`) ni `BullModule.forRoot`. Extraerlos a este módulo
 * —sin dependencias, sin controladores, sin listeners— reparte la misma
 * selección por entorno sin arrastrar a nadie.
 *
 * La selección es consciente: si falta la API key se avisa en el arranque para
 * que nadie crea que está enviando de verdad.
 *
 *  - `RESEND_API_KEY` → correo REAL vía Resend; sin ella, el Mock que solo
 *    registra en log (arranque sin credenciales, pruebas, entorno local).
 *  - `WHATSAPP_API_URL` + `WHATSAPP_API_TOKEN` → WhatsApp REAL por HTTP; si
 *    falta alguno de los dos, Mock.
 */
@Module({
  providers: [
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
export class NotificacionesAdaptadoresModule {}
