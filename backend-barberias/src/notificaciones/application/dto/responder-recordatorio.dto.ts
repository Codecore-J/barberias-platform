import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';

/** Acciones que el cliente puede responder desde su WhatsApp. */
export const ACCIONES_WEBHOOK = ['CONFIRMAR', 'CANCELAR'] as const;

export type AccionWebhook = (typeof ACCIONES_WEBHOOK)[number];

/**
 * Fase 7 · cuerpo del webhook de retención `POST /webhooks/whatsapp`.
 *
 * Llega desde Meta Cloud API (o el gateway) al responder al recordatorio: el
 * cliente teclea CONFIRMAR o CANCELAR y el sistema ejecuta la transición sobre
 * SU reserva. `telefono` no es decorado: es la segunda pieza de la comprobación
 * de pertenencia, porque el secreto del webhook protege la puerta pero no dice
 * de QUIÉN es la reserva.
 */
export class ResponderRecordatorioDto {
  @IsUUID('4', { message: 'reservaId debe ser un UUID válido' })
  reservaId: string;

  @IsString({ message: 'telefono debe ser texto' })
  @IsNotEmpty({ message: 'El teléfono del remitente es obligatorio' })
  telefono: string;

  @IsIn(ACCIONES_WEBHOOK, { message: 'accion debe ser CONFIRMAR o CANCELAR' })
  accion: AccionWebhook;
}