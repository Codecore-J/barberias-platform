/**
 * Guarda compartida de CONTEXTO DE SEDE.
 *
 * Los servicios construían rutas con `barberiaActivaId()` sin comprobar que
 * existiera: `GET /shops/null/appointments/...` moría en el `ParseUUIDPipe` del
 * backend con un 400, y el dashboard del administrador global (que opera con
 * `barberiaId: null`) los disparaba nada más entrar.
 *
 * La regla es una sola para todo el frontend:
 *
 *   · LECTURA sin sede  → `of(valorVacio)`, sin gastar la petición.
 *   · ESCRITURA sin sede → `throwError`, porque simular un éxito que no ocurrió
 *     deja la pantalla creyendo que guardó.
 *
 * `haySede` es un type predicate: además de comprobar, estrecha el tipo, así que
 * el servicio puede interpolar el id sin un `!` ni un cast.
 */

/** Mensaje de negocio único cuando falta la sede activa. */
export const MENSAJE_SIN_SEDE = 'Selecciona una barbería para continuar.';

/** `true` (y tipo `string`) solo cuando hay una sede activa real. */
export function haySede(sedeId: string | null | undefined): sedeId is string {
  return typeof sedeId === 'string' && sedeId.trim().length > 0;
}
