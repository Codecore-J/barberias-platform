import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsDashboardComponent } from './analytics-dashboard.component';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { of } from 'rxjs';

describe('AnalyticsDashboardComponent', () => {
  let component: AnalyticsDashboardComponent;
  let fixture: ComponentFixture<AnalyticsDashboardComponent>;
  let analyticsServiceSpy: jasmine.SpyObj<AnalyticsService>;

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

  beforeEach(async () => {
    analyticsServiceSpy = jasmine.createSpyObj('AnalyticsService', ['getAnalytics']);
    analyticsServiceSpy.getAnalytics.and.returnValue(of(mockData));

    await TestBed.configureTestingModule({
      imports: [AnalyticsDashboardComponent],
      providers: [{ provide: AnalyticsService, useValue: analyticsServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticsDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('crea el componente', () => {
    expect(component).toBeTruthy();
  });

  it('carga analíticas al inicializar', () => {
    expect(analyticsServiceSpy.getAnalytics).toHaveBeenCalled();
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

  it('aplica filtro rápido últimos 7 días', () => {
    analyticsServiceSpy.getAnalytics.calls.reset();
    component.aplicarFiltroRapido('7');
    expect(analyticsServiceSpy.getAnalytics).toHaveBeenCalled();
  });
});
