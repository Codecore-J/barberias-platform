/**
 * H75 · la ruta que la persona pedía, viajando a través del login.
 *
 * El `authGuard` intercepta a quien no tiene sesión y lo manda a `/auth/login`.
 * Si esa redirección no dijera A DÓNDE iba, la persona acaba en el dashboard y
 * el enlace que abrió se pierde: el caso que lo destapó es el QR de una sede
 * (la puerta de entrada de la regla 1.10), que se imprime una vez y se escanea
 * desde el móvil de alguien que casi nunca tiene sesión abierta.
 *
 * Este módulo decide dos cosas y nada más:
 *
 *  - Cómo se llama el parámetro (`PARAM_RETURN_URL`), para que el guard, el
 *    login y el registro no lo escriban cada uno a su manera.
 *  - Qué destinos se aceptan al volver: SOLO rutas internas.
 *
 * Lo segundo no es celo: el parámetro lo puede escribir cualquiera desde la
 * barra de direcciones (`?returnUrl=…`), así que es entrada NO confiable. Sin
 * lista blanca, un enlace `…/auth/login?returnUrl=https://otro-sitio` gira la
 * pantalla de login en un trampolín hacia fuera (open redirect) justo después
 * de teclear la contraseña, que es el peor momento para que alguien dude de
 * dónde está escribiendo sus credenciales.
 */

/** El nombre del parámetro con el que el guard viaja la ruta pedida. */
export const PARAM_RETURN_URL = 'returnUrl';

/**
 * Devuelve la ruta a la que volver, o `null` cuando no hay un destino interno
 * válido y toca aplicar el destino por rol de siempre.
 *
 * Se descartan, a propósito:
 *  - lo que no empieza por `/` (`https://…`, `javascript:…`, `otro-sitio`), que
 *    es un destino absoluto y por tanto fuera de la aplicación;
 *  - lo que empieza por `//` o lleva una barra invertida, porque el navegador
 *    puede leer `//otro-sitio` (y `/\otro-sitio`) como URL relativa al
 *    protocolo aunque el texto no lo parezca;
 *  - los caracteres de control (salto de línea, tabulador, NUL), que algunos
 *    navegadores recortan al interpretar la URL;
 *  - las propias pantallas de sesión (`/auth/…`): volver al login justo después
 *    de entrar sería un bucle.
 */
export function returnUrlSeguro(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') {
    return null;
  }

  const crudo = valor.trim();
  if (!crudo.startsWith('/')) {
    return null;
  }
  if (crudo.startsWith('//') || crudo.includes('\\')) {
    return null;
  }
  for (const caracter of crudo) {
    const codigo = caracter.charCodeAt(0);
    if (codigo < 0x20 || codigo === 0x7f) {
      return null;
    }
  }

  // La ruta sin query ni fragmento, para no confundir `/auth/login?x` con otra cosa.
  const ruta = crudo.split(/[?#]/)[0];
  if (ruta === '/auth' || ruta.startsWith('/auth/')) {
    return null;
  }

  return crudo;
}
