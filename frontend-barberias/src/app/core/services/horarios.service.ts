import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../constants/api.constants';
import { Observable } from 'rxjs';

export interface Horario {
  id?: string;
  diaSemana: number; // 1 (Lunes) a 7 (Domingo)
  horaInicio: string; // HH:mm
  horaFin: string; // HH:mm
}

export interface ExcepcionHorario {
  id?: string;
  fecha: string; // YYYY-MM-DD
  tipo: 'CERRADA' | 'HORARIO_ESPECIAL';
  horaInicio?: string;
  horaFin?: string;
  motivo?: string;
}

export interface BloqueoAgenda {
  id: string;
  barberiaId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  motivo?: string;
  creadoPor?: string;
  jobId?: string;
  createdAt?: string;
}

export interface CreateBloqueoDto {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  motivo?: string;
  liberacionAutomaticaMinutos?: number;
}

@Injectable({
  providedIn: 'root'
})
export class HorariosService {
  private http = inject(HttpClient);

  obtenerHorarios(barberiaId: string): Observable<Horario[]> {
    return this.http.get<Horario[]>(`${API_URL}/shops/${barberiaId}/hours`);
  }

  configurarHorarios(barberiaId: string, horarios: Omit<Horario, 'id'>[]): Observable<Horario[]> {
    return this.http.post<Horario[]>(`${API_URL}/shops/${barberiaId}/hours`, horarios);
  }

  obtenerMiHorario(barberiaId: string): Observable<Horario[]> {
    return this.http.get<Horario[]>(`${API_URL}/shops/${barberiaId}/hours/mine`);
  }

  configurarMiHorario(barberiaId: string, horarios: Omit<Horario, 'id'>[]): Observable<Horario[]> {
    return this.http.post<Horario[]>(`${API_URL}/shops/${barberiaId}/hours/mine`, horarios);
  }

  obtenerExcepciones(barberiaId: string, from?: string, to?: string): Observable<ExcepcionHorario[]> {
    let params: any = {};
    if (from) params.from = from;
    if (to) params.to = to;
    return this.http.get<ExcepcionHorario[]>(`${API_URL}/shops/${barberiaId}/hours/exceptions`, { params });
  }

  agregarExcepcion(barberiaId: string, excepcion: ExcepcionHorario): Observable<ExcepcionHorario> {
    return this.http.post<ExcepcionHorario>(`${API_URL}/shops/${barberiaId}/hours/exceptions`, excepcion);
  }

  agregarExcepcionBarbero(barberiaId: string, barberoId: string, excepcion: ExcepcionHorario): Observable<any> {
    return this.http.post(`${API_URL}/shops/${barberiaId}/hours/barbers/${barberoId}/exceptions`, excepcion);
  }

  obtenerBloqueos(barberiaId: string, from?: string, to?: string): Observable<BloqueoAgenda[]> {
    let params: any = {};
    if (from) params.from = from;
    if (to) params.to = to;
    return this.http.get<BloqueoAgenda[]>(`${API_URL}/shops/${barberiaId}/appointments/schedule/blocks`, { params });
  }

  crearBloqueo(barberiaId: string, bloqueo: CreateBloqueoDto): Observable<BloqueoAgenda> {
    return this.http.post<BloqueoAgenda>(`${API_URL}/shops/${barberiaId}/appointments/schedule/blocks`, bloqueo);
  }

  /**
   * E2-07: el bloqueo no se borra, se LIBERA (`POST .../blocks/:id/release`).
   * El método conserva su nombre porque lo que hace la pantalla no cambió: el
   * bloqueo deja de ocupar la agenda. Lo que cambia es el verbo del backend.
   */
  eliminarBloqueo(barberiaId: string, id: string): Observable<any> {
    return this.http.post(`${API_URL}/shops/${barberiaId}/appointments/schedule/blocks/${id}/release`, {});
  }
}

