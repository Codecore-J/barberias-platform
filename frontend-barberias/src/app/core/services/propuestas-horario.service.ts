import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { mensajeDeError } from '../utils/error-message.js';
import { MENSAJE_SIN_SEDE, haySede } from '../utils/sede.js';
import { TenantService } from './tenant.service.js';

/**
 * H-03 · bandeja de propuestas de horario.
 *
 * El backend guarda la propuesta en `propuestas_horario` y la resuelve la SEDE
 * (D18/§5.4). La bandeja es solo de PENDIENTES: al aprobar o rechazar, la fila
 * desaparece en el acto —no se recarga la lista entera— y la señal `revision`
 * avisa a quien quiera refrescar la agenda. Las rutas de resolución son las
 * mismas de E3-08, no una copia: aceptar mueve la cita de forma transaccional.
 */

export type TipoPropuestaHorario = 'PROPUESTA_INICIAL' | 'REPROGRAMACION' | 'ADELANTO';

export interface ClientePropuestaHorario {
  id: string;
  nombre: string;
  correo: string;
  telefono: string | null;
}

export interface PropuestaHorarioPendiente {
  id: string;
  reservaId: string;
  tipo: TipoPropuestaHorario | string;
  estado: string;
  motivo: string;
  fechaPropuesta: string;
  horaInicioPropuesta: string;
  horaFinPropuesta: string;
  expiraAt: string | null;
  expirada: boolean;
  creadoAt: string | null;
  solicitante: { id: string; nombre: string };
  reserva: {
    id: string;
    estado: string;
    fechaActual: string;
    horaInicioActual: string;
    horaFinActual: string;
    cliente: ClientePropuestaHorario;
    barbero: { id: string; nombre: string } | null;
  };
}

@Injectable({
  providedIn: 'root',
})
export class PropuestasHorarioService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);

  constructor() {
    this.tenant.registrarPurgadorLocal(() => this.limpiarEstadoLocal());
  }

  readonly propuestas = signal<PropuestaHorarioPendiente[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  /** Sube en cada resolución para que la agenda sepa que su caché quedó vieja. */
  readonly revision = signal<number>(0);
  readonly procesandoId = signal<string | null>(null);

  private limpiarEstadoLocal(): void {
    this.propuestas.set([]);
    this.isLoading.set(false);
    this.error.set(null);
    this.procesandoId.set(null);
  }

  private get appointmentsUrl(): string | null {
    const sedeId = this.tenant.barberiaActivaId();
    return haySede(sedeId) ? `${API_URL}/shops/${sedeId}/appointments` : null;
  }

  /** `GET /shops/:shopId/appointments/proposals/pending`. */
    cargar(): Observable<PropuestaHorarioPendiente[]> {
    const base = this.appointmentsUrl;
    if (!base) {
      this.isLoading.set(false);
      this.error.set(MENSAJE_SIN_SEDE);
      this.propuestas.set([]);
      return of([]);
    }

    this.isLoading.set(true);
    this.error.set(null);

    return this.http
      .get<PropuestaHorarioPendiente[]>(`${base}/proposals/pending`).pipe(
        tap((filas) => {
          this.propuestas.set(Array.isArray(filas) ? filas : []);
          this.isLoading.set(false);
        }),
        catchError((err) => {
          this.isLoading.set(false);
          this.propuestas.set([]);
          this.error.set(mensajeDeError(err, 'No se pudieron cargar las propuestas de horario'));
          return throwError(() => err);
        }),
      );
  }

  /**
   * `POST /shops/:shopId/appointments/:reservaId/proposed-time/accept`
   * Mueve la cita al bloque propuesto si sigue libre; el backend revalida el
   * hueco bajo el lock de la sede y responde 409 si ya no está disponible.
   */
  aprobar(propuesta: PropuestaHorarioPendiente): Observable<unknown> {
    return this.resolver(propuesta, 'accept');
  }

  /** `POST .../proposed-time/reject` · cierra la propuesta sin mover la cita. */
  rechazar(propuesta: PropuestaHorarioPendiente): Observable<unknown> {
    return this.resolver(propuesta, 'reject');
  }

  private resolver(
    propuesta: PropuestaHorarioPendiente,
    accion: 'accept' | 'reject',
  ): Observable<unknown> {
    const base = this.appointmentsUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.procesandoId.set(propuesta.id);
    this.error.set(null);

    return this.http
      .post(`${base}/${propuesta.reservaId}/proposed-time/${accion}`, {})
      .pipe(
        tap(() => {
          // La bandeja solo muestra PENDIENTES: la fila resuelta sale al instante.
          this.propuestas.update((lista) => lista.filter((fila) => fila.id !== propuesta.id));
          this.procesandoId.set(null);
          this.revision.update((n) => n + 1);
        }),
        catchError((err) => {
          this.procesandoId.set(null);
          this.error.set(
            mensajeDeError(
              err,
              accion === 'accept'
                ? 'No se pudo aprobar la propuesta'
                : 'No se pudo rechazar la propuesta',
            ),
          );
          return throwError(() => err);
        }),
      );
  }
}
