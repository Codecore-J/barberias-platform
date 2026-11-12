import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { coldStartInterceptor } from './core/interceptors/cold-start.interceptor';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

/** Clave de PrimeUI leída de la página, si el despliegue la define. */
function clavePrimeUi(): string | undefined {
  const global = globalThis as { __PRIMEUI_LICENSE__?: string };
  const clave = global.__PRIMEUI_LICENSE__?.trim();
  return clave ? clave : undefined;
}

const primengConfig = {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
    },
  },
  // PrimeUI (PrimeNG 22+) exige una clave REAL: un valor inventado como 'MIT'
  // no silencia nada y además provoca "[PrimeUI] PrimeUI license is malformed".
  // La clave se inyecta sin tocar código desde `index.html`:
  //   <script>window.__PRIMEUI_LICENSE__ = '<clave>';</script>
  // Sin clave la librería avisa "license is not configured": es un requisito
  // de licencia (Community o Commercial en primeui.dev), no un bug de la app.
  ...(clavePrimeUi() ? { license: clavePrimeUi() } : {}),
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
    providePrimeNG(primengConfig),
  ],
};