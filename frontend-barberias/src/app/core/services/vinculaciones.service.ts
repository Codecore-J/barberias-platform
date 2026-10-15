import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap, map, catchError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

/**
 * E3-12 · bandeja de la 6.ª vinculación (D10).
 *
 * La sexta barbería de un cliente nace `PENDIENTE_APROBACION` y la resuelve la
 * PLATAFORMA, no la sede: el límite se cuenta por usuario, así que la decisión
 * es global. Estas son las tres rutas de `/plataforma/vinculaciones`, que el
 * backend declara `@Roles('ADMINISTRADOR')`.
 */
export interface VinculacionPendiente {
  vinculacionId: string;
  clienteId: string;
  nombreCompleto: string;
  correo: string;
  telefono: string | null;
  barberiaId: string;
  barberiaNombre: string;
  estadoVinculacion: string;
  /** Cuántas barberías acumula el cliente: el motivo de que esté pendiente (D10). */
  vinculacionesDelCliente: number;
  solicitadaAt: string | null;
}

export interface VinculacionResuelta {
  vinculacionId: string;
  clienteId: string;
  barberiaId: string;
  estadoVinculacion: string;
  /** Motivo del rechazo; `null` cuando se aprobó. */
  motivo: string | null;
  resueltoPor: string;
}

interface PaginaVinculaciones {
  data?: VinculacionPendiente[];
  total?: number;
}

@Injectable({
  providedIn: 'root'
})
export class VinculacionesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/plataforma/vinculaciones`;

  readonly pendientes = signal<VinculacionPendiente[]>([]);
  readonly total = signal<number>(0);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /**
   * `GET /plataforma/vinculaciones/pendientes` · forma D32 `{ data, total }`.
   *
   * El `error()` guarda el `mensaje` del contrato D40 cuando el backend lo
   * manda, para que la pantalla explique la regla en vez de un texto genérico
   * (mismo criterio que el catálogo de administración).
   */
  cargarPendientes(page = 1, pageSize = 20): Observable<VinculacionPendiente[]> {
    this.isLoading.set(true);
    this.error.set(null);

    const params = new HttpParams().set('page', page).set('pageSize', pageSize);

    return this.http
      .get<PaginaVinculaciones>(`${this.apiUrl}/pendientes`, { params })
      .pipe(
        tap((res) => {
          // Un `data` ausente no puede romper la tabla: se pinta vacío.
          this.pendientes.set(res?.data ?? []);
          this.total.set(res?.total ?? 0);
          this.isLoading.set(false);
        }),
        // La pantalla solo necesita la lista; el `total` queda en la señal.
        map((res) => res?.data ?? []),
        catchError((err) => {
          this.isLoading.set(false);
          this.pendientes.set([]);
          this.total.set(0);
          this.error.set(
            err.error?.mensaje ||
              err.error?.message ||
              'No se pudieron cargar las vinculaciones pendientes',
          );
          throw err;
        }),
      );
  }

  /**
   * `POST /plataforma/vinculaciones/:id/aprobar` · el vínculo pasa a `ACTIVO`.
   *
   * Tras resolver se recarga la bandeja: la fila resuelta desaparece de la
   * lista y el contador de pendientes tiene que bajar sin recargar la página.
   */
  aprobar(vinculacionId: string): Observable<VinculacionResuelta> {
    this.error.set(null);

    return this.http
      .post<VinculacionResuelta>(`${this.apiUrl}/${vinculacionId}/aprobar`, {})
      .pipe(
        tap(() => this.recargarBandeja()),
        catchError((err) => {
          this.error.set(
            err.error?.mensaje || err.error?.message || 'No se pudo aprobar la vinculación',
          );
          throw err;
        }),
      );
  }

  /**
   * `POST /plataforma/vinculaciones/:id/rechazar { motivo }` · el vínculo queda
   * `DESVINCULADO` y el motivo es obligatorio (el backend responde 422
   * `MOTIVO_REQUERIDO` si falta o es una palabra suelta).
   */
  rechazar(vinculacionId: string, motivo: string): Observable<VinculacionResuelta> {
    this.error.set(null);

    return this.http
      .post<VinculacionResuelta>(`${this.apiUrl}/${vinculacionId}/rechazar`, { motivo })
      .pipe(
        tap(() => this.recargarBandeja()),
        catchError((err) => {
          this.error.set(
            err.error?.mensaje || err.error?.message || 'No se pudo rechazar la vinculación',
          );
          throw err;
        }),
      );
  }

  /** La recarga es best-effort: si falla, la pantalla conserva el aviso del error. */
  private recargarBandeja(): void {
    this.isLoading.set(true);
    this.cargarPendientes().subscribe({ error: () => undefined });
  }
}
