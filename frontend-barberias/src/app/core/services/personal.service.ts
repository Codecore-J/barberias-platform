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
  /**
   * Fase 1/2 · cuenta dual (dueño que corta pelo).
   *
   * Invitar como `BARBERO` a una cuenta que ya administra la sede responde
   * `409 ADMIN_NO_SE_DEGRADA` salvo que este flag llegue en `true`; con él el
   * backend AÑADE el vínculo de barbero y conserva el de administrador.
   */
  conservarRolAdministrador?: boolean;
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

    // El error HTTP se propaga TAL CUAL: el contrato D40 viaja en el cuerpo
    // (`codigo`, `mensaje`, `adminActual`) y la pantalla necesita leer el código
    // para marcar la casilla de conservación o bloquear la invitación. Envolverlo
    // en un `Error` genérico —como se hacía aquí— destruía esa información.
    return this.http.post<Personal>(`${API_URL}/shops/${sedeId}/staff`, dto);
  }

  actualizarMiembro(usuarioId: string, dto: ActualizarPersonalRequest): Observable<Personal> {
    const sedeId = this.tenant.barberiaActivaId();
    if (!haySede(sedeId)) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    // Mismo criterio que en la invitación: `PATCH` puede responder 409
    // `SEDE_YA_TIENE_ADMIN` al promover a administrador, y ese código se pierde
    // si el servicio lo convierte en un `Error` sin cuerpo.
    return this.http.patch<Personal>(`${API_URL}/shops/${sedeId}/staff/${usuarioId}`, dto);
  }
}