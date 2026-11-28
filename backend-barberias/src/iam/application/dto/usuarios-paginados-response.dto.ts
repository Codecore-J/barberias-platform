import type { UsuarioListResponseDto } from './usuario-list-response.dto.js';

/**
 * F8 / T-81 · KPI de la bandeja de plataforma.
 *
 * Se calculan en la BASE sobre TODAS las cuentas, no sobre la página devuelta:
 * las tarjetas de la pantalla siempre han medido la plataforma entera (T-24) y
 * con paginación de servidor unas `datos` de 25 filas darían cifras falsas. Por
 * eso el resumen viaja aparte del `total` filtrado.
 *
 * `porRol` cuenta CUENTAS distintas por rol (una cuenta con el mismo rol en dos
 * sedes suma una sola vez), igual que hacía el `computed` del frontend.
 */
export interface ResumenUsuariosDto {
  total: number;
  activos: number;
  suspendidos: number;
  porRol: Record<string, number>;
}

/**
 * F8 / T-81 · contrato de `GET /plataforma/usuarios`.
 *
 * `datos` es la página pedida, `total` el tamaño del conjunto FILTRADO (para
 * calcular páginas) y `resumen` los contadores de toda la plataforma.
 */
export interface UsuariosPaginadosDto {
  datos: UsuarioListResponseDto[];
  total: number;
  pagina: number;
  porPagina: number;
  resumen: ResumenUsuariosDto;
}
