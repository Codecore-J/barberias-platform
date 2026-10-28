import { IsEnum } from 'class-validator';
import { TipoOtp } from '@prisma/client';

/**
 * V2.1 · Envío de un código de verificación.
 *
 * Solo se pide el CANAL: el usuario sale del JWT, nunca del cuerpo, así que
 * nadie puede pedir un código por la cuenta de otro. `tipo` decide además qué
 * bandera habilitará el código al validarse y por qué proveedor sale el
 * mensaje (WhatsApp para TELEFONO, correo para CORREO).
 */
export class SendOtpDto {
  @IsEnum(TipoOtp, { message: 'tipo debe ser TELEFONO o CORREO.' })
  tipo: TipoOtp;
}
