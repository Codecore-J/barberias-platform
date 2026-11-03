import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../constants/api.constants';
import { Observable } from 'rxjs';

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

@Injectable({
  providedIn: 'root',
})
export class PersonalService {
  private http = inject(HttpClient);

  obtenerPersonal(barberiaId: string): Observable<Personal[]> {
    return this.http.get<Personal[]>(`${API_URL}/shops/${barberiaId}/staff`);
  }

  invitarMiembro(barberiaId: string, dto: InvitarPersonalRequest): Observable<Personal> {
    return this.http.post<Personal>(`${API_URL}/shops/${barberiaId}/staff`, dto);
  }

  actualizarMiembro(
    barberiaId: string,
    usuarioId: string,
    dto: ActualizarPersonalRequest,
  ): Observable<Personal> {
    return this.http.patch<Personal>(`${API_URL}/shops/${barberiaId}/staff/${usuarioId}`, dto);
  }
}
