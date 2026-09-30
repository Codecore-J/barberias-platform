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
  fecha: string; // YYYY-MM-DD
  tipo: 'DIA_LIBRE' | 'HORARIO_ESPECIAL';
  horaInicio?: string;
  horaFin?: string;
  motivo?: string;
}

@Injectable({
  providedIn: 'root'
})
export class HorariosService {
  private http = inject(HttpClient);

  obtenerHorarios(barberiaId: string): Observable<Horario[]> {
    return this.http.get<Horario[]>(`${API_URL}/barberias/${barberiaId}/horarios`);
  }

  configurarHorarios(barberiaId: string, horarios: Omit<Horario, 'id'>[]): Observable<Horario[]> {
    return this.http.post<Horario[]>(`${API_URL}/barberias/${barberiaId}/horarios`, horarios);
  }

  obtenerMiHorario(barberiaId: string): Observable<Horario[]> {
    return this.http.get<Horario[]>(`${API_URL}/barberias/${barberiaId}/horarios/mi-horario`);
  }

  configurarMiHorario(barberiaId: string, horarios: Omit<Horario, 'id'>[]): Observable<Horario[]> {
    return this.http.post<Horario[]>(`${API_URL}/barberias/${barberiaId}/horarios/mi-horario`, horarios);
  }

  agregarExcepcionBarbero(barberiaId: string, barberoId: string, excepcion: ExcepcionHorario): Observable<any> {
    return this.http.post(`${API_URL}/barberias/${barberiaId}/horarios/barberos/${barberoId}/excepciones`, excepcion);
  }
}
