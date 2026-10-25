import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';

export interface DisponibilidadSlot {
  inicio: string;
  fin: string;
}

/**
 * E3-contrato: el backend exige `tipo` en `CreateReservaDto`
 * (@IsIn(['INDIVIDUAL','GRUPAL','AUTOMATICO','MANUAL'])) y su ValidationPipe
 * global responde 400 si falta. El servicio lo inyecta por defecto para que
 * ninguna pantalla dependa de recordarlo.
 */
export type TipoReserva = 'INDIVIDUAL' | 'GRUPAL' | 'AUTOMATICO' | 'MANUAL';

export interface CrearReservaDto {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  serviciosIds: string[];
  precioTotalEsperado: number;
  barberoId?: string | null;
  nombreInvitado?: string;
  tipo?: TipoReserva;
}

@Injectable({
  providedIn: 'root'
})
export class ReservasService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  private readonly apiUrl = `${API_URL}`;

  /**
   * Fase 5 (Punto 5.3): reservas y agenda se anidan bajo la sede en la ruta
   * (`/shops/:shopId/appointments`), en vez de resolverla por cabecera.
   */
  private get appointmentsUrl(): string {
    return `${API_URL}/shops/${this.tenant.barberiaActivaId()}/appointments`;
  }

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /**
   * Obtiene los slots de disponibilidad para un día específico
   */
  obtenerDisponibilidad(fecha: string, duracionTotalMinutos: number, barberoId?: string): Observable<DisponibilidadSlot[]> {
    this.isLoading.set(true);
    this.error.set(null);
    
    let url = `${this.appointmentsUrl}/schedule/availability?fecha=${fecha}&duracionMinutos=${duracionTotalMinutos}`;
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

    // E3-contrato: el campo `tipo` es obligatorio en el backend; el wizard
    // del cliente siempre crea reservas INDIVIDUAL.
    const payload: CrearReservaDto = { ...dto, tipo: dto.tipo ?? 'INDIVIDUAL' };

    return this.http.post(`${this.appointmentsUrl}`, payload).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al crear la reserva');
        return throwError(() => err);
      })
    );
  }

  /**
   * Crea un turno walk-in desde la pantalla de agenda (E3-03).
   * Ruta aparte de `crearReserva`: ese alias es exclusivo del CLIENTE y este
   * lo usan el BARBERO / ADMIN de la sede, así que no comparten decorador.
   */
  crearReservaWalkIn(dto: CrearReservaDto): Observable<any> {
    this.isLoading.set(true);
    this.error.set(null);

    // E3-contrato: igual que en `crearReserva`, el backend exige `tipo`.
    // El turno walk-in lo teclea el staff sobre un solo cliente: INDIVIDUAL.
    const payload: CrearReservaDto = { ...dto, tipo: dto.tipo ?? 'INDIVIDUAL' };

    return this.http.post(`${this.appointmentsUrl}/walk-in`, payload).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al crear la reserva walk-in');
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

    return this.http.get<any>(`${this.appointmentsUrl}/mine`).pipe(
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

    return this.http.get<any>(`${this.appointmentsUrl}/day?fecha=${fecha}`).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al obtener la agenda');
        return of([]);
      })
    );
  }

  /**
   * Marca un turno como no presentado (D02).
   *
   * E2-02: antes esto llamaba a `PATCH /reservas/:id/estado`, un endpoint
   * genérico que escribía cualquier estado sin comprobar el grafo de §5.2 y que
   * se eliminó. La ruta dedicada es `POST /shops/:shopId/appointments/:id/no-show`,
   * y la máquina solo la admite desde `CONFIRMADA`.
   */
  marcarInasistencia(reservaId: string): Observable<any> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.post(`${this.appointmentsUrl}/${reservaId}/no-show`, {}).pipe(
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

    return this.http.post(`${API_URL}/shops/${this.tenant.barberiaActivaId()}/payments`, body).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al procesar el cobro');
        return throwError(() => err);
      })
    );
  }
}
