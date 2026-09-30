import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

export interface DisponibilidadSlot {
  inicio: string;
  fin: string;
}

export interface CrearReservaDto {
  servicioIds: string[];
  barberoId?: string | null;
  fechaHoraInicio: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReservasService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}`;

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /**
   * Obtiene los slots de disponibilidad para un día específico
   */
  obtenerDisponibilidad(fecha: string, duracionTotalMinutos: number, barberoId?: string): Observable<DisponibilidadSlot[]> {
    this.isLoading.set(true);
    this.error.set(null);
    
    let url = `${this.apiUrl}/agenda/disponibilidad?fecha=${fecha}&duracionMinutos=${duracionTotalMinutos}`;
    if (barberoId) {
      url += `&barberoId=${barberoId}`;
    }

    return this.http.get<any>(url).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al consultar disponibilidad');
        return of([]);
      })
    );
  }

  /**
   * Crea una nueva reserva
   */
  crearReserva(dto: CrearReservaDto): Observable<any> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.post(`${this.apiUrl}/reservas`, dto).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al crear la reserva');
        return throwError(() => err);
      })
    );
  }

  /**
   * Obtiene las reservas del cliente actual
   */
  obtenerMisReservas(): Observable<any[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<any>(`${this.apiUrl}/reservas/mis-reservas`).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al obtener tus reservas');
        return of([]);
      })
    );
  }

  /**
   * Obtiene la agenda de reservas de una barbería para una fecha específica (Para barberos/admins)
   */
  obtenerAgendaDiaria(fecha: string): Observable<any[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<any>(`${this.apiUrl}/reservas/agenda?fecha=${fecha}`).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al obtener la agenda');
        return of([]);
      })
    );
  }

  /**
   * Cambia el estado de una reserva (Ej: NO_ASISTIO, CANCELADA)
   */
  cambiarEstado(reservaId: string, estado: string): Observable<any> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.patch(`${this.apiUrl}/reservas/${reservaId}/estado`, { estado }).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al cambiar estado de la reserva');
        return throwError(() => err);
      })
    );
  }

  /**
   * Registra el cobro de una reserva y la marca como COMPLETADA
   */
  registrarCobro(reservaId: string, metodoPago: string, monto?: number): Observable<any> {
    this.isLoading.set(true);
    this.error.set(null);

    const body: any = { reservaId, metodoPago };
    if (monto) body.monto = monto;

    return this.http.post(`${this.apiUrl}/cobros`, body).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al procesar el cobro');
        return throwError(() => err);
      })
    );
  }
}
