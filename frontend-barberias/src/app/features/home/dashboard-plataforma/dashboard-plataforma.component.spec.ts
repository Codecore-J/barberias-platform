import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { DashboardPlataformaComponent } from './dashboard-plataforma.component';
import { AnalyticsService } from '../../../core/services/analytics.service';
import type { MetricasPlataformaHoy } from '../../../core/services/analytics.service';
import { AuthService } from '../../../auth/auth.service';

/**
 * T-15 · el dashboard de plataforma tiene que distinguir TRES estados.
 *
 * El requisito explícito del ticket es no volver a mostrar `$0` cuando los datos
 * no han llegado: un cero es un dato y un fallo no lo es. Por eso las
 * aserciones miran el estado, el texto de error y la ausencia de cifras durante
 * la carga, no solo que el componente exista.
 */
describe('DashboardPlataformaComponent (T-15)', () => {
  let fixture: ComponentFixture<DashboardPlataformaComponent>;
  let analytics: { getMetricasPlataformaHoy: ReturnType<typeof vi.fn> };

  const METRICAS: MetricasPlataformaHoy = {
    fecha: '2026-11-15',
    sedesActivas: 4,
    citasHoy: 23,
    recaudadoHoy: 8450.75,
    cajasAbiertas: 2,
    usuariosActivos: 118,
  };

  const texto = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  function crear(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardPlataformaComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { authState: signal({ user: { nombreCompleto: 'Admin Global', roles: ['ADMINISTRADOR'] } }) },
        },
        { provide: AnalyticsService, useValue: analytics },
      ],
    });

    fixture = TestBed.createComponent(DashboardPlataformaComponent);
  }

  beforeEach(() => {
    analytics = { getMetricasPlataformaHoy: vi.fn(() => of(METRICAS)) };
  });

  it('empieza en carga y no pinta cifras mientras no hay respuesta', () => {
    const pendiente = new Subject<MetricasPlataformaHoy>();
    analytics.getMetricasPlataformaHoy.mockReturnValue(pendiente.asObservable());

    crear();
    fixture.detectChanges();

    expect(fixture.componentInstance.estado()).toBe('cargando');
    expect(texto()).not.toContain('$');
    expect(texto()).not.toMatch(/\b118\b/);

    pendiente.next(METRICAS);
    pendiente.complete();
    fixture.detectChanges();
    expect(fixture.componentInstance.estado()).toBe('ok');
  });

  it('muestra los cinco contadores cuando la API responde', () => {
    crear();
    fixture.detectChanges();

    expect(fixture.componentInstance.estado()).toBe('ok');
    expect(analytics.getMetricasPlataformaHoy).toHaveBeenCalledTimes(1);

    const contenido = texto();
    expect(contenido).toContain('4'); // sedes activas
    expect(contenido).toContain('23'); // citas hoy
    expect(contenido).toContain('8,450.75'); // recaudado hoy
    expect(contenido).toContain('2'); // cajas abiertas
    expect(contenido).toContain('118'); // usuarios activos
    expect(contenido).toContain('15/11/2026');
  });

  it('muestra un error claro y ningún cero cuando la API falla', () => {
    analytics.getMetricasPlataformaHoy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { codigo: 'SIN_PERMISO', mensaje: 'No tienes permisos para ver las métricas globales.' },
          }),
      ),
    );

    crear();
    fixture.detectChanges();

    expect(fixture.componentInstance.estado()).toBe('error');
    expect(fixture.componentInstance.metricas()).toBeNull();

    const contenido = texto();
    expect(contenido).toContain('No pudimos cargar las métricas de la plataforma');
    expect(contenido).toContain('No tienes permisos para ver las métricas globales.');
    // Ni un cero disfrazado de dato.
    expect(contenido).not.toContain('$0.00');
    expect(contenido).not.toContain('Sedes activas');
  });

  it('distingue el cero REAL de un fallo: dice «sin citas» con cifras en pantalla', () => {
    analytics.getMetricasPlataformaHoy.mockReturnValue(
      of({ ...METRICAS, citasHoy: 0, recaudadoHoy: 0, cajasAbiertas: 0 }),
    );

    crear();
    fixture.detectChanges();

    expect(fixture.componentInstance.estado()).toBe('ok');
    expect(fixture.componentInstance.metricas()?.citasHoy).toBe(0);
    const contenido = texto();
    expect(contenido).toContain('Sin citas agendadas hoy');
    expect(contenido).toContain('Sin cobros registrados hoy');
  });

  it('el botón de reintento vuelve a pedir las métricas', () => {
    analytics.getMetricasPlataformaHoy.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 500, error: {} })),
    );
    analytics.getMetricasPlataformaHoy.mockReturnValue(of(METRICAS));

    crear();
    fixture.detectChanges();
    expect(fixture.componentInstance.estado()).toBe('error');

    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Reintentar'));
    boton?.click();
    fixture.detectChanges();

    expect(analytics.getMetricasPlataformaHoy).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.estado()).toBe('ok');
  });
});
