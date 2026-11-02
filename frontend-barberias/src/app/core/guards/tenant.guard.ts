import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { TenantService } from '../services/tenant.service';

/**
 * Exige un contexto de sede para entrar a las pantallas de operación.
 *
 * Sin sede activa se va al hub (`/barberias`), que es la única pantalla que no
 * lleva este guard: no hay bucle posible porque el destino no vuelve a pasar por
 * aquí. Eso es lo que convierte al hub en el selector de contexto de CUALQUIER
 * rol, incluido el ADMINISTRADOR global: su alcance transversal no le da una
 * sede por defecto, se la elige él (D05).
 */
export const tenantGuard: CanActivateFn = () => {
  const tenantService = inject(TenantService);
  const router = inject(Router);

  const activa = tenantService.barberiaActiva();
  const sedes = tenantService.barberiasVinculadas();

  // La sede cacheada pudo dejar de estar disponible —una sede suspendida sale
  // del listado, y con ella el acceso a sus pantallas—. Operar con esa sede
  // encadena 403/409 en cada petición, así que se descarta ANTES de dar paso.
  if (activa && sedes.length > 0 && !sedes.some((sede) => sede.id === activa.id)) {
    tenantService.setBarberiaActiva(null);
    return router.createUrlTree(['/barberias']);
  }

  // Requerimos que el usuario haya seleccionado una barbería activa
  if (tenantService.barberiaActivaId()) {
    return true;
  }

  // Sin barbería seleccionada, el hub de barberías: el superadmin ve ahí el
  // listado global y cualquier otro rol, sus sedes.
  return router.createUrlTree(['/barberias']);
};
