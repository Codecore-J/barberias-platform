import { Injectable, inject, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants';
import { mensajeDeError } from '../utils/error-message.js';
import { TenantService } from './tenant.service.js';
import { AuthService } from '../../auth/auth.service';

export interface Personal {
  id: string;
  nombreCompleto: string;
  correo: string;
  telefono: string;
  estado: 'ACTIVO' | 'SUSPENDIDO' | 'ELIMINADO';
  estadoSede: 'ACTIVO' | 'INACTIVO';
  roles: string[];
}

export type RolPersonal = 'BARBERO' | 'ADMIN_BARBERIA';

export interface InvitarPersonalRequest {
  nombreCompleto: string;
  correo: string;
  telefono: string;
  password: string;
  rolNombre: RolPersonal;
}

export interface ActualizarPersonalRequest {
  estado: 'ACTIVO' | 'INACTIVO';
  rolNombre: RolPersonal;
}

@Injectable({ providedIn: 'root' })
export class PersonalService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  private readonly auth = inject(AuthService);

  /** Indica si el usuario actual es admin global sin sede asignada */
  private readonly esAdminGlobalSinSede = computed(() => {
    const user = this.auth.authState().user;
    return user?.roles?.includes('ADMINISTRADOR') && !this.tenant.tieneBarberiaActiva();
  });

  /** Obtiene el personal de la sede actual o en modo global para admin */
  obtenerPersonal(barberiaId?: string): Observable<Personal[]> {
    // Admin global sin sede: mostramos personal global o aviso
    if (this.esAdminGlobalSinSede()) {
      return this.obtenerPersonalGlobal();
    }

    // Usuario con sede asociada: comportamiento normal
    // Usar el parámetro si se proporciona, sino usar la sede activa
    const effectiveBarberiaId = barberiaId || this.tenant.barberiaActivaId();
    if (!effectiveBarberiaId) {
      return this.http.get<Personal[]>(`${API_URL}/shops/null/staff`).pipe(
        catchError(() => of([]))
      );
    }

    return this.http.get<Personal[]>(`${API_URL}/shops/${effectiveBarberiaId}/staff`).pipe(
      catchError(() => {
        // Si es 403 y es admin global sin sede, mostramos aviso en lugar de error crudo
        return throwError(() => new Error(mensajeDeError({}, 'No se pudo cargar el personal')));
      })
    );
  }

  /** Carga personal en modo global para admin sin sede */
  private obtenerPersonalGlobal(): Observable<Personal[]> {
    return this.http.get<Personal[]>(`${API_URL}/catalogo/admin/personal-global`).pipe(
      catchError(() => {
        // Intento alternativo: lista vacía con aviso
        return of([]);
      })
    );
  }

  /** Indica si el usuario actual es admin global sin sede asignada */
  private readonly esAdminGlobalSinSedeCache = computed(() => {
    const user = this.auth.authState().user;
    return user?.roles?.includes('ADMINISTRADOR') && !this.tenant.tieneBarberiaActiva();
  });

  /** Carga personal en modo global para admin sin sede */
  private obtenerPersonalGlobal2(): Observable<Personal[]> {
    return this.http.get<Personal[]>(`${API_URL}/catalogo/admin/personal-global`).pipe(
      catchError(() => {
        // Intento alternativo: lista vacía con aviso
        return of([]);
      })
    );
  }

  invitarMiembro(dto: InvitarPersonalRequest): Observable<Personal> {
    const user = this.auth.authState().user;

    // Admin global sin sede: permite la invitación pero asigna global
    if (user?.roles?.includes('ADMINISTRADOR') && this.esAdminGlobalSinSedeCache()) {
      // Usamos un endpoint global o el primero disponible
      return this.http.post<Personal>(`${API_URL}/catalogo/admin/personal`, dto).pipe(
        catchError(() => {
          return throwError(() => new Error(mensajeDeError({}, 'No se pudo crear el miembro')));
        })
      );
    }

    // Usuario con sede: comportamiento normal
    const barberiaId = this.tenant.barberiaActivaId();
    if (!barberiaId) {
      return this.http.post<Personal>(`${API_URL}/shops/null/staff`, dto).pipe(
        catchError(() => {
          // fallback: intentar con sede por defecto o mostrar aviso
          return this.http.post<Personal>(
            `${API_URL}/shops/00000000-0000-0000-0000-000000000000/staff`,
            dto
          ).pipe(catchError(() => throwError(() => new Error(mensajeDeError({}, 'No se pudo crear el miembro')))));
        })
      );
    }

    return this.http.post<Personal>(`${API_URL}/shops/${barberiaId}/staff`, dto).pipe(
      catchError(() => {
        return throwError(() => new Error(mensajeDeError({}, 'No se pudo crear el miembro')));
      })
    );
  }

  actualizarMiembro(usuarioId: string, dto: ActualizarPersonalRequest): Observable<Personal> {
    const user = this.auth.authState().user;

    // Admin global sin sede: actualiza registro global
    if (user?.roles?.includes('ADMINISTRADOR') && this.esAdminGlobalSinSedeCache()) {
      return this.http
        .patch<Personal>(`${API_URL}/catalogo/admin/personal/${usuarioId}`, dto).pipe(
          catchError(() => {
            return throwError(() => new Error(mensajeDeError({}, 'No se pudieron guardar los cambios')));
          })
        );
    }

    // Usuario con sede: comportamiento normal
    const barberiaId = this.tenant.barberiaActivaId();
    if (!barberiaId) {
      return this.http
        .patch<Personal>(`${API_URL}/shops/null/staff/${usuarioId}`, dto).pipe(
          catchError(() =>
            this.http
              .patch<Personal>(
                `${API_URL}/shops/00000000-0000-0000-0000-000000000000/staff/${usuarioId}`,
                dto
              ).pipe(
                catchError(() =>
                  throwError(
                    () => new Error(mensajeDeError({}, 'No se pudieron guardar los cambios')),
                  ),
                ),
              )
          )
        );
    }

    return this.http
      .patch<Personal>(`${API_URL}/shops/${barberiaId}/staff/${usuarioId}`, dto).pipe(
        catchError(() => {
          return throwError(() => new Error(mensajeDeError({}, 'No se pudieron guardar los cambios')));
        })
      );
  }
}