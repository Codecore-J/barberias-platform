/**
 * Claves del caché de analíticas.
 *
 * La forma es la misma que usa cualquier operador de Redis: prefijo estable,
 * sujeto y rango. `all` marca el rango por defecto (los últimos 30 días) para
 * que una llamada sin fechas no genere una clave distinta en cada petición.
 */

export const PREFIJO_ANALITICAS_SEDE = 'analytics:shop:';
export const PREFIJO_ANALITICAS_OVERVIEW = 'analytics:overview:';

/** Prefijo que purga una invalidación de sede: `analytics:shop:<id>:...`. */
export function prefijoDeSede(barberiaId: string): string {
  return `${PREFIJO_ANALITICAS_SEDE}${barberiaId}:`;
}

export function claveAnaliticasSede(
  barberiaId: string,
  desde?: string,
  hasta?: string,
): string {
  return `${prefijoDeSede(barberiaId)}${desde || 'all'}-${hasta || 'all'}`;
}

/**
 * El overview agrega varias sedes, así que no cuelga del prefijo de ninguna:
 * cualquier cambio en una sede lo invalida y por eso el invalidante purga el
 * prefijo `analytics:overview:` completo.
 */
export function claveAnaliticasOverview(
  usuarioId: string,
  desde?: string,
  hasta?: string,
  esGlobal = false,
): string {
  const sujeto = esGlobal ? 'global' : usuarioId;
  return `${PREFIJO_ANALITICAS_OVERVIEW}${sujeto}:${desde || 'all'}-${hasta || 'all'}`;
}
