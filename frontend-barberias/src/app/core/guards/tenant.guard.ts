import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { TenantService } from '../services/tenant.service';

/**
 * Exige un contexto de sede para entrar a las pantallas de operación.
 *
 * Cuando la ruta declara `:shopId` o `:id`, el cambio de contexto se valida con
 * el backend antes de activar la pantalla. El TenantService purga las señales
 * de la sede anterior después de la respuesta autorizada.
 */
export const tenantGuard: CanActivateFn = (route) => {
  const tenantService = inject(TenantService);
  const router = inject(Router);

  const validarContextoActual = () => {
    const activa = tenantService.barberiaActiva();
    const sedes = tenantService.barberiasVinculadas();

    // Descarta una sede que ya no está en el alcance que devuelve el backend.
    if (activa && sedes.length > 0 && !sedes.some((sede) => sede.id === activa.id)) {
      tenantService.setBarberiaActiva(null);
      return router.createUrlTree(['/barberias']);
    }

    if (tenantService.barberiaActivaId()) return true;
    return router.createUrlTree(['/barberias']);
  };

  // Incluye parámetros definidos en rutas padre y acepta los nombres usados
  // por las rutas de sede y por las rutas heredadas.
  const shopId = [...route.pathFromRoot]
    .reverse()
    .map((snapshot) => snapshot.paramMap.get('shopId') ?? snapshot.paramMap.get('id'))
    .find((id): id is string => Boolean(id));

  if (shopId && tenantService.barberiaActivaId() !== shopId) {
    return tenantService.cambiarSedeActiva(shopId).pipe(
      map(() =>
        tenantService.barberiaActivaId() === shopId
          ? validarContextoActual()
          : router.createUrlTree(['/barberias']),
      ),
      catchError(() => of(router.createUrlTree(['/barberias']))),
    );
  }

  return validarContextoActual();
};
