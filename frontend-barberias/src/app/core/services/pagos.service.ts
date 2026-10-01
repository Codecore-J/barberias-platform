import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_URL } from '../constants/api.constants';

export interface PagoAuditoria {
  id: string;
  monto: number;
  metodoPago: string;
  estadoPago: string;
  creadoAt: string;
  reservaSnapshot: any; // El snapshot inmutable guardado en JSON
  realizadoPor: {
    nombreCompleto: string;
    email: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PagosService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}`;

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly pagos = signal<PagoAuditoria[]>([]);

  /**
   * Obtiene la auditoría de pagos de una barbería
   */
  obtenerHistorial(limite = 50, offset = 0): Observable<PagoAuditoria[]> {
    this.isLoading.set(true);
    this.error.set(null);
    
    return this.http.get<any>(`${this.apiUrl}/cobros/auditoria?limite=${limite}&offset=${offset}`).pipe(
      map(res => res.data || []),
      tap((data) => {
        this.pagos.set(data);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al obtener el historial de pagos');
        return of([]);
      })
    );
  }

  /**
   * Obtiene estadísticas agregadas de auditoría (para SUPER_ADMIN / ADMIN)
   */
  obtenerEstadisticasAuditoria(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/auditoria/estadisticas`).pipe(
      catchError(() => of(null))
    );
  }

  /**
   * Ejecuta purga manual de registros de auditoría más antiguos de X días (solo SUPER_ADMIN)
   */
  purgarAuditoria(dias = 365): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/auditoria/purgar?dias=${dias}`, {});
  }
}

