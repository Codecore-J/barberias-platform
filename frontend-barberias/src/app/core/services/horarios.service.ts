import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../constants/api.constants';
import { Observable } from 'rxjs';

export interface Horario {
  id?: string;
  diaSemana: number; // ISO: 1 (Lunes) a 7 (Domingo)
  horaInicio: string; // HH:mm
  horaFin: string; // HH:mm
}

/**
 * V3 fase 5 · un día de la semana propia del barbero.
 *
 * Las horas llegan ya como `HH:mm` (el backend las normaliza desde el `TIME` de
 * Postgres), que es el único formato que acepta un `<input type="time">`.
 */
export interface DiaHorarioBarbero {
  diaSemana: number; // ISO: 1 = lunes … 7 = domingo
  esDiaLibre: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  horaInicioDescanso: string | null;
  horaFinDescanso: string | null;
}

export interface MiHorarioSemana {
  barberiaId: string;
  barberoId: string;
  /** `true` si el barbero aún no guardó nada: el motor usa el horario de la sede. */
  heredaHorarioSede: boolean;
  dias: DiaHorarioBarbero[];
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

  /** Semana propia del barbero (días libres y descansos). */
  obtenerMiSemana(barberiaId: string): Observable<MiHorarioSemana> {
    return this.http.get<MiHorarioSemana>(`${API_URL}/shops/${barberiaId}/mi-horario`);
  }

  /**
   * `PUT` porque reemplaza la semana completa: repetir el guardado deja el mismo
   * estado y nunca duplica filas. El `barberoId` lo pone el backend desde el JWT.
   */
  guardarMiSemana(barberiaId: string, dias: DiaHorarioBarbero[]): Observable<MiHorarioSemana> {
    return this.http.put<MiHorarioSemana>(`${API_URL}/shops/${barberiaId}/mi-horario`, {
      dias,
    });
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

