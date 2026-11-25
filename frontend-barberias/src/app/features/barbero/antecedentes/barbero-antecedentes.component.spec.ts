import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { BarberoAntecedentesComponent } from './barbero-antecedentes.component';
import { AntecedentesService, SolicitudAntecedente } from '../../../core/services/antecedentes.service';
import { TenantService } from '../../../core/services/tenant.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * F5 / T-55 · el barbero reporta. Si llega desde la ficha del cliente, el
 * selector viene prellenado; la lista solo trae sus solicitudes.
 */
describe('BarberoAntecedentesComponent (T-55)', () => {
  let fixture: ComponentFixture<BarberoAntecedentesComponent>;
  let antecedentes: {
    listarSolicitudes: ReturnType<typeof vi.fn>;
    listarClientesElegibles: ReturnType<typeof vi.fn>;
    crearSolicitud: ReturnType<typeof vi.fn>;
  };

  const solicitud: SolicitudAntecedente = {
    id: 's4',
    barberiaId: 'sede-1',
    solicitanteId: 'barbero-1',
    clienteId: 'c1',
    motivo: 'Cliente insistió en un servicio no contratado',
    evidenciaTexto: null,
    estado: 'PENDIENTE',
    resueltoPor: null,
    resueltoAt: null,
    motivoDenegacion: null,
    creadoAt: '2026-11-25T12:00:00.000Z',
    cliente: { id: 'c1', nombreCompleto: 'Ana Pérez', correo: 'ana@test.com' },
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    antecedentes = {
      listarSolicitudes: vi.fn(() => of([solicitud])),
      listarClientesElegibles: vi.fn(() =>
        of([{ id: 'c1', nombreCompleto: 'Ana Pérez', correo: 'ana@test.com' }]),
      ),
      crearSolicitud: vi.fn(() => of({ ...solicitud, id: 's5' })),
    };

    TestBed.configureTestingModule({
      imports: [BarberoAntecedentesComponent],
      providers: [
        { provide: AntecedentesService, useValue: antecedentes },
        {
          provide: TenantService,
          useValue: {
            barberiaActivaId: () => 'sede-1',
            nombreBarberiaActiva: () => 'Sede QA',
          },
        },
        { provide: ToastService, useValue: { success: vi.fn(), warning: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (clave: string) => (clave === 'clienteId' ? 'c1' : null),
              },
            },
          },
        },
      ],
    });

    fixture = TestBed.createComponent(BarberoAntecedentesComponent);
    fixture.detectChanges();
  });

  const texto = (): string => (fixture.nativeElement as HTMLElement).textContent || '';

  it('prellena el cliente cuando llega desde su ficha', () => {
    expect(fixture.componentInstance.clienteId).toBe('c1');
    expect(antecedentes.listarClientesElegibles).toHaveBeenCalledWith('sede-1');
  });

  it('solo lista las solicitudes propias y su estado', () => {
    expect(antecedentes.listarSolicitudes).toHaveBeenCalledWith('sede-1');
    expect(texto()).toContain('Mis solicitudes');
    expect(texto()).toContain('Cliente insistió en un servicio no contratado');
  });

  it('envía el reporte con el cliente prellenado', () => {
    fixture.componentInstance.motivo = '  Se negó a pagar  ';

    fixture.componentInstance.enviar();

    expect(antecedentes.crearSolicitud).toHaveBeenCalledWith('sede-1', {
      clienteId: 'c1',
      motivo: 'Se negó a pagar',
      evidenciaTexto: undefined,
    });
  });
});
