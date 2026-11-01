import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { AuthService, ACCESS_TOKEN_KEY } from './auth.service';
import { catchError, throwError } from 'rxjs';

/**
 * Fase 5 (Punto 5.3): el interceptor YA NO inyecta `x-barberia-id`. La sede
 * viaja en la ruta (`/shops/:shopId/...`) de cada servicio, que es la única
 * fuente de tenant que acepta el backend; aquí solo se autentica.
 *
 * H-F5 · por qué este interceptor NO llama a `inject(AuthService)` al armar la
 * petición:
 *
 *   `AuthService` inyecta `HttpClient` y, en su constructor, dispara
 *   `checkSession()` → `GET /auth/me`. Esa primera petición ejecuta la cadena
 *   de interceptores mientras `AuthService` **todavía se está construyendo**;
 *   si el interceptor pidiera `inject(AuthService)`, Angular detectaría el
 *   ciclo `AuthService → HttpClient → interceptor → AuthService` y respondería
 *   `NG0200: Circular dependency detected`. El error llegaba al `catchError`
 *   de `cargarSesion()`, que lo interpretaba como «sesión inválida» y llamaba
 *   a `logout()`: **el token se borraba en cada recarga (F5)** y la petición
 *   ni siquiera salía a la red.
 *
 *   Por eso el token se lee del almacenamiento (la misma clave que usa el
 *   servicio, exportada para no duplicar el literal) y `AuthService` se
 *   resuelve con el `Injector` **solo cuando ya hay una respuesta 401**, un
 *   momento en el que la instancia está construida y el ciclo ya no existe.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(Injector);
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Si el backend devuelve 401 y no estamos en la ruta de login
      if (error.status === 401 && !req.url.includes('/auth/login')) {
        injector.get(AuthService).logout();
      }
      return throwError(() => error);
    }),
  );
};
