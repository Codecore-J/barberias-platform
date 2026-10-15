import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * E3-12 · filtros de `GET /plataforma/vinculaciones/pendientes` (ADMINISTRADOR).
 *
 * Listado paginado en la forma D32 `{ data, total, page, pageSize }`, igual que
 * la bandeja de solicitudes de cambio de E3-13. La bandeja de plataforma mira
 * TODAS las sedes; `barberiaId` es un filtro opcional para cuando el
 * ADMINISTRADOR quiere mirar una sola.
 */
export class ListarVinculacionesPendientesDto {
  @IsOptional()
  @IsUUID()
  barberiaId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
