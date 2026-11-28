import type { UsuarioListResponseDto } from './usuario-list-response.dto.js';

/**
 * F8 / T-81 · KPI de la bandeja de plataforma · `GET /plataforma/usuarios/resumen`.
 *
 * Se calculan en la BASE sobre TODAS las cuentas, no sobre la página devuelta
 * ni sobre el filtro vigente: las tarjetas de la pantalla siempre han medido la
 * plataforma entera (T-24) y con paginación de servidor unas `datos` de 25 filas
 * darían cifras falsas.
 *
 * Viven en su propia ruta y no dentro del listado por escalabilidad: son dos
 * `count(*)` y un `groupBy` de todos los vínculos, y el listado se pide en cada
 * tecla del buscador. La pantalla los carga una vez por visita y los invalida
 * tras escribir.
 *
 * `porRol` cuenta CUENTAS distintas con el rol VIGENTE (una cuenta con el mismo
 * rol en dos sedes suma una sola vez, y un vínculo `INACTIVO` —rol revocado— no
 * suma), igual que el `computed` que tenía el frontend.
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
 * `datos` es la página pedida y `total` el tamaño del conjunto FILTRADO (para
 * calcular páginas). El KPI no viaja aquí: lo sirve `ResumenUsuariosDto` en
 * `/plataforma/usuarios/resumen`.
 */
export interface UsuariosPaginadosDto {
  datos: UsuarioListResponseDto[];
  total: number;
  pagina: number;
  porPagina: number;
}
