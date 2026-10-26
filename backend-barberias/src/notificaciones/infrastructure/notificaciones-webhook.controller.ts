import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../iam/infrastructure/public.decorator.js';
import { ResponderRecordatorioDto } from '../application/dto/responder-recordatorio.dto.js';
import { WhatsappWebhookService } from '../application/whatsapp-webhook.service.js';

/** Cabecera con la que el proveedor (o nuestro backend) autentica el webhook. */
export const CABECERA_SECRETO = 'x-webhook-secret';

/** Variable de entorno del secreto compartido. */
export const ENTORNO_SECRETO = 'WHATSAPP_WEBHOOK_SECRET';

/**
 * Comparación en tiempo constante: un atacante no puede averiguar el secreto
 * a trozos midiendo cuánto tarda la respuesta. Se exige igualdad de longitud
 * porque `timingSafeEqual` lo requiere; desigual ya es un «no coincide».
 */
export function secretosIguales(esperado: string, recibido: string): boolean {
  const esperadoBuf = Buffer.from(esperado, 'utf8');
  const recibidoBuf = Buffer.from(recibido, 'utf8');

  if (esperadoBuf.length !== recibidoBuf.length) {
    return false;
  }

  return timingSafeEqual(esperadoBuf, recibidoBuf);
}

/**
 * Fase 7 · `POST /webhooks/whatsapp`: el cliente responde al recordatorio desde
 * su chat (CONFIRMAR / CANCELAR) y la reserva cambia de estado.
 *
 * La ruta está FUERA del prefijo `api/v1` (se excluye en `main.ts`) para que la
 * URL que se configura en Meta Cloud API o en el gateway sea estable, igual que
 * las sondas de salud. `@Public()` la libera del guard JWT —quien llama es un
 * proveedor, no un navegador— y en su lugar la autenticación es el secreto
 * compartido: sin `WHATSAPP_WEBHOOK_SECRET` configurado el endpoint responde
 * 503 (nunca queda abierto por omisión) y con un secreto equivocado, 401.
 */
@Controller('webhooks/whatsapp')
export class NotificacionesWebhookController {
  constructor(private readonly servicio: WhatsappWebhookService) {}

  @Public()
  @Post()
  // 200 explícito: los gateways esperan la respuesta de «procesado», no la 201
  // por defecto de Nest (que reservaría para «recurso creado»).
  @HttpCode(HttpStatus.OK)
  recibir(
    @Headers(CABECERA_SECRETO) secreto: string | undefined,
    @Body() dto: ResponderRecordatorioDto,
  ) {
    this.validarSecreto(secreto);
    return this.servicio.responder(dto);
  }

  private validarSecreto(recibido: string | undefined): void {
    const esperado = process.env[ENTORNO_SECRETO];

    if (!esperado) {
      throw new ServiceUnavailableException({
        codigo: 'WEBHOOK_NO_CONFIGURADO',
        message: 'Webhook no habilitado: falta WHATSAPP_WEBHOOK_SECRET.',
      });
    }

    if (!recibido || !secretosIguales(esperado, recibido)) {
      throw new UnauthorizedException({
        codigo: 'WEBHOOK_SECRETO_INVALIDO',
        message: 'Secreto de webhook inválido.',
      });
    }
  }
}