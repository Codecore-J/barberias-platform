import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { coldStartInterceptor } from './core/interceptors/cold-start.interceptor';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG, type PrimeNGConfigType } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

/**
 * Clave de licencia de PrimeUI (PrimeNG 22+).
 *
 * PrimeNG 22 dejó de ser MIT: se usa bajo la licencia Community —gratuita para
 * individuos y para organizaciones que cumplan los criterios— o Commercial. La
 * librería verifica la clave al arrancar y, si no la encuentra o no es válida,
 * avisa por consola y pinta el banner de licencia. No hay forma legítima de
 * callar ese aviso sin una clave real: un valor inventado como `'MIT'` no solo
 * no silencia nada, sino que añade «license is malformed».
 *
 * La clave se inyecta como global ANTES de que arranque Angular, así que no
 * viaja en el bundle ni obliga a recompilar. `index.html` ya carga
 * `assets/env.js` en el `<head>`; ahí la escriben, según el despliegue,
 * `scripts/generate-runtime-env.mjs` (Vercel) o `entrypoint.sh` (Docker) a
 * partir de la variable de entorno `PRIMEUI_LICENSE`:
 *
 *     window.__PRIMEUI_LICENSE__ = "<clave>";
 *
 * Se lee UNA sola vez, al evaluar este módulo, y no dentro del provider: el
 * initializer de `providePrimeNG` corre más tarde, pero el orden no debe
 * depender de eso. La normalización (trim + descartar vacíos) evita que una
 * variable de entorno declarada pero sin valor se pase como cadena vacía y
 * provoque «license is malformed» en lugar de «not configured».
 */
function leerClavePrimeUi(): string | undefined {
  const clave = (globalThis as { __PRIMEUI_LICENSE__?: unknown }).__PRIMEUI_LICENSE__;
  if (typeof clave !== 'string') return undefined;

  const limpia = clave.trim();
  return limpia.length > 0 ? limpia : undefined;
}

const CLAVE_PRIMEUI = leerClavePrimeUi();

const primengConfig: PrimeNGConfigType = {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
    },
  },
  // Sin clave no se envía la propiedad: `providePrimeNG` distingue «no
  // configurada» (aviso neutro) de «mal formada» (aviso más ruidoso).
  ...(CLAVE_PRIMEUI ? { license: CLAVE_PRIMEUI } : {}),
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // El orden importa poco funcionalmente, pero `errorInterceptor` va después
    // de `authInterceptor` para que el 401 ya haya cerrado la sesión cuando
    // el manejador global decida si anuncia el error (los 401 se silencian).
    //
    // `coldStartInterceptor` va PRIMERO: es el más externo de la cadena, así
    // que su temporizador mide la espera completa (incluido el cold start del
    // backend) y no solo el tramo que queda por debajo.
    provideHttpClient(
      withInterceptors([coldStartInterceptor, authInterceptor, errorInterceptor]),
    ),
    provideAnimationsAsync(),
    // H-03 · primera tabla PrimeNG del panel. El tema Aura aporta los tokens
    // del `p-table`; el modo oscuro se activa con la clase `dark` que ya lleva
    // `<html>` en index.html, así la bandeja respeta el Dark Luxury.
    // `primengConfig` aporta además la licencia cuando el despliegue la define.
    providePrimeNG(primengConfig),
  ],
};