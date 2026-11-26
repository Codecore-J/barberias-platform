import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminAntecedentesComponent } from './admin-antecedentes.component';
import { AntecedentesService, SolicitudAntecedente } from '../../../core/services/antecedentes.service';
import { TenantService } from '../../../core/services/tenant.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * F5 / T-55 · la sede pide. El formulario toma el cliente del selector y envía
 * motivo/evidencia; la lista muestra el estado y el motivo de denegación.
 */
describe('AdminAntecedentesComponent (T-55)', () => {
  let fixture: ComponentFixture<AdminAntecedentesComponent>;
  let antecedentes: {
    listarSolicitudes: ReturnType<typeof vi.fn>;
    listarClientesElegibles: ReturnType<typeof vi.fn>;
    crearSolicitud: ReturnType<typeof vi.fn>;
  };

  const denegada: SolicitudAntecedente = {
    id: 's2',
    barberiaId: 'sede-1',
    solicitanteId: 'u1',
    clienteId: 'c1',
    motivo: 'Incidente en recepción',
    evidenciaTexto: null,
    estado: 'DENEGADA',
    resueltoPor: 'admin-global',
    resueltoAt: '2026-11-25T13:00:00.000Z',
    motivoDenegacion: 'No es un hecho verificable',
    creadoAt: '2026-11-25T12:00:00.000Z',
    cliente: { id: 'c1', nombreCompleto: 'Ana Pérez', correo: 'ana@test.com' },
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    antecedentes = {
      listarSolicitudes: vi.fn(() => of([denegada])),
      listarClientesElegibles: vi.fn(() =>
        of([{ id: 'c1', nombreCompleto: 'Ana Pérez', correo: 'ana@test.com' }]),
      ),
      crearSolicitud: vi.fn(() => of({ ...denegada, id: 's3', estado: 'PENDIENTE' })),
    };

    TestBed.configureTestingModule({
      imports: [AdminAntecedentesComponent],
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
      ],
    });

    fixture = TestBed.createComponent(AdminAntecedentesComponent);
    fixture.detectChanges();
  });

  const texto = (): string => (fixture.nativeElement as HTMLElement).textContent || '';

  it('ofrece el botón de solicitar y el selector de clientes de la sede', () => {
    const boton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Solicitar antecedente'),
    );
    expect(boton).toBeTruthy();

    boton!.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('#solicitud-cliente')).toBeTruthy();
    expect(texto()).toContain('Ana Pérez');
  });

  it('envía cliente, motivo y evidencia al backend', () => {
    fixture.componentInstance.clienteId = 'c1';
    fixture.componentInstance.motivo = '  Llegó alterado  ';
    fixture.componentInstance.evidenciaTexto = '  Recepción  ';

    fixture.componentInstance.enviar();

    expect(antecedentes.crearSolicitud).toHaveBeenCalledWith('sede-1', {
      clienteId: 'c1',
      motivo: 'Llegó alterado',
      evidenciaTexto: 'Recepción',
    });
  });

  it('muestra el estado y el motivo de la denegación', () => {
    expect(texto()).toContain('DENEGADA');
    expect(texto()).toContain('No es un hecho verificable');
  });
});
