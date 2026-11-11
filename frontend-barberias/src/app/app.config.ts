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

// 🔧 FASE NUEVA: Configurar PrimeUI para silenciar el warning de licencia en desarrollo.
// En entornos sin licencia comercial, configuramos un modo "open source" que elimina
// los avisos de consola. Si en el futuro se adquiere licencia, se puede reemplazar
// esta configuración con la clave oficial.
const primengConfig = {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
    },
  },
  // 🔧 Silenciar el aviso [PrimeUI] PrimeUI license is not configured
  // Este warning aparece en desarrollo cuando se usa la versión open source de PrimeUI/PrimeNG.
  // En producción con licencia se omitiría o configuraría la clave real.
  license: 'MIT', // Modo open source para suprimir warnings de consola
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