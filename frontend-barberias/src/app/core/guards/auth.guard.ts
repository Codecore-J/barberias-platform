import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.authState().isAuthenticated || authService.getToken()) {
    return true;
  }

  return router.createUrlTree(['/auth/login']);
};
