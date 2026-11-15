import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { DashboardSedeComponent } from './dashboard-sede.component';
import { TenantService } from '../../../core/services/tenant.service';
import { ReservasService } from '../../../core/services/reservas.service';
import { PagosService } from '../../../core/services/pagos.service';

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

  function configurar(sede: { id: string; nombre: string } | null): void {
    const activa = signal(sede);
    const tenant = {
      barberiaActiva: activa,
      barberiaActivaId: computed(() => activa()?.id ?? null),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardSedeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: TenantService, useValue: tenant },
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
});
