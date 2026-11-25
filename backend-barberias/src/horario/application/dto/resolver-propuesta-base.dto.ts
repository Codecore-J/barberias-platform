import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * F4-04 · `PATCH /shops/:shopId/hours/barbers/:barberoId/base`.
 *
 * Una sola ruta resuelve aprobar y rechazar porque la matriz tiene UNA acción
 * para la decisión (`horario.base.aprobar`). El motivo del rechazo NO se valida
 * aquí como obligatorio: depende de `aprobar` y el DTO no sabe expresar «si es
 * falso, entonces requerido». Lo exige el servicio con 422
 * `MOTIVO_RECHAZO_REQUERIDO`, que es el contrato del documento (D40).
 */
export class ResolverPropuestaBaseDto {
  @IsBoolean({ message: 'aprobar debe ser verdadero o falso.' })
  aprobar!: boolean;

  @IsOptional()
  @IsString({ message: 'motivoRechazo debe ser texto.' })
  @MaxLength(500, { message: 'motivoRechazo admite 500 caracteres como máximo.' })
  motivoRechazo?: string;
}
