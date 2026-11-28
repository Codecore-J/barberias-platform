import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { DashboardSedeComponent } from './dashboard-sede.component';
import { TenantService } from '../../../core/services/tenant.service';
import { ReservasService } from '../../../core/services/reservas.service';
import { PagosService } from '../../../core/services/pagos.service';
import { AuthService } from '../../../auth/auth.service';

/**
 * T-15 · dashboard de sede.
 *
 * Dos cosas que el ticket pide explícitamente: que el ADMIN_BARBERIA sin sede
 * reciba el estado vacío orientado (no un panel en $0) y que sin sede NO se
 * dispare ninguna petición con `null` en la URL. Y una tercera que se conserva
 * del código movido: un pago ANULADO no suma a los ingresos del día.
 */
describe('DashboardSedeComponent (T-15)', () => {
  let fixture: ComponentFixture<DashboardSedeComponent>;
  let reservas: { obtenerAgendaDiaria: ReturnType<typeof vi.fn> };
  let pagos: { obtenerHistorial: ReturnType<typeof vi.fn> };

  const texto = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  function configurar(
    sede: { id: string; nombre: string } | null,
    rol = 'ADMIN_BARBERIA',
  ): void {
    const activa = signal(sede);
    const tenant = {
      barberiaActiva: activa,
      barberiaActivaId: computed(() => activa()?.id ?? null),
    };
    const auth = {
      authState: () => ({ user: { roles: [rol] }, isAuthenticated: true }),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardSedeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: TenantService, useValue: tenant },
        { provide: AuthService, useValue: auth },
        { provide: ReservasService, useValue: reservas },
        { provide: PagosService, useValue: pagos },
      ],
    });

    fixture = TestBed.createComponent(DashboardSedeComponent);
  }

  beforeEach(() => {
    reservas = {
      obtenerAgendaDiaria: vi.fn(() =>
        of([
          { id: 'r1', estado: 'COMPLETADA', barbero: { id: 'b1', nombre: 'Luis Medina' } },
          { id: 'r2', estado: 'COMPLETADA', barbero: { id: 'b1', nombre: 'Luis Medina' } },
          { id: 'r3', estado: 'CANCELADA', barbero: { id: 'b2', nombre: 'Rafael Ortiz' } },
        ]),
      ),
    };
    pagos = {
      obtenerHistorial: vi.fn(() =>
        of([
          { id: 'p1', estadoPago: 'PAGADA', monto: 350, registradoAt: new Date().toISOString() },
          { id: 'p2', estadoPago: 'ANULADO', monto: 999, registradoAt: new Date().toISOString() },
        ]),
      ),
    };
  });

  it('sin sede muestra el estado vacío orientado y no pide nada con null', async () => {
    configurar(null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const contenido = texto();
    expect(contenido).toContain('Selecciona una sede para comenzar');
    expect(contenido).toContain('Ver mis sedes');
    expect(reservas.obtenerAgendaDiaria).not.toHaveBeenCalled();
    expect(pagos.obtenerHistorial).not.toHaveBeenCalled();
  });

  it('con sede pinta turnos, ingresos sin anulados y el barbero top', async () => {
    configurar({ id: 'sede-1', nombre: 'Imperial Barbers' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const componente = fixture.componentInstance;
    expect(componente.completadosHoy()).toBe(2);
    expect(componente.canceladosHoy()).toBe(1);
    // 999 es de un pago ANULADO: no es ingreso del día.
    expect(componente.ingresosHoy()).toBe(350);
    expect(componente.barberoProductivo()).toBe('Luis Medina');

    const contenido = texto();
    expect(contenido).toContain('Imperial Barbers');
    expect(contenido).toContain('Luis Medina');
    expect(reservas.obtenerAgendaDiaria).toHaveBeenCalledTimes(1);
  });

  /**
   * T-26 · el ADMINISTRADOR global también llega a este dashboard cuando elige
   * una sede, pero `payments/history` es solo del ADMIN_BARBERIA: pedirla deja
   * un error en la consola y tumbaba las métricas de la sede. La agenda se
   * sigue cargando; la caja no se pide.
   */
  /**
   * F8 / T-85 · la carga inicial no puede ser todo-o-nada.
   *
   * Antes un único `Promise.all` retenía las tres tarjetas hasta que la caja
   * respondía: si `/payments/history` tardaba, «Turnos completados» —que ya
   * estaba en memoria— seguía escondido tras un esqueleto. Ahora lo crítico se
   * pinta en cuanto llega y lo que falta se ve cargando en SU tarjeta.
   */
  it('ROJO: los turnos se pintan en cuanto llega la agenda, sin esperar la caja', async () => {
    const cajaPendiente = new Subject<never>();
    pagos = { obtenerHistorial: vi.fn(() => cajaPendiente.asObservable()) };

    configurar({ id: 'sede-1', nombre: 'Imperial Barbers' });
    fixture.detectChanges();
    await new Promise((resolver) => setTimeout(resolver, 0));
    fixture.detectChanges();

    const componente = fixture.componentInstance;

    // Lo crítico ya está, aunque la caja siga en vuelo.
    expect(componente.completadosHoy()).toBe(2);
    expect(texto()).toContain('Turnos Completados');
    expect(texto()).toContain('Luis Medina');

    // Y la caja tiene su propio esqueleto: no se pinta un $0 que mienta.
    const esqueleto = fixture.nativeElement.querySelector('[data-testid="esqueleto-caja"]');
    expect(esqueleto).not.toBeNull();
    expect(texto()).not.toContain('$0');
  });

  it('el ADMINISTRADOR global con sede no pide el historial de caja', async () => {
    configurar({ id: 'sede-1', nombre: 'Imperial Barbers' }, 'ADMINISTRADOR');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(pagos.obtenerHistorial).not.toHaveBeenCalled();
    expect(reservas.obtenerAgendaDiaria).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.ingresosHoy()).toBe(0);
  });
});
