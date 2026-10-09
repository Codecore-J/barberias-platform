import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * E3-04 · catálogo de motivos de RECHAZO (D19, BACKLOG §5.5).
 *
 * Es la fuente única en TypeScript: la migración
 * `20261009000000_e304_motivos_reserva` replica esta misma lista en un `CHECK`
 * para que un código fuera del catálogo no pueda entrar ni por SQL directo.
 * El catálogo de cancelación del admin (`EMERGENCIA`, `ENFERMEDAD`,
 * `CIERRE_IMPREVISTO`, `FUERZA_MAYOR`) no se admite aquí: llega con su propia
 * ruta en E3-06.
 */
export const MOTIVOS_RECHAZO = [
  'HORARIO_NO_DISPONIBLE',
  'SERVICIO_NO_DISPONIBLE',
  'RESPONSABLE_AUSENTE',
  'CLIENTE_RESTRINGIDO',
  'OTRO',
] as const;

export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number];

/** §5.5: `OTRO` exige un detalle de al menos 5 caracteres. */
export const LONGITUD_MINIMA_DETALLE = 5;

export class RechazarReservaDto {
  /** Obligatorio y siempre dentro del catálogo §5.5. */
  @IsString({ message: 'motivoCodigo debe ser texto' })
  @IsNotEmpty({ message: 'motivoCodigo es obligatorio para rechazar una reserva' })
  @IsIn(MOTIVOS_RECHAZO as unknown as string[], {
    message: `motivoCodigo debe pertenecer al catálogo de rechazo: ${MOTIVOS_RECHAZO.join(', ')}`,
  })
  motivoCodigo: MotivoRechazo;

  /**
   * Solo se valida cuando el código es `OTRO`, que es el único que lo exige.
   * Se usa `ValidateIf` y no `IsOptional`: `IsOptional` cortocircuitaría la
   * validación justo en el caso que hay que validar.
   */
  @ValidateIf((o: RechazarReservaDto) => o.motivoCodigo === 'OTRO')
  @IsString({ message: 'motivoDetalle debe ser texto' })
  @IsNotEmpty({ message: 'motivoDetalle es obligatorio cuando el motivo es OTRO' })
  @MinLength(LONGITUD_MINIMA_DETALLE, {
    message: `motivoDetalle debe tener al menos ${LONGITUD_MINIMA_DETALLE} caracteres cuando el motivo es OTRO`,
  })
  @MaxLength(500, { message: 'motivoDetalle no puede superar los 500 caracteres' })
  motivoDetalle?: string;
}
