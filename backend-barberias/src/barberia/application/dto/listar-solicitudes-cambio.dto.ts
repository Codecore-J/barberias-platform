import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ESTADOS_SOLICITUD_CAMBIO_LISTA } from '../../domain/solicitud-cambio.js';

/**
 * E3-13 · filtros de `GET /plataforma/solicitudes-cambio` (ADMINISTRADOR).
 * Listado paginado en la forma D32 `{ data, total, page, pageSize }`.
 */
export class ListarSolicitudesCambioDto {
  @IsOptional()
  @IsIn(ESTADOS_SOLICITUD_CAMBIO_LISTA)
  estado?: string;

  /** Permite a la plataforma mirar solo una sede. */
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
