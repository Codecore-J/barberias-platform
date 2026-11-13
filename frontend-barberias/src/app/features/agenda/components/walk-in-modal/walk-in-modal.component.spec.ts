import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { WalkInModalComponent } from './walk-in-modal.component';
import { ReservasService } from '../../../../core/services/reservas.service';
import type { Servicio } from '../../../../core/services/servicios.service';
import type { Personal } from '../../../../core/services/personal.service';

/**
 * E3-03 · el botón Walk-In de la consola ponía `mostrarModalWalkIn` en `true`
 * sin que ningún template lo consumiera: ROJO reproducido en producción, donde
 * pulsarlo no abría modal, no lanzaba petición y no mostraba error.
 *
 * Estas pruebas fijan el contrato del modal que lo sustituye: el precio y la
 * duración salen del catálogo (nunca se teclean), el fin se deriva del inicio y
 * el cuerpo enviado es el que exige `CreateReservaDto`.
 */
describe('WalkInModalComponent', () => {
  const SERVICIO: Servicio = {
    id: 's-1',
    nombre: 'Corte clásico',
    descripcion: '',
    precio: 25,
    duracionMinutos: 45,
    esCombo: false,
    barberiaId: 'sede-1',
    fechaCreacion: '',
  };

  const BARBERO: Personal = {
    id: 'b-1',
    nombreCompleto: 'Barbero Demo',
    estadoSede: 'ACTIVO',
    correo: 'barbero@demo.com',
    telefono: '3000000002',
    estado: 'ACTIVO',
    roles: ['BARBERO'],
    barberiaId: 'sede-1',
  } as unknown as Personal;

  let crearReservaWalkIn: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<WalkInModalComponent>;
  let componente: WalkInModalComponent;

  beforeEach(() => {
    crearReservaWalkIn = vi.fn(() => of({ id: 'turno-1' }));

    TestBed.configureTestingModule({
      imports: [WalkInModalComponent],
      providers: [
        {
          provide: ReservasService,
          useValue: {
            crearReservaWalkIn,
            isLoading: signal(false),
            error: signal(null),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(WalkInModalComponent);
    componente = fixture.componentInstance;
    fixture.componentRef.setInput('fecha', '2026-11-13');
    fixture.componentRef.setInput('staff', [BARBERO]);
    fixture.componentRef.setInput('servicios', [SERVICIO]);
    fixture.detectChanges();
  });

  it('sin servicio elegido no hay precio ni hora de fin', () => {
    expect(componente.precio()).toBe(0);
    expect(componente.horaFin()).toBeNull();
    expect(componente.puedeEnviar()).toBe(false);
  });

  it('deriva precio y hora de fin del servicio del catálogo', () => {
    componente.servicioId.set(SERVICIO.id);
    componente.horaInicio.set('10:30');

    expect(componente.precio()).toBe(25);
    // 10:30 + 45 min
    expect(componente.horaFin()).toBe('11:15');
  });

  it('bloquea el envío cuando el turno cruzaría la medianoche', () => {
    componente.nombre.set('Cliente Sin App');
    componente.barberoId.set(BARBERO.id);
    componente.servicioId.set(SERVICIO.id);
    componente.horaInicio.set('23:30');

    expect(componente.horaFin()).toBe('00:15');
    expect(componente.cruzaMedianoche()).toBe(true);
    expect(componente.puedeEnviar()).toBe(false);
  });

  it('exige nombre, barbero y servicio para habilitar el alta', () => {
    componente.servicioId.set(SERVICIO.id);
    expect(componente.puedeEnviar()).toBe(false);

    componente.barberoId.set(BARBERO.id);
    expect(componente.puedeEnviar()).toBe(false);

    componente.nombre.set('  ');
    expect(componente.puedeEnviar()).toBe(false);

    componente.nombre.set('Cliente Sin App');
    expect(componente.puedeEnviar()).toBe(true);
  });

  it('envía el cuerpo que exige CreateReservaDto y avisa del alta', () => {
    const creado = vi.fn();
    componente.creado.subscribe(creado);

    componente.nombre.set('  Cliente Sin App  ');
    componente.barberoId.set(BARBERO.id);
    componente.servicioId.set(SERVICIO.id);
    componente.horaInicio.set('10:30');

    componente.crear();

    expect(crearReservaWalkIn).toHaveBeenCalledWith({
      fecha: '2026-11-13',
      horaInicio: '10:30',
      horaFin: '11:15',
      serviciosIds: [SERVICIO.id],
      precioTotalEsperado: 25,
      barberoId: BARBERO.id,
      nombreInvitado: 'Cliente Sin App',
      tipo: 'INDIVIDUAL',
    });
    expect(creado).toHaveBeenCalledTimes(1);
  });

  it('muestra el error del backend y no emite «creado»', () => {
    const creado = vi.fn();
    componente.creado.subscribe(creado);
    crearReservaWalkIn = vi.fn(() =>
      throwError(() => ({ status: 409, error: { message: 'El barbero ya tiene una cita en ese hueco' } })),
    );
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [WalkInModalComponent],
      providers: [
        {
          provide: ReservasService,
          useValue: { crearReservaWalkIn, isLoading: signal(false), error: signal(null) },
        },
      ],
    });
    fixture = TestBed.createComponent(WalkInModalComponent);
    componente = fixture.componentInstance;
    fixture.componentRef.setInput('fecha', '2026-11-13');
    fixture.componentRef.setInput('staff', [BARBERO]);
    fixture.componentRef.setInput('servicios', [SERVICIO]);
    fixture.detectChanges();

    componente.creado.subscribe(creado);
    componente.nombre.set('Cliente Sin App');
    componente.barberoId.set(BARBERO.id);
    componente.servicioId.set(SERVICIO.id);
    componente.horaInicio.set('10:30');

    componente.crear();

    expect(componente.error()).toBe('El barbero ya tiene una cita en ese hueco');
    expect(componente.enviando()).toBe(false);
    expect(creado).not.toHaveBeenCalled();
  });
});
