import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { TenantService } from '../services/tenant.service';

export const tenantGuard: CanActivateFn = () => {
  const tenantService = inject(TenantService);
  const router = inject(Router);

  // Requerimos que el usuario haya seleccionado una barbería activa
  if (tenantService.barberiaActivaId()) {
    return true;
  }

  // Si no tiene barbería seleccionada, lo enviamos al hub de barberías
  return router.parseUrl('/barberias');
};
