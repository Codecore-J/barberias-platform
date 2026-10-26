import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '../constants/api.constants';
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

 feature/frontend-analytics-dashboard

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

 main
@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  constructor(
    private http: HttpClient,
    private tenantService: TenantService,
  ) {}

  getAnalytics(desde?: string, hasta?: string): Observable<ShopAnalyticsResponse> {
    const shopId = this.tenantService.barberiaActivaId();
    let params = new HttpParams();
    if (desde) {
      params = params.set('desde', desde);
    }
    if (hasta) {
      params = params.set('hasta', hasta);
    }
    return this.http.get<ShopAnalyticsResponse>(`${API_URL}/shops/${shopId}/analytics`, { params });
  }
 feature/frontend-analytics-dashboard


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
 main
}
