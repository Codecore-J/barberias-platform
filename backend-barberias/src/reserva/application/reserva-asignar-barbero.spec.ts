import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/** Hora UTC de una columna TIME, igual que la escribe `parseTime`. */
function hora(h: number, m = 0): Date {
  const d = new Date('1970-01-01T00:00:00Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/**
 * V3 · Reasignación de barbero (la limitación de la agenda de la Fase 2).
 *
 * Lo que se prueba es dónde queda la autoridad y qué no se puede romper:
 *  - la sede de la reserva decide (la ruta no lleva `:shopId`, así que el guard
 *    no puede comprobarlo);
 *  - el destino tiene que ser de la MISMA sede y estar activo;
 *  - el destino tiene que estar libre (otra cita o un bloqueo de la sede);
 *  - una reserva terminal no se reasigna;
 *  - se audita y se avisa al BARBERO, no al cliente.
 */
describe('ReservaService · asignarBarbero', () => {
  let service: ReservaService;

  const SEDE = '11111111-1111-4111-8111-111111111111';
  const OTRA_SEDE = '22222222-2222-4222-8222-222222222222';
  const RESERVA = '88888888-8888-4888-8888-888888888888';
  const BARBERO = '44444444-4444-4444-8444-444444444444';

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    reserva: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    usuarioRol: { findFirst: vi.fn() },
    bloqueosAgenda: { findFirst: vi.fn() },
  };

  const auditoria = { registrarEvento: vi.fn() };
  const notificaciones = { enviarNotificacion: vi.fn() };

  const reservaBase = {
    id: RESERVA,
    barberiaId: SEDE,
    barberoId: null as string | null,
    estado: 'PENDIENTE',
    fechaCita: new Date('2026-11-02T00:00:00Z'),
    horaInicio: hora(10),
    horaFin: hora(11),
    barberia: { nombre: 'Sede A' },
  };

  function usuarioAdminDeSede(barberiaId = SEDE): UsuarioAutenticado {
    return {
      id: 'admin-sede',
      correo: 'admin@prueba.local',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [
        { nombre: 'ADMIN_BARBERIA', barberiaId, ambito: 'BARBERIA' },
      ],
    } as UsuarioAutenticado;
  }

  function destinoValido(estadoCuenta = 'ACTIVO') {
    prisma.usuarioRol.findFirst.mockResolvedValue({
      rol: { nombre: 'BARBERO' },
      usuario: { nombreCompleto: 'Carlos', estadoCuenta },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservaService,
        { provide: PrismaService, useValue: prisma },
        { provide: DisponibilidadService, useValue: { calcularDisponibilidad: vi.fn() } },
        { provide: getQueueToken('reservas-pendientes'), useValue: { add: vi.fn(), getJob: vi.fn() } },
        { provide: getQueueToken('lista-espera'), useValue: { add: vi.fn() } },
        { provide: AuditoriaService, useValue: auditoria },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
        { provide: NotificacionService, useValue: notificaciones },
      ],
    }).compile();

    service = module.get<ReservaService>(ReservaService);
  });

  it('404 si la reserva no existe', async () => {
    prisma.reserva.findUnique.mockResolvedValue(null);

    await expect(
      service.asignarBarbero(RESERVA, { barberoId: BARBERO }, usuarioAdminDeSede()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 RESERVA_AJENA si quien pide es staff de otra sede', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reservaBase);

    const error = await service
      .asignarBarbero(RESERVA, { barberoId: BARBERO }, usuarioAdminDeSede(OTRA_SEDE))
      .catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'RESERVA_AJENA' } });
    // No se llegó ni a mirar el barbero destino.
    expect(prisma.usuarioRol.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('422 BARBERO_NO_PERTENECE_A_SEDE si el destino no tiene rol en la sede', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reservaBase);
    prisma.usuarioRol.findFirst.mockResolvedValue(null);

    const error = await service
      .asignarBarbero(RESERVA, { barberoId: BARBERO }, usuarioAdminDeSede())
      .catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'BARBERO_NO_PERTENECE_A_SEDE' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('422 BARBERO_INACTIVO si la cuenta del destino está suspendida', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reservaBase);
    destinoValido('SUSPENDIDO');

    const error = await service
      .asignarBarbero(RESERVA, { barberoId: BARBERO }, usuarioAdminDeSede())
      .catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'BARBERO_INACTIVO' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('409 ESTADO_INVALIDO si la reserva ya es terminal', async () => {
    prisma.reserva.findUnique.mockResolvedValue({ ...reservaBase, estado: 'CANCELADA' });
    destinoValido();
    prisma.reserva.findFirst.mockResolvedValue({ ...reservaBase, estado: 'CANCELADA' });

    const error = await service
      .asignarBarbero(RESERVA, { barberoId: BARBERO }, usuarioAdminDeSede())
      .catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'ESTADO_INVALIDO' } });
    expect(prisma.reserva.update).not.toHaveBeenCalled();
  });

  it('409 BARBERO_OCUPADO si el destino ya tiene una cita que se solapa', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reservaBase);
    destinoValido();
    prisma.reserva.findFirst
      .mockResolvedValueOnce(reservaBase) // la propia reserva, dentro del lock
      .mockResolvedValueOnce({ id: 'otra-cita', horaInicio: hora(10, 30), horaFin: hora(11, 30) });

    const error = await service
      .asignarBarbero(RESERVA, { barberoId: BARBERO }, usuarioAdminDeSede())
      .catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'BARBERO_OCUPADO' } });
    expect(prisma.reserva.update).not.toHaveBeenCalled();
  });

  it('409 BARBERO_BLOQUEADO si la sede bloqueó esa franja', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reservaBase);
    destinoValido();
    prisma.reserva.findFirst.mockResolvedValueOnce(reservaBase).mockResolvedValueOnce(null);
    prisma.bloqueosAgenda.findFirst.mockResolvedValue({
      id: 'bloqueo-1',
      horaInicio: hora(9),
      horaFin: hora(12),
    });

    const error = await service
      .asignarBarbero(RESERVA, { barberoId: BARBERO }, usuarioAdminDeSede())
      .catch((e) => e);

    expect(error).toMatchObject({ response: { codigo: 'BARBERO_BLOQUEADO' } });
    expect(prisma.reserva.update).not.toHaveBeenCalled();
  });

  it('asigna el barbero, audita el cambio y avisa al barbero (no al cliente)', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reservaBase);
    destinoValido();
    prisma.reserva.findFirst.mockResolvedValueOnce(reservaBase).mockResolvedValueOnce(null);
    prisma.bloqueosAgenda.findFirst.mockResolvedValue(null);
    prisma.reserva.update.mockResolvedValue({
      id: RESERVA,
      barberoId: BARBERO,
      estado: 'PENDIENTE',
      barbero: { id: BARBERO, nombreCompleto: 'Carlos' },
    });
    auditoria.registrarEvento.mockResolvedValue(undefined);
    notificaciones.enviarNotificacion.mockResolvedValue(undefined);

    const resultado = await service.asignarBarbero(
      RESERVA,
      { barberoId: BARBERO },
      usuarioAdminDeSede(),
    );

    expect(prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RESERVA }, data: { barberoId: BARBERO } }),
    );
    expect(resultado).toMatchObject({
      id: RESERVA,
      barberoId: BARBERO,
      reasignada: true,
      barbero: { id: BARBERO, nombre: 'Carlos' },
    });

    expect(auditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'RESERVA_BARBERO_ASIGNADO',
        entidadId: RESERVA,
        contexto: expect.objectContaining({
          barberiaId: SEDE,
          barberoAnterior: null,
          barberoNuevo: BARBERO,
        }),
      }),
      prisma,
    );

    expect(notificaciones.enviarNotificacion).toHaveBeenCalledTimes(1);
    expect(notificaciones.enviarNotificacion).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: BARBERO, tipo: 'RESERVA_ASIGNADA' }),
    );
  });

  it('es idempotente: no reescribe ni renotifica si el barbero ya es el asignado', async () => {
    prisma.reserva.findUnique.mockResolvedValue({ ...reservaBase, barberoId: BARBERO });
    destinoValido();

    const resultado = await service.asignarBarbero(
      RESERVA,
      { barberoId: BARBERO },
      usuarioAdminDeSede(),
    );

    expect(resultado).toMatchObject({ reasignada: false, barberoId: BARBERO });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notificaciones.enviarNotificacion).not.toHaveBeenCalled();
  });
});
