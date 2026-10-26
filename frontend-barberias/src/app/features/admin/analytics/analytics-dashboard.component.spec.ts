import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsDashboardComponent } from './analytics-dashboard.component';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { TenantService } from '../../../core/services/tenant.service';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';

describe('AnalyticsDashboardComponent', () => {
  let component: AnalyticsDashboardComponent;
  let fixture: ComponentFixture<AnalyticsDashboardComponent>;
  let analyticsServiceSpy: {
    getAnalytics: (desde?: string, hasta?: string) => any;
    getShopsOverview: (desde?: string, hasta?: string) => any;
    exportAnalytics: (desde?: string, hasta?: string) => any;
  };
  let tenantServiceSpy: {
    barberiasVinculadas: () => any[];
    seleccionarBarberia: (id: string) => any;
    barberiaActivaId: () => string | null;
  };
  let routerSpy: { navigate: (commands: any[]) => Promise<boolean> };

  const mockData = {
    periodo: { desde: '2026-10-01', hasta: '2026-10-31' },
    resumenCitas: { total: 10, porEstado: { COMPLETADA: 6, INASISTENCIA: 1, CANCELADA: 2, PENDIENTE: 1 } },
    retencion: { tasaInasistencia: 10, tasaCancelacion: 20, recordatoriosEnviados: 5, cuposListaEsperaNotificados: 3 },
    ingresos: { totalRecaudado: 2500, ticketPromedio: 416.67, porMetodoPago: { EFECTIVO: 1500, TARJETA: 1000 } },
    rendimientoPorBarbero: [
      { barberoId: 'b1', nombre: 'Carlos', citasCompletadas: 4, inasistencias: 0, ingresosGenerados: 1200 },
      { barberoId: 'b2', nombre: 'Luis', citasCompletadas: 2, inasistencias: 1, ingresosGenerados: 800 },
    ],
  };

  const mockOverview = {
    periodo: { desde: '2026-10-01', hasta: '2026-10-31' },
    totalesGlobales: { ingresosConsolidados: 5000, totalCitas: 20, tasaGlobalInasistencia: 10, tasaGlobalCancelacion: 15 },
    sedes: [
      { barberiaId: 's1', nombre: 'Sede Norte', activa: true, ingresos: 2500, totalCitas: 10, citasCompletadas: 8, tasaInasistencia: 10, recordatoriosEnviados: 5 },
      { barberiaId: 's2', nombre: 'Sede Sur', activa: true, ingresos: 2500, totalCitas: 10, citasCompletadas: 7, tasaInasistencia: 10, recordatoriosEnviados: 3 },
    ],
  };

  beforeEach(async () => {
    analyticsServiceSpy = {
      getAnalytics: vi.fn(() => of(mockData)),
      getShopsOverview: vi.fn(() => of(mockOverview)),
      exportAnalytics: vi.fn(() => of(new Blob(['a,b'], { type: 'text/csv' }))),
    };
    tenantServiceSpy = {
      barberiasVinculadas: vi.fn(() => []),
      seleccionarBarberia: vi.fn(() => of({})),
      barberiaActivaId: vi.fn(() => 's1'),
    };
    routerSpy = {
      navigate: vi.fn(() => Promise.resolve(true)),
    };

    await TestBed.configureTestingModule({
      imports: [AnalyticsDashboardComponent],
      providers: [
        { provide: AnalyticsService, useValue: analyticsServiceSpy },
        { provide: TenantService, useValue: tenantServiceSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticsDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('crea el componente', () => {
    expect(component).toBeTruthy();
  });

  it('carga analíticas al inicializar', () => {
    expect(analyticsServiceSpy.getAnalytics).toHaveBeenCalledTimes(1);
    expect(component.data).toEqual(mockData);
  });

  it('renderiza KPIs y tabla de barberos', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Ingresos totales');
    expect(compiled.textContent).toContain('Ticket promedio');
    expect(compiled.textContent).toContain('Tasa de Inasistencia');
    expect(compiled.textContent).toContain('Tasa de Cancelación');
    expect(compiled.textContent).toContain('Recordatorios enviados');
    expect(compiled.textContent).toContain('Cupos de lista de espera notificados');
    expect(compiled.textContent).toContain('Carlos');
    expect(compiled.textContent).toContain('Luis');
  });

  it('descarga el CSV al pulsar Exportar CSV', () => {
    const createObjectURL = vi.fn(() => 'blob:reporte');
    const revokeObjectURL = vi.fn();
    const originales = {
      create: (window.URL as any).createObjectURL,
      revoke: (window.URL as any).revokeObjectURL,
    };
    (window.URL as any).createObjectURL = createObjectURL;
    (window.URL as any).revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const boton = fixture.nativeElement.querySelector('.export-button') as HTMLButtonElement;
    boton.click();

    expect(analyticsServiceSpy.exportAnalytics).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:reporte');

    clickSpy.mockRestore();
    (window.URL as any).createObjectURL = originales.create;
    (window.URL as any).revokeObjectURL = originales.revoke;
  });

  it('muestra resumen multisede cuando hay más de una sede', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Resumen Multisede');
    expect(compiled.textContent).toContain('Sede Norte');
    expect(compiled.textContent).toContain('Sede Sur');
    expect(compiled.textContent).toContain('Ir a esta sede');
  });
});
