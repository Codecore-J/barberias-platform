import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MOTIVO_RECHAZO_MIN } from '../../domain/solicitud-cambio.js';

/**
 * E3-13 · `POST /plataforma/solicitudes-cambio/:id/resolver` (ADMINISTRADOR).
 *
 * `aprobar: false` exige `motivoRechazo`; la obligatoriedad se comprueba en el
 * servicio (422 `MOTIVO_REQUERIDO`) porque depende de `aprobar` y el DTO no
 * puede expresar esa condicional. El mínimo de caracteres sí se valida aquí,
 * igual que el CHECK de la base (D26).
 */
export class ResolverSolicitudCambioDto {
  @IsBoolean()
  aprobar: boolean;

  @IsOptional()
  @IsString()
  @MinLength(MOTIVO_RECHAZO_MIN)
  @MaxLength(500)
  motivoRechazo?: string;
}
