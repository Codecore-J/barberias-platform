import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsDashboardComponent } from './analytics-dashboard.component';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { TenantService } from '../../../core/services/tenant.service';
import { AuthService } from '../../../auth/auth.service';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
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
    nombreBarberiaActiva: () => string;
    registrarPurgadorLocal: (purgador: () => void) => void;
  };
  let routerSpy: { navigate: (commands: any[]) => Promise<boolean> };
  let authState: ReturnType<typeof signal<any>>;

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
      nombreBarberiaActiva: vi.fn(() => 'Sede Norte'),
      registrarPurgadorLocal: vi.fn(),
    };
    authState = signal({ user: { roles: ['ADMIN_BARBERIA'] } });
    routerSpy = {
      navigate: vi.fn(() => Promise.resolve(true)),
    };

    await TestBed.configureTestingModule({
      imports: [AnalyticsDashboardComponent],
      providers: [
        { provide: AnalyticsService, useValue: analyticsServiceSpy },
        { provide: TenantService, useValue: tenantServiceSpy },
        { provide: AuthService, useValue: { authState } },
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
    expect(compiled.textContent).toContain('Tasa de inasistencia');
    expect(compiled.textContent).toContain('Tasa de cancelación');
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

    const boton = fixture.nativeElement.querySelector('[data-testid="export-csv"]') as HTMLButtonElement;
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

/**
 * T-16 · el alcance de la pantalla tiene que ser legible en el encabezado.
 *
 * La regla del ticket: el usuario nunca debe dudar si ve UNA sede o TODAS. Aquí
 * se comprueban las tres combinaciones (ADMIN_BARBERIA, ADMINISTRADOR con sede,
 * ADMINISTRADOR sin sede) y, sobre todo, que la vista consolidada no herede el
 * «Rendimiento de la sede» ni el error de «no hay sede activa».
 */
describe('AnalyticsDashboardComponent — alcance visual (T-16)', () => {
  const overviewDosSedes = {
    periodo: { desde: '2026-10-01', hasta: '2026-10-31' },
    totalesGlobales: {
      ingresosConsolidados: 5000,
      totalCitas: 20,
      tasaGlobalInasistencia: 10,
      tasaGlobalCancelacion: 15,
    },
    sedes: [
      { barberiaId: 's1', nombre: 'Sede Norte', activa: true, ingresos: 2500, totalCitas: 10, citasCompletadas: 8, tasaInasistencia: 10, recordatoriosEnviados: 5 },
      { barberiaId: 's2', nombre: 'Sede Sur', activa: true, ingresos: 2500, totalCitas: 10, citasCompletadas: 7, tasaInasistencia: 10, recordatoriosEnviados: 3 },
    ],
  };

  const dataSede = {
    periodo: { desde: '2026-10-01', hasta: '2026-10-31' },
    resumenCitas: { total: 10, porEstado: { COMPLETADA: 10 } },
    retencion: { tasaInasistencia: 0, tasaCancelacion: 0, recordatoriosEnviados: 0, cuposListaEsperaNotificados: 0 },
    ingresos: { totalRecaudado: 1000, ticketPromedio: 100, porMetodoPago: { EFECTIVO: 1000 } },
    rendimientoPorBarbero: [],
  };

  function montar(roles: string[], sedeId: string | null): {
    fixture: ComponentFixture<AnalyticsDashboardComponent>;
    getAnalytics: ReturnType<typeof vi.fn>;
    texto: () => string;
  } {
    const getAnalytics = vi.fn(() => of(dataSede));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AnalyticsDashboardComponent],
      providers: [
        {
          provide: AnalyticsService,
          useValue: {
            getAnalytics,
            getShopsOverview: vi.fn(() => of(overviewDosSedes)),
            exportAnalytics: vi.fn(() => of(new Blob(['a,b']))),
          },
        },
        {
          provide: TenantService,
          useValue: {
            barberiasVinculadas: vi.fn(() => []),
            seleccionarBarberia: vi.fn(() => of({})),
            barberiaActivaId: vi.fn(() => sedeId),
            nombreBarberiaActiva: vi.fn(() => 'Sede Norte'),
            registrarPurgadorLocal: vi.fn(),
          },
        },
        { provide: AuthService, useValue: { authState: signal({ user: { roles } }) } },
        { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)) } },
      ],
    });

    const fixture = TestBed.createComponent(AnalyticsDashboardComponent);
    fixture.detectChanges();
    return {
      fixture,
      getAnalytics,
      texto: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  it('ADMIN_BARBERIA → anuncia SU sede y no habla de consolidado', () => {
    const { texto, getAnalytics, fixture } = montar(['ADMIN_BARBERIA'], 's1');

    expect(getAnalytics).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.alcance()).toBe('sede');
    expect(texto()).toContain('Analíticas');
    expect(texto()).toContain('Sede Norte');
    expect(texto()).toContain('Rendimiento de esta sede en el periodo seleccionado.');
    expect(texto()).not.toContain('Todas las sedes');
    expect(texto()).not.toContain('Vista global');
  });

  it('ADMINISTRADOR con sede activa → anuncia esa sede', () => {
    const { texto, fixture } = montar(['ADMINISTRADOR'], 's1');

    expect(fixture.componentInstance.alcance()).toBe('sede');
    expect(texto()).toContain('Sede Norte');
    expect(texto()).not.toContain('Todas las sedes');
  });

  it('ADMINISTRADOR sin sede → «Todas las sedes», badge de consolidado y ningún error', () => {
    const { texto, getAnalytics, fixture } = montar(['ADMINISTRADOR'], null);

    // No hay una sede que pedir: no se dispara la lectura de sede ni se inventa
    // un error por no tenerla.
    expect(getAnalytics).not.toHaveBeenCalled();
    expect(fixture.componentInstance.alcance()).toBe('consolidado');
    expect(fixture.componentInstance.error).toBeNull();

    expect(texto()).toContain('Todas las sedes');
    expect(texto()).toContain('Vista global · 2 sedes');
    expect(texto()).toContain('Rendimiento consolidado de la plataforma en el periodo seleccionado.');
    expect(texto()).toContain('Resumen consolidado');
    expect(texto()).not.toContain('No hay una sede activa seleccionada');
    expect(texto()).not.toContain('Rendimiento de esta sede');
  });

  it('nunca dice «Rendimiento de la sede» cuando los datos son multisede', () => {
    const { texto } = montar(['ADMINISTRADOR'], null);
    expect(texto()).not.toContain('Rendimiento de la sede');
  });

  it('ADMIN_BARBERIA sin sede → sigue pidiendo elegir una sede, sin anunciar consolidado', () => {
    const { texto, fixture } = montar(['ADMIN_BARBERIA'], null);

    expect(fixture.componentInstance.alcance()).toBe('sede');
    expect(texto()).toContain('No hay una sede activa seleccionada');
    expect(texto()).not.toContain('Todas las sedes');
  });
});
