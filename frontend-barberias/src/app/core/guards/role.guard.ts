import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import type { UsuarioResponseDto } from '../../auth/interfaces/auth.interface';

/**
 * Guard de control de acceso basado en roles para el frontend.
 * Previene que usuarios sin los roles adecuados accedan a rutas protegidas.
 */
export const roleGuard = (allowedRoles: string[]): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    /**
     * Evalúa los roles permitidos contra un usuario ya hidratado.
     * Sin usuario no hay roles que evaluar: se va al login (defensivo).
     */
    const evaluar = (user: UsuarioResponseDto | null) => {
      if (!user) {
        return router.createUrlTree(['/auth/login']);
      }

      const userRoles = user.roles || [];

      const hasRole = allowedRoles.some((allowed) => {
        if (allowed === 'ADMIN') {
          return (
            userRoles.includes('ADMINISTRADOR') ||
            userRoles.includes('ADMIN_BARBERIA') ||
            userRoles.includes('ADMIN')
          );
        }
        return userRoles.includes(allowed);
      });

      if (hasRole) {
        return true;
      }

      // Redirección defensiva si el usuario no tiene permisos para esta ruta.
      // H24: un BARBERO sin el rol requerido vuelve a SU agenda (/admin/agenda);
      // cualquier otro caso sin el rol va al Home que actuará como dashboard.
      if (userRoles.includes('BARBERO')) {
        return router.createUrlTree(['/admin/agenda']);
      }
      return router.createUrlTree(['/']);
    };

    const user = authService.authState().user;
    if (user) {
      return evaluar(user);
    }

    // H-02 · recarga de navegador (F5) con token válido: `user` sigue en null
    // porque `checkSession()` aún no respondió. Antes se redirigía a login con
    // una sesión buena en vuelo. Con token, el guard ESPERA la hidratación
    // compartida (misma petición `GET /me` que ya disparó el AuthService) y
    // recién entonces evalúa los roles; sin token, al login como siempre.
    if (authService.getToken()) {
      return authService
        .cargarSesion()
        .pipe(map((userHidratado) => evaluar(userHidratado)));
    }

    return router.createUrlTree(['/auth/login']);
  };
};
