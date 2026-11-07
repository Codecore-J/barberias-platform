/**
 * Utilidades de teléfono.
 *
 * El formato de teléfono de la plataforma es local: exactamente 10 dígitos,
 * sin separadores ni prefijo internacional. Varios formularios ya limpiaban la
 * entrada a mano (`crear-barberia`, `register`, `admin-usuarios`); esta utilidad
 * concentra esa regla para que no se reimplemente —y se olvide— en cada alta.
 *
 * Nunca convierte a `number`: los teléfonos no se suman ni se comparan
 * numéricamente, y hacerlo es justo lo que produjo los `600NaN2222` que había
 * en `barberias.telefono` (una concatenación con el resultado de una conversión
 * fallida). Todo el recorrido es de texto a texto.
 */

/** Longitud exacta del teléfono local. */
export const LONGITUD_TELEFONO = 10;

/** Contrato que comparten frontend y backend (`gestionar-personal.dto.ts`). */
export const PATRON_TELEFONO = /^\d{10}$/;

/**
 * Devuelve solo los dígitos de `valor`, recortados a `maximo`.
 *
 * Acepta `unknown` a propósito: los teléfonos llegan de un `<input>`, de un DTO
 * o de la respuesta de la API, y en cualquiera de esos puntos puede aparecer
 * `null`, `undefined` o un número suelto. Un valor no convertible no lanza ni
 * produce `NaN`: se queda como cadena vacía.
 */
export function sanearTelefono(valor: unknown, maximo: number = LONGITUD_TELEFONO): string {
  if (valor === null || valor === undefined) return '';

  // `String(...)` sobre un objeto devuelve "[object Object]"; el `replace` lo
  // reduce a cadena vacía, que es el resultado seguro que buscamos.
  return String(valor).replace(/\D/g, '').slice(0, Math.trunc(maximo));
}

/** `true` si tras sanear quedan exactamente 10 dígitos. */
export function esTelefonoValido(valor: unknown): boolean {
  return sanearTelefono(valor).length === LONGITUD_TELEFONO;
}
