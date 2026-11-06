import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // El orden importa poco funcionalmente, pero `errorInterceptor` va después
    // de `authInterceptor` para que el 401 ya haya cerrado la sesión cuando
    // el manejador global decida si anuncia el error (los 401 se silencian).
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    provideAnimationsAsync(),
    // H-03 · primera tabla PrimeNG del panel. El tema Aura aporta los tokens
    // del `p-table`; el modo oscuro se activa con la clase `dark` que ya lleva
    // `<html>` en index.html, así la bandeja respeta el Dark Luxury.
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.dark',
        },
      },
    }),
  ]
};
