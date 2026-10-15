import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * E3-12 · cuerpo de `POST /plataforma/vinculaciones/:id/rechazar`.
 *
 * El motivo es OBLIGATORIO en la regla, pero viaja como opcional aquí: la
 * respuesta tiene que ser 422 `MOTIVO_REQUERIDO` —el contrato D40 de regla de
 * negocio, el mismo código que usan E3-13 y E4-03/5— y no el 400 del
 * `ValidationPipe`. Por eso la longitud mínima la comprueba el servicio y no un
 * `@MinLength`.
 */
export class RechazarVinculacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
