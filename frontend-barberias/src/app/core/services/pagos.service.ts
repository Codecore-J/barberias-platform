import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_URL } from '../constants/api.constants';
import { TenantService } from './tenant.service';

/**
 * H68 · el recibo de un cobro tal como lo sirve
 * `GET /shops/:shopId/payments/history`.
 *
 * Es el ESTADO VIVO del pago —incluido `ANULADO`—, no el rastro de auditoría: por
 * eso trae el `id` de la FILA (lo que permite corregirla) y el detalle de la cita
 * con los precios HISTÓRICOS de la reserva, que son los que se cobraron.
 */
export interface PagoHistorial {
  id: string;
  reservaId: string;
  estadoPago: string;
  estadoReserva: string | null;
  monto: number;
  metodoPago: string;
  registradoAt: string | null;
  registradoPor: { id: string; nombreCompleto: string; correo: string } | null;
  anuladoAt: string | null;
  anuladoPor: { id: string; nombreCompleto: string; correo: string } | null;
  motivoAnulacion: string | null;
  cita: { fecha: string | null; horaInicio: string | null; horaFin: string | null };
  cliente: { id: string; nombreCompleto: string } | null;
  servicios: { nombre: string; precio: number }[];
}

@Injectable({
  providedIn: 'root'
})
export class PagosService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  private readonly apiUrl = `${API_URL}`;

  /** Fase 5: la sede vive en la ruta (`/shops/:shopId/payments`). */
  private get pagosUrl(): string {
    return `${API_URL}/shops/${this.tenant.barberiaActivaId()}/payments`;
  }

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly pagos = signal<PagoHistorial[]>([]);

  /**
   * H68 · el historial de cobros de la sede activa.
   *
   * Cambió de fuente a propósito: antes leía `/cobros/auditoria` —el rastro
   * inmutable—, que no devuelve el estado del pago ni el id de su fila, así que
   * la tabla no podía mostrar una anulación ni ofrecer corregirla. La barbería
   * viaja en la RUTA (`/shops/:shopId/payments/history`), no en una cabecera.
   */
  obtenerHistorial(page = 1, pageSize = 50): Observable<PagoHistorial[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http
      .get<any>(`${this.pagosUrl}/history?page=${page}&pageSize=${pageSize}`)
      .pipe(
        map(res => res.data || []),
        tap((data) => {
          this.pagos.set(data);
          this.isLoading.set(false);
        }),
        catchError(err => {
          this.isLoading.set(false);
          this.error.set(err.error?.mensaje || err.error?.message || 'Error al obtener el historial de pagos');
          return of([]);
        })
      );
  }

  /**
   * H68 · §7.3: corrige un cobro anulándolo.
   *
   * El motivo es obligatorio (422 `MOTIVO_REQUERIDO`) y queda en la auditoría: una
   * operación que deshace un ingreso tiene que poder explicarse después. Solo la
   * sede puede anular; el backend responde 403 si quien lo intenta es un barbero.
   */
  anularPago(pagoId: string, motivo: string): Observable<any> {
    return this.http.post<any>(`${this.pagosUrl}/${pagoId}/void`, { motivo });
  }

  /**
   * Obtiene estadísticas agregadas de auditoría (para ADMINISTRADOR)
   */
  obtenerEstadisticasAuditoria(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/auditoria/estadisticas`).pipe(
      catchError(() => of(null))
    );
  }

  /**
   * Ejecuta purga manual de registros de auditoría más antiguos de X días (solo ADMINISTRADOR)
   */
  purgarAuditoria(dias = 365): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/auditoria/purgar?dias=${dias}`, {});
  }
}

