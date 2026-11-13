import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants';
import { mensajeDeError } from '../utils/error-message.js';
import { MENSAJE_SIN_SEDE, haySede } from '../utils/sede.js';
import { TenantService } from './tenant.service.js';

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
  /**
   * Personal de la sede indicada o, si no se indica, de la sede activa.
   *
   * Sin sede no hay endpoint que pedir: `/shops/null/staff` respondía 400 y el
   * antiguo fallback a un UUID de ceros solo cambiaba el 400 por un 404
   * enmascarado como lista vacía.
   */
  obtenerPersonal(barberiaId?: string): Observable<Personal[]> {
    const sedeId = barberiaId ?? this.tenant.barberiaActivaId();
    if (!haySede(sedeId)) return of([]);

    return this.http.get<Personal[]>(`${API_URL}/shops/${sedeId}/staff`).pipe(
      catchError(() =>
        throwError(() => new Error(mensajeDeError({}, 'No se pudo cargar el personal'))),
      ),
    );
  }

  invitarMiembro(dto: InvitarPersonalRequest): Observable<Personal> {
    const sedeId = this.tenant.barberiaActivaId();
    if (!haySede(sedeId)) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    return this.http.post<Personal>(`${API_URL}/shops/${sedeId}/staff`, dto).pipe(
      catchError(() =>
        throwError(() => new Error(mensajeDeError({}, 'No se pudo crear el miembro'))),
      ),
    );
  }

  actualizarMiembro(usuarioId: string, dto: ActualizarPersonalRequest): Observable<Personal> {
    const sedeId = this.tenant.barberiaActivaId();
    if (!haySede(sedeId)) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    return this.http
      .patch<Personal>(`${API_URL}/shops/${sedeId}/staff/${usuarioId}`, dto)
      .pipe(
        catchError(() =>
          throwError(() => new Error(mensajeDeError({}, 'No se pudieron guardar los cambios'))),
        ),
      );
  }
}