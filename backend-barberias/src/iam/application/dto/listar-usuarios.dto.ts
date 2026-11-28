import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ROLES_PLATAFORMA } from './crear-usuario-plataforma.dto.js';

/**
 * F8 / T-81 · filtros de `GET /plataforma/usuarios`.
 *
 * La bandeja de plataforma pedía la tabla COMPLETA en cada visita (68 cuentas en
 * staging, sin techo) y paginaba en el navegador: el coste crecía con cada alta y
 * los KPI se calculaban sobre las filas ya descargadas. Con estos parámetros la
 * base devuelve solo la página pedida y el buscador y los filtros se resuelven en
 * SQL, no en memoria.
 *
 * - `page` empieza en 1 y `pageSize` tiene tope 100 (igual que D32 en auditoría):
 *   el `ValidationPipe` rechaza con 400 un `pageSize` fuera de rango en vez de
 *   servir la tabla entera.
 * - `busqueda` es libre (nombre, correo o teléfono) y no distingue mayúsculas.
 * - `estado` y `rol` acotan por el estado de la cuenta y por nombre de rol.
 */
export const ESTADOS_FILTRO_USUARIO = ['TODOS', 'ACTIVO', 'SUSPENDIDO'] as const;
export type EstadoFiltroUsuario = (typeof ESTADOS_FILTRO_USUARIO)[number];

export class ListarUsuariosDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @IsIn([...ESTADOS_FILTRO_USUARIO])
  estado?: EstadoFiltroUsuario;

  @IsOptional()
  @IsIn([...ROLES_PLATAFORMA])
  rol?: (typeof ROLES_PLATAFORMA)[number];
}
