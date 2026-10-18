import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * E3-12/2 · la puerta de entrada del CLIENTE a una sede (regla 1.10).
 *
 * Tiene DOS formas de nombrar la misma cosa y el DTO admite las dos:
 *
 *  - `codigoAcceso`: el código de 8 caracteres que el staff dicta en el mostrador
 *    o pega en un chat. Es el camino que ya existía.
 *  - `enlaceUnico`: el identificador de la sede que viaja dentro del enlace de
 *    invitación y de su QR. Es el camino nuevo, y sirve para lo que un código
 *    dictado no sirve: compartirlo impreso sin que nadie lo transcriba.
 *
 * Que sean opcionales NO significa que valga cualquiera: el servicio exige
 * exactamente una de las dos (`INVITACION_REQUERIDA` / `INVITACION_AMBIGUA`,
 * 422). La comprobación vive allí y no en el DTO porque es una regla de negocio
 * de la ruta —de las que el contrato D40 responde con `{ statusCode, codigo,
 * mensaje }`— y no un formato de campo.
 */
export class UnirseBarberiaDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codigoAcceso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  enlaceUnico?: string;
}
