import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminSolicitudesAntecedentesComponent } from './solicitudes-antecedentes.component';
import { AntecedentesService, SolicitudAntecedente } from '../../../core/services/antecedentes.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * F5 / T-55 · bandeja global: pinta la solicitud con sede/solicitante/motivo y
 * delega aprobar/denegar. Denegar viaja con el motivo obligatorio del modal.
 */
describe('AdminSolicitudesAntecedentesComponent (T-55)', () => {
  let fixture: ComponentFixture<AdminSolicitudesAntecedentesComponent>;
  let antecedentes: {
    listarSolicitudesPendientesGlobal: ReturnType<typeof vi.fn>;
    resolverSolicitud: ReturnType<typeof vi.fn>;
  };
  let confirmDialog: {
    confirm: ReturnType<typeof vi.fn>;
    solicitarTexto: ReturnType<typeof vi.fn>;
  };

  const solicitud: SolicitudAntecedente = {
    id: 's1',
    barberiaId: 'b1',
    solicitanteId: 'u1',
    clienteId: 'c1',
    motivo: 'Gritó en la sala',
    evidenciaTexto: 'Testigo: recepción',
    estado: 'PENDIENTE',
    resueltoPor: null,
    resueltoAt: null,
    motivoDenegacion: null,
    creadoAt: '2026-11-25T12:00:00.000Z',
    solicitante: { id: 'u1', nombreCompleto: 'Barbero Demo' },
    cliente: { id: 'c1', nombreCompleto: 'Ana Pérez', correo: 'ana@test.com' },
    barberia: { id: 'b1', nombre: 'Sede QA' },
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    antecedentes = {
      listarSolicitudesPendientesGlobal: vi.fn(() => of([solicitud])),
      resolverSolicitud: vi.fn(() => of({ ...solicitud, estado: 'APROBADA' })),
    };
    confirmDialog = {
      confirm: vi.fn(async () => true),
      solicitarTexto: vi.fn(async () => 'No es un hecho verificable'),
    };

    TestBed.configureTestingModule({
      imports: [AdminSolicitudesAntecedentesComponent],
      providers: [
        { provide: AntecedentesService, useValue: antecedentes },
        { provide: ConfirmDialogService, useValue: confirmDialog },
        { provide: ToastService, useValue: { success: vi.fn(), warning: vi.fn() } },
      ],
    });

    fixture = TestBed.createComponent(AdminSolicitudesAntecedentesComponent);
    fixture.detectChanges();
  });

  const texto = (): string => (fixture.nativeElement as HTMLElement).textContent || '';

  it('muestra sede, solicitante, cliente y motivo de la solicitud pendiente', () => {
    expect(texto()).toContain('Sede QA');
    expect(texto()).toContain('Barbero Demo');
    expect(texto()).toContain('Ana Pérez');
    expect(texto()).toContain('Gritó en la sala');
    expect(texto()).toContain('Testigo: recepción');
  });

  it('denegar exige el motivo del modal y lo envía con la decisión', async () => {
    await fixture.componentInstance.denegar(solicitud);

    expect(confirmDialog.solicitarTexto).toHaveBeenCalledTimes(1);
    expect(antecedentes.resolverSolicitud).toHaveBeenCalledWith(
      's1',
      'DENEGAR',
      'No es un hecho verificable',
    );
  });

  it('aprobar confirma y resuelve sin motivo', async () => {
    await fixture.componentInstance.aprobar(solicitud);

    expect(antecedentes.resolverSolicitud).toHaveBeenCalledWith('s1', 'APROBAR');
  });
});
