import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { LONGITUD_MINIMA_DETALLE } from './rechazar-reserva.dto.js';

/**
 * E3-08 · catálogo de motivos de CANCELACIÓN por el admin (D19, BACKLOG §5.5).
 *
 * Es un catálogo DISTINTO del de rechazo: el §5.5 reserva
 * `HORARIO_NO_DISPONIBLE`, `SERVICIO_NO_DISPONIBLE`… para el rechazo y
 * `EMERGENCIA`, `ENFERMEDAD`, `CIERRE_IMPREVISTO`, `FUERZA_MAYOR`, `OTRO` para
 * la cancelación por la sede. La migración
 * `20261010000000_e308_cancelacion_especial_propuestas` replica esta misma lista
 * en un `CHECK` sobre `reservas.cancelacion_especial_motivo`, así que un código
 * fuera del catálogo no puede entrar ni por SQL directo.
 */
export const MOTIVOS_CANCELACION_ESPECIAL = [
  'EMERGENCIA',
  'ENFERMEDAD',
  'CIERRE_IMPREVISTO',
  'FUERZA_MAYOR',
  'OTRO',
] as const;

export type MotivoCancelacionEspecial = (typeof MOTIVOS_CANCELACION_ESPECIAL)[number];

export class CancelacionEspecialDto {
  /** Obligatorio y siempre dentro del catálogo §5.5 de cancelación. */
  @IsString({ message: 'motivoCodigo debe ser texto' })
  @IsNotEmpty({ message: 'motivoCodigo es obligatorio para una cancelación especial' })
  @IsIn(MOTIVOS_CANCELACION_ESPECIAL as unknown as string[], {
    message: `motivoCodigo debe pertenecer al catálogo de cancelación: ${MOTIVOS_CANCELACION_ESPECIAL.join(', ')}`,
  })
  motivoCodigo: MotivoCancelacionEspecial;

  /**
   * Solo se exige cuando el código es `OTRO` (misma regla que el rechazo, §5.5).
   * `ValidateIf` y no `IsOptional`: `IsOptional` cortocircuitaría la validación
   * justo en el caso que hay que validar.
   */
  @ValidateIf((o: CancelacionEspecialDto) => o.motivoCodigo === 'OTRO')
  @IsString({ message: 'motivoDetalle debe ser texto' })
  @IsNotEmpty({ message: 'motivoDetalle es obligatorio cuando el motivo es OTRO' })
  @MinLength(LONGITUD_MINIMA_DETALLE, {
    message: `motivoDetalle debe tener al menos ${LONGITUD_MINIMA_DETALLE} caracteres cuando el motivo es OTRO`,
  })
  @MaxLength(500, { message: 'motivoDetalle no puede superar los 500 caracteres' })
  motivoDetalle?: string;
}
