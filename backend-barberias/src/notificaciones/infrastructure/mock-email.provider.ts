import { Injectable, Logger } from '@nestjs/common';
import { type IEmailProvider, type MensajeEmail } from '../domain/port/email.provider.js';

/**
 * Fase 7 · Adaptador temporal de correo.
 *
 * No hay proveedor real en la plataforma todavía, así que el envío se simula con
 * el `Logger` de Nest. El valor de tenerlo detrás del puerto es que el día que
 * entre SendGrid/Resend solo cambia el binding del token: listener, cron y
 * pruebas se quedan igual.
 */
@Injectable()
export class MockEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);

  async enviar({ destinatario, asunto, cuerpo }: MensajeEmail): Promise<void> {
    this.logger.log(`[Email Mock] Enviando a ${destinatario} — "${asunto}": ${cuerpo}`);
  }
}
