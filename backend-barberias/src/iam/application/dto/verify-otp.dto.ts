import { IsEnum, Matches } from 'class-validator';
import { TipoOtp } from '@prisma/client';

/**
 * V2.1 · Validación de un código de verificación.
 *
 * `codigo` tiene 6 dígitos exactos (`^\d{6}$`): el DTO rechaza antes cualquier
 * intento de inyección o formato distinto, de modo que la consulta contra la
 * base recibe solo lo que la tabla puede contener (`VARCHAR(6)`).
 *
 * `tipo` vuelve a exigir el canal porque un mismo usuario puede tener dos
 * códigos vivos —uno por canal— y comprobar el de correo no debe marcar el de
 * teléfono.
 */
export class VerifyOtpDto {
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  codigo: string;

  @IsEnum(TipoOtp, { message: 'tipo debe ser TELEFONO o CORREO.' })
  tipo: TipoOtp;
}
