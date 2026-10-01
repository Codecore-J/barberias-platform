import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

/**
 * Guard de control de acceso basado en roles para el frontend.
 * Previene que usuarios sin los roles adecuados accedan a rutas protegidas.
 */
export const roleGuard = (allowedRoles: string[]): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    const user = authService.authState().user;
    if (!user) {
      return router.createUrlTree(['/auth/login']);
    }

    const userRoles = user.roles || [];

    const hasRole = allowedRoles.some((allowed) => {
      if (allowed === 'ADMIN') {
        return (
          userRoles.includes('ADMINISTRADOR') ||
          userRoles.includes('ADMIN_BARBERIA') ||
          userRoles.includes('SUPER_ADMIN') ||
          userRoles.includes('ADMIN')
        );
      }
      return userRoles.includes(allowed);
    });

    if (hasRole) {
      return true;
    }

    // Redirección defensiva si el usuario no tiene permisos para esta ruta
    // Todos son enviados al Home que actuará como dashboard
    return router.createUrlTree(['/']);
  };
};
