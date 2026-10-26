import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AnalyticsService } from './analytics.service';
import { TenantService } from './tenant.service';
import { API_URL } from '../constants/api.constants';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let httpMock: HttpTestingController;
  let tenantServiceSpy: { barberiaActivaId: () => string | null };

  beforeEach(() => {
    tenantServiceSpy = {
      barberiaActivaId: vi.fn(() => 'shop-123'),
    };

    TestBed.configureTestingModule({
      providers: [
        AnalyticsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TenantService, useValue: tenantServiceSpy },
      ],
    });

    service = TestBed.inject(AnalyticsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('arma la URL con shopId activo y envía parámetros de fecha', () => {
    service.getAnalytics('2026-10-01', '2026-10-31').subscribe((res) => {
      expect(res).toBeTruthy();
    });

    const req = httpMock.expectOne(
      (r: any) =>
        r.method === 'GET' &&
        r.url === `${API_URL}/shops/shop-123/analytics` &&
        r.params.get('desde') === '2026-10-01' &&
        r.params.get('hasta') === '2026-10-31',
    );
    expect(tenantServiceSpy.barberiaActivaId).toHaveBeenCalled();
    req.flush({
      periodo: { desde: '2026-10-01', hasta: '2026-10-31' },
      resumenCitas: { total: 10, porEstado: { COMPLETADA: 8 } },
      retencion: { tasaInasistencia: 10, tasaCancelacion: 5, recordatoriosEnviados: 7, cuposListaEsperaNotificados: 2 },
      ingresos: { totalRecaudado: 1500, ticketPromedio: 187.5, porMetodoPago: { EFECTIVO: 1000, TARJETA: 500 } },
      rendimientoPorBarbero: [{ barberoId: 'b1', nombre: 'Juan', citasCompletadas: 5, inasistencias: 1, ingresosGenerados: 800 }],
    });
  });

  it('no envía parámetros si no se pasan fechas', () => {
    service.getAnalytics().subscribe();
    const req = httpMock.expectOne(`${API_URL}/shops/shop-123/analytics`);
    expect(req.request.params.keys().length).toBe(0);
    req.flush({} as any);
  });
});
