import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { TenantService } from '../core/services/tenant.service';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const tenantService = inject(TenantService);
  const token = authService.getToken();
  const barberiaId = tenantService.barberiaActivaId();

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (barberiaId && !req.headers.has('x-barberia-id')) {
    headers['x-barberia-id'] = barberiaId;
  }

  const authReq = req.clone({
    setHeaders: headers,
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Si el backend devuelve 401 y no estamos en la ruta de login
      if (error.status === 401 && !req.url.includes('/auth/login')) {
        authService.logout();
      }
      return throwError(() => error);
    }),
  );
};

