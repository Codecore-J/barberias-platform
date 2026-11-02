import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, tap, catchError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';

/**
 * E3-13 · solicitudes de cambio de nombre y responsable (D26).
 *
 * La sede PROPONE y la plataforma RESUELVE, así que hay dos bandejas:
 *
 *  - `GET /shops/:shopId/change-requests` · la sede ve lo que ella misma pidió
 *    y cómo terminó (solo lectura: el backend no le da el verbo de resolución);
 *  - `GET /plataforma/solicitudes-cambio` + `POST .../:id/resolver` · el
 *    `ADMINISTRADOR` global aprueba o rechaza.
 *
 * El estado vive en señales compartidas: la pantalla no guarda copias propias y
 * una resolución actualiza la fila en el acto, sin recargar la lista entera.
 */

export const MOTIVO_RECHAZO_MIN = 5;

export type TipoSolicitudCambio = 'NOMBRE' | 'RESPONSABLE';
export type EstadoSolicitudCambio = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

export interface SolicitudCambio {
  id: string;
  barberiaId: string;
  tipo: TipoSolicitudCambio;
  valorNuevo: string;
  estado: EstadoSolicitudCambio;
  solicitadoPor: string;
  resueltoPor: string | null;
  motivoRechazo: string | null;
  creadoAt: string | null;
  resueltoAt: string | null;
  /** Solo en los listados: la fila se pinta sin una segunda consulta. */
  barberia?: { id: string; nombre: string };
}

interface PaginaSolicitudes {
  data?: SolicitudCambio[];
  total?: number;
}

@Injectable({
  providedIn: 'root',
})
export class SolicitudesCambioService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);

  constructor() {
    this.tenant.registrarPurgadorLocal(() => this.limpiarEstadoLocal());
  }

  readonly solicitudes = signal<SolicitudCambio[]>([]);
  readonly total = signal<number>(0);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private limpiarEstadoLocal(): void {
    this.solicitudes.set([]);
    this.total.set(0);
    this.isLoading.set(false);
    this.error.set(null);
  }

  /** `GET /shops/:shopId/change-requests` · bandeja local, solo lectura. */
  cargarDeSede(barberiaId: string): Observable<SolicitudCambio[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<SolicitudCambio[]>(`${API_URL}/shops/${barberiaId}/change-requests`).pipe(
      tap((filas) => {
        // El endpoint devuelve un array; un cuerpo vacío no puede romper la tabla.
        this.solicitudes.set(Array.isArray(filas) ? filas : []);
        this.total.set(this.solicitudes().length);
        this.isLoading.set(false);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.solicitudes.set([]);
        this.total.set(0);
        this.error.set(
          err.error?.mensaje || err.error?.message || 'No se pudieron cargar las solicitudes de cambio',
        );
        throw err;
      }),
    );
  }

  /**
   * `GET /plataforma/solicitudes-cambio` · bandeja de plataforma (D32).
   * `barberiaId` nulo pide TODAS las sedes: es la supervisión centralizada.
   */
  cargarDePlataforma(barberiaId?: string | null): Observable<SolicitudCambio[]> {
    this.isLoading.set(true);
    this.error.set(null);

    let params = new HttpParams().set('page', 1).set('pageSize', 100);
    if (barberiaId) {
      params = params.set('barberiaId', barberiaId);
    }

    return this.http
      .get<PaginaSolicitudes>(`${API_URL}/plataforma/solicitudes-cambio`, { params })
      .pipe(
        tap((res) => {
          this.solicitudes.set(res?.data ?? []);
          this.total.set(res?.total ?? 0);
          this.isLoading.set(false);
        }),
        map((res) => res?.data ?? []),
        catchError((err) => {
          this.isLoading.set(false);
          this.solicitudes.set([]);
          this.total.set(0);
          this.error.set(
            err.error?.mensaje || err.error?.message || 'No se pudieron cargar las solicitudes de cambio',
          );
          throw err;
        }),
      );
  }

  /**
   * `POST /plataforma/solicitudes-cambio/:id/resolver` · solo `ADMINISTRADOR`.
   * Al aprobar un cambio de responsable el backend mueve `responsable_id`, el
   * rol `ADMIN_BARBERIA` y la auditoría en una sola transacción.
   */
  resolver(
    solicitudId: string,
    aprobar: boolean,
    motivoRechazo?: string,
  ): Observable<SolicitudCambio> {
    this.error.set(null);

    const cuerpo = aprobar ? { aprobar: true } : { aprobar: false, motivoRechazo };

    return this.http
      .post<SolicitudCambio>(`${API_URL}/plataforma/solicitudes-cambio/${solicitudId}/resolver`, cuerpo)
      .pipe(
        tap((resuelta) => {
          // La fila se sustituye en el sitio: el estado nuevo se ve al instante y
          // la sede del nombre se conserva (la respuesta de resolución no la trae).
          this.solicitudes.update((lista) =>
            lista.map((fila) => (fila.id === resuelta.id ? { ...fila, ...resuelta } : fila)),
          );
        }),
        catchError((err) => {
          this.error.set(
            err.error?.mensaje || err.error?.message || 'No se pudo resolver la solicitud',
          );
          throw err;
        }),
      );
  }
}
