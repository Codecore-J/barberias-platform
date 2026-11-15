import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants';
import { MENSAJE_SIN_SEDE, haySede } from '../utils/sede';
import { TenantService } from './tenant.service';

export interface ResumenCitas {
  total: number;
  porEstado: Record<string, number>;
}

export interface RetencionAnalytics {
  tasaInasistencia: number;
  tasaCancelacion: number;
  recordatoriosEnviados: number;
  cuposListaEsperaNotificados: number;
}

export interface IngresosAnalytics {
  totalRecaudado: number;
  ticketPromedio: number;
  porMetodoPago: Record<string, number>;
}

export interface RendimientoPorBarbero {
  barberoId: string;
  nombre: string;
  citasCompletadas: number;
  inasistencias: number;
  ingresosGenerados: number;
}

export interface ShopAnalyticsResponse {
  periodo: { desde: string; hasta: string };
  resumenCitas: ResumenCitas;
  retencion: RetencionAnalytics;
  ingresos: IngresosAnalytics;
  rendimientoPorBarbero: RendimientoPorBarbero[];
}

export interface SedeOverview {
  barberiaId: string;
  nombre: string;
  activa: boolean;
  ingresos: number;
  totalCitas: number;
  citasCompletadas: number;
  tasaInasistencia: number;
  recordatoriosEnviados: number;
}

export interface ShopsOverviewResponse {
  periodo: { desde: string; hasta: string };
  totalesGlobales: {
    ingresosConsolidados: number;
    totalCitas: number;
    tasaGlobalInasistencia: number;
    tasaGlobalCancelacion: number;
  };
  sedes: SedeOverview[];
}

/**
 * T-15 · métricas del día de TODA la plataforma.
 *
 * Es el contrato del home del ADMINISTRADOR sin sede activa: cinco contadores ya
 * agregados por el backend, sin recorrer sedes ni pedir la agenda de cada una.
 * Todos son números: un `0` aquí es un cero real, no un fallo disfrazado.
 */
export interface MetricasPlataformaHoy {
  /** Etiqueta local `YYYY-MM-DD` del día medido. */
  fecha: string;
  sedesActivas: number;
  citasHoy: number;
  recaudadoHoy: number;
  cajasAbiertas: number;
  usuariosActivos: number;
}

@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  constructor(
    private http: HttpClient,
    private tenantService: TenantService,
  ) {}

  /**
   * Analíticas de la SEDE activa.
   *
   * El panel ya comprobaba la sede antes de llamar, pero el servicio no: una
   * llamada desde cualquier otra pantalla componía `/shops/null/analytics` y el
   * `ParseUUIDPipe` respondía 400. Aquí se falla con mensaje de negocio.
   */
  getAnalytics(desde?: string, hasta?: string): Observable<ShopAnalyticsResponse> {
    const shopId = this.tenantService.barberiaActivaId();
    if (!haySede(shopId)) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    let params = new HttpParams();
    if (desde) {
      params = params.set('desde', desde);
    }
    if (hasta) {
      params = params.set('hasta', hasta);
    }
    return this.http.get<ShopAnalyticsResponse>(`${API_URL}/shops/${shopId}/analytics`, { params });
  }

  /** Paso 13 · descarga el CSV del panel como blob (no JSON). */
  exportAnalytics(desde?: string, hasta?: string): Observable<Blob> {
    const shopId = this.tenantService.barberiaActivaId();
    if (!haySede(shopId)) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    let params = new HttpParams();
    if (desde) {
      params = params.set('desde', desde);
    }
    if (hasta) {
      params = params.set('hasta', hasta);
    }
    return this.http.get(`${API_URL}/shops/${shopId}/analytics/export`, {
      params,
      responseType: 'blob',
    });
  }

  /**
   * Consolidado multisede (`GET /shops/overview`).
   *
   * NO necesita sede activa: es la única lectura realmente global del panel, y
   * por eso el backend la resuelve por alcance del rol.
   */
  /**
   * T-15 · `GET /analytics/plataforma/hoy`.
   *
   * Sin sede a propósito: es la lectura global del home del ADMINISTRADOR. El
   * backend la acota por rol, así que un ADMIN_BARBERIA recibiría 403 y la
   * tarjeta debe mostrar el error, no ceros.
   */
  getMetricasPlataformaHoy(): Observable<MetricasPlataformaHoy> {
    return this.http.get<MetricasPlataformaHoy>(`${API_URL}/analytics/plataforma/hoy`);
  }

  getShopsOverview(desde?: string, hasta?: string): Observable<ShopsOverviewResponse> {
    let params = new HttpParams();
    if (desde) {
      params = params.set('desde', desde);
    }
    if (hasta) {
      params = params.set('hasta', hasta);
    }
    return this.http.get<ShopsOverviewResponse>(`${API_URL}/shops/overview`, { params });
  }
}
