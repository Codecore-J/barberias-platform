import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { HomeComponent } from './home.component';
import { AuthService } from '../../auth/auth.service';
import { TenantService } from '../../core/services/tenant.service';
import { ReservasService } from '../../core/services/reservas.service';
import { PagosService } from '../../core/services/pagos.service';
import { AnalyticsService } from '../../core/services/analytics.service';

/**
 * T-15 · qué dashboard ve cada quien.
 *
 * El home dejó de ser una sola pantalla de métricas: `vistaActual()` decide entre
 * la agregación de plataforma y la de la sede. Los cuatro casos del ticket son
 * cuatro combinaciones rol × sede, y la regla que hay que proteger es que
 * `plataforma` sea exclusiva del ADMINISTRADOR SIN sede —un ADMIN_BARBERIA nunca
 * ve la facturación de la red— y que el administrador global que YA eligió sede
 * vea la de esa sede, que es lo que pidió al elegirla.
 */
describe('HomeComponent · vistaActual() (T-15)', () => {
  const SEDE = { id: 'sede-1', nombre: 'Imperial Barbers' };

  /** Stubs mínimos: el home solo lee señales de estos servicios. */
  function configurar(roles: string[], sede: { id: string; nombre: string } | null) {
    const activa = signal(sede);
    const tenant = {
      barberiaActiva: activa,
      barberiaActivaId: computed(() => activa()?.id ?? null),
      barberiasVinculadas: signal([]),
      error: signal<string | null>(null),
      unirsePorInvitacion: vi.fn(),
      seleccionarBarberia: vi.fn(),
    };
    const auth = { authState: signal({ user: { roles, nombreCompleto: 'Prueba' } }) };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TenantService, useValue: tenant },
        { provide: ReservasService, useValue: { obtenerAgendaDiaria: vi.fn(() => of([])) } },
        { provide: PagosService, useValue: { obtenerHistorial: vi.fn(() => of([])) } },
        {
          provide: AnalyticsService,
          useValue: {
            getMetricasPlataformaHoy: vi.fn(() =>
              of({
                fecha: '2026-11-15',
                sedesActivas: 1,
                citasHoy: 0,
                recaudadoHoy: 0,
                cajasAbiertas: 0,
                usuariosActivos: 1,
              }),
            ),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ADMINISTRADOR sin sede → plataforma', () => {
    const componente = configurar(['ADMINISTRADOR'], null);
    expect(componente.vistaActual()).toBe('plataforma');
  });

  it('ADMINISTRADOR con sede → sede (eligió sede, ve su sede)', () => {
    const componente = configurar(['ADMINISTRADOR'], SEDE);
    expect(componente.vistaActual()).toBe('sede');
  });

  it('ADMIN_BARBERIA con sede → sede', () => {
    const componente = configurar(['ADMIN_BARBERIA'], SEDE);
    expect(componente.vistaActual()).toBe('sede');
  });

  it('ADMIN_BARBERIA sin sede → sede (estado vacío orientado, nunca la red)', () => {
    const componente = configurar(['ADMIN_BARBERIA'], null);
    expect(componente.vistaActual()).toBe('sede');
  });

  it('CLIENTE sin sede → sede, para no pintarle un panel de plataforma', () => {
    const componente = configurar(['CLIENTE'], null);
    expect(componente.vistaActual()).toBe('sede');
  });

  it('reacciona al cambiar de sede sin recargar la página', () => {
    const activa = signal<{ id: string; nombre: string } | null>(null);
    const tenant = {
      barberiaActiva: activa,
      barberiaActivaId: computed(() => activa()?.id ?? null),
      barberiasVinculadas: signal([]),
      error: signal<string | null>(null),
      unirsePorInvitacion: vi.fn(),
      seleccionarBarberia: vi.fn(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { authState: signal({ user: { roles: ['ADMINISTRADOR'] } }) },
        },
        { provide: TenantService, useValue: tenant },
        { provide: ReservasService, useValue: { obtenerAgendaDiaria: vi.fn(() => of([])) } },
        { provide: PagosService, useValue: { obtenerHistorial: vi.fn(() => of([])) } },
        {
          provide: AnalyticsService,
          useValue: { getMetricasPlataformaHoy: vi.fn(() => of({ fecha: '2026-11-15' })) },
        },
      ],
    });

    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.vistaActual()).toBe('plataforma');

    activa.set(SEDE);
    fixture.detectChanges();
    expect(fixture.componentInstance.vistaActual()).toBe('sede');
  });
});
