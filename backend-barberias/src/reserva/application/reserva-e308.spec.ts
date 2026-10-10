import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';

/** Hora UTC, igual que la escribe `parseTime` (setUTCHours). */
function hora(h: number, m: number): Date {
  const d = new Date('1970-01-01T00:00:00Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/**
 * E3-08 · Cancelación especial (D17) y propuesta de horario (D18, §5.4).
 *
 * Suite aislada, con su propio arnés de mocks, para no tocar el spec grande de
 * `ReservaService`.
 */
describe('ReservaService · E3-08 cancelación especial y propuesta de horario', () => {
  let service: ReservaService;

  const mockPrismaService = {
    $queryRaw: vi.fn(),
    configuracionBarberia: { findUnique: vi.fn() },
    reserva: { findFirst: vi.fn(), update: vi.fn() },
    participanteServicio: { findMany: vi.fn() },
    propuestaHorario: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrismaService)),
  };

  const mockDisponibilidadService = { calcularDisponibilidad: vi.fn() };
  const mockQueue = { add: vi.fn(), getJob: vi.fn() };
  const mockAuditoriaService = { registrarEvento: vi.fn() };

  const CONFIG = {
    margenGrupalMinutos: 10,
    nuevasReservasActivas: true,
    horizonteReservaDias: 30,
    permiteCancelacionEspecial: true,
  };

  const reserva = (extra: Record<string, unknown> = {}) => ({
    id: 'uuid-reserva',
    barberiaId: 'uuid-barberia',
    clienteId: 'uuid-cliente',
    estado: 'CONFIRMADA',
    fechaCita: new Date('2026-10-12'),
    horaInicio: hora(9, 0),
    horaFin: hora(9, 30),
    margenGrupalHistorico: 10,
    totalPagar: 30,
    expiraAt: null,
    ...extra,
  });

  const propuesta = (extra: Record<string, unknown> = {}) => ({
    id: 'uuid-propuesta',
    reservaId: 'uuid-reserva',
    estado: 'PENDIENTE',
    fechaCita: new Date('2026-10-12'),
    horaInicio: hora(10, 0),
    horaFin: hora(10, 30),
    expiraAt: new Date(2026, 9, 10, 9, 10, 0),
    ...extra,
  });

  const usuarioCliente = {
    id: 'uuid-cliente',
    correo: 'cliente@test.com',
    roles: ['CLIENTE'],
    rolesDetallados: [],
  };

  const usuarioAdmin = {
    id: 'uuid-admin',
    correo: 'admin@test.com',
    roles: ['ADMIN_BARBERIA'],
    rolesDetallados: [
      { nombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia', ambito: 'BARBERIA' },
    ],
  };

  const slot = (h: number, m: number) => {
    const d = new Date('2026-10-12');
    d.setHours(h, m, 0, 0);
    return d;
  };

  const dto = { fecha: '2026-10-12', horaInicio: '10:00', horaFin: '10:30' };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DisponibilidadService, useValue: mockDisponibilidadService },
        { provide: getQueueToken('reservas-pendientes'), useValue: mockQueue },
        { provide: AuditoriaService, useValue: mockAuditoriaService },
      ],
    }).compile();

    service = module.get<ReservaService>(ReservaService);

    mockQueue.getJob.mockResolvedValue(null);
    mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
    mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue(CONFIG);
    mockPrismaService.participanteServicio.findMany.mockResolvedValue([{ duracionHistorica: 30 }]);
    mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
      { inicio: slot(0, 0), fin: slot(23, 59) },
    ]);
    mockPrismaService.reserva.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'uuid-reserva',
        estado: 'CONFIRMADA',
        ...data,
      }),
    );
    mockPrismaService.propuestaHorario.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'uuid-propuesta',
        estado: 'PENDIENTE',
        tipo: 'REPROGRAMACION',
        ...data,
      }),
    );
    mockPrismaService.propuestaHorario.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'uuid-propuesta',
        ...data,
      }),
    );
  });

  // ── Cancelación especial (D17) ───────────────────────────────────────────

  describe('E3-08 cancelación especial', () => {
    it('VERDE: registra quién y el motivo, deja la reserva CANCELADA/APROBADA y audita', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());

      const res = await service.cancelacionEspecial(
        'uuid-barberia',
        'uuid-reserva',
        { motivoCodigo: 'EMERGENCIA' } as any,
        usuarioAdmin as any,
      );

      expect(res.estado).toBe('CANCELADA');
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: {
          estado: 'CANCELADA',
          canceladoPorId: 'uuid-admin',
          cancelacionEspecialEstado: 'APROBADA',
          cancelacionEspecialMotivo: 'EMERGENCIA',
          cancelacionEspecialDetalle: null,
        },
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'RESERVA_CANCELACION_ESPECIAL',
          entidadId: 'uuid-reserva',
          usuarioId: 'uuid-admin',
          contexto: expect.objectContaining({
            estadoAnterior: 'CONFIRMADA',
            estadoNuevo: 'CANCELADA',
            canceladoPor: 'STAFF',
            motivoCodigo: 'EMERGENCIA',
          }),
        }),
        expect.anything(),
      );
    });

    it('ROJO: sin la bandera D17 → 422 CANCELACION_ESPECIAL_NO_HABILITADA y no se toca nada', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        ...CONFIG,
        permiteCancelacionEspecial: false,
      });

      await expect(
        service.cancelacionEspecial(
          'uuid-barberia',
          'uuid-reserva',
          { motivoCodigo: 'EMERGENCIA' } as any,
          usuarioAdmin as any,
        ),
      ).rejects.toMatchObject({
        response: { codigo: 'CANCELACION_ESPECIAL_NO_HABILITADA', statusCode: 422 },
      });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
      expect(mockAuditoriaService.registrarEvento).not.toHaveBeenCalled();
    });

    it('ROJO: OTRO sin detalle suficiente → 400 MOTIVO_INVALIDO', async () => {
      await expect(
        service.cancelacionEspecial(
          'uuid-barberia',
          'uuid-reserva',
          { motivoCodigo: 'OTRO', motivoDetalle: 'no' } as any,
          usuarioAdmin as any,
        ),
      ).rejects.toMatchObject({ response: { codigo: 'MOTIVO_INVALIDO', statusCode: 400 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('ROJO: un motivo fuera del catálogo de cancelación → 400 MOTIVO_INVALIDO', async () => {
      await expect(
        service.cancelacionEspecial(
          'uuid-barberia',
          'uuid-reserva',
          { motivoCodigo: 'HORARIO_NO_DISPONIBLE' } as any,
          usuarioAdmin as any,
        ),
      ).rejects.toThrowError(BadRequestException);
    });

    it('ROJO: una reserva terminal → 409 ESTADO_INVALIDO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reserva({ estado: 'CANCELADA' }),
      );

      await expect(
        service.cancelacionEspecial(
          'uuid-barberia',
          'uuid-reserva',
          { motivoCodigo: 'FUERZA_MAYOR' } as any,
          usuarioAdmin as any,
        ),
      ).rejects.toMatchObject({ response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 } });
    });

    it('ROJO: una reserva inexistente en esa sede → 404', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelacionEspecial(
          'uuid-barberia',
          'uuid-reserva',
          { motivoCodigo: 'EMERGENCIA' } as any,
          usuarioAdmin as any,
        ),
      ).rejects.toThrowError(NotFoundException);
    });
  });

  // ── Propuesta de horario (D18 / §5.4) ────────────────────────────────────

  describe('E3-08 propuesta de horario', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 10, 9, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('VERDE: el cliente dueño propone: PENDIENTE con 10 minutos y sin mover la cita', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(null);

      const res = await service.proponerHorario(
        'uuid-barberia',
        'uuid-reserva',
        dto as any,
        usuarioCliente as any,
      );

      expect(res.estado).toBe('PENDIENTE');
      expect(mockPrismaService.propuestaHorario.create).toHaveBeenCalledWith({
        data: {
          reservaId: 'uuid-reserva',
          fechaCita: new Date('2026-10-12'),
          horaInicio: hora(10, 0),
          horaFin: hora(10, 30),
          tipo: 'REPROGRAMACION',
          estado: 'PENDIENTE',
          expiraAt: new Date(2026, 9, 10, 9, 10, 0),
          creadoPor: 'uuid-cliente',
        },
      });

      // Proponer NO reprograma: la reserva no se toca.
      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();

      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'RESERVA_PROPUESTA_HORARIO',
          usuarioId: 'uuid-cliente',
          contexto: expect.objectContaining({
            fechaAnterior: '2026-10-12',
            horaAnterior: '09:00-09:30',
            horaPropuesta: '10:00-10:30',
          }),
        }),
        expect.anything(),
      );
    });

    it('ROJO: un cliente ajeno no puede proponer → 403 RESERVA_AJENA', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());

      await expect(
        service.proponerHorario('uuid-barberia', 'uuid-reserva', dto as any, {
          ...usuarioCliente,
          id: 'uuid-otro',
        } as any),
      ).rejects.toMatchObject({ response: { codigo: 'RESERVA_AJENA', statusCode: 403 } });

      expect(mockPrismaService.propuestaHorario.create).not.toHaveBeenCalled();
    });

    it('ROJO: ya hay una propuesta viva → 409 PROPUESTA_PENDIENTE', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(propuesta());

      await expect(
        service.proponerHorario('uuid-barberia', 'uuid-reserva', dto as any, usuarioCliente as any),
      ).rejects.toMatchObject({ response: { codigo: 'PROPUESTA_PENDIENTE', statusCode: 409 } });
    });

    it('ROJO: proponer sobre una reserva terminal → 409 ESTADO_INVALIDO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reserva({ estado: 'CANCELADA' }),
      );

      await expect(
        service.proponerHorario('uuid-barberia', 'uuid-reserva', dto as any, usuarioCliente as any),
      ).rejects.toMatchObject({ response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 } });
    });

    it('VERDE: aceptar mueve la cita, cierra la propuesta y audita el origen', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(propuesta());

      const res = await service.aceptarPropuestaHorario(
        'uuid-barberia',
        'uuid-reserva',
        usuarioAdmin as any,
      );

      expect(res.horaInicio).toEqual(hora(10, 0));
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: {
          fechaCita: new Date('2026-10-12'),
          horaInicio: hora(10, 0),
          horaFin: hora(10, 30),
        },
      });
      expect(mockPrismaService.propuestaHorario.update).toHaveBeenCalledWith({
        where: { id: 'uuid-propuesta' },
        data: { estado: 'ACEPTADA' },
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'RESERVA_REPROGRAMADA',
          contexto: expect.objectContaining({ origen: 'PROPUESTA_HORARIO' }),
        }),
        expect.anything(),
      );
    });

    it('ROJO: aceptar sin propuesta viva → 409 SIN_PROPUESTA', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(null);

      await expect(
        service.aceptarPropuestaHorario('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'SIN_PROPUESTA', statusCode: 409 } });
    });

    it('ROJO: una propuesta vencida → 409 PROPUESTA_EXPIRADA, se marca EXPIRADA y no se mueve', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(
        propuesta({ expiraAt: new Date(2026, 9, 10, 8, 59, 0) }),
      );

      await expect(
        service.aceptarPropuestaHorario('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'PROPUESTA_EXPIRADA', statusCode: 409 } });

      expect(mockPrismaService.propuestaHorario.update).toHaveBeenCalledWith({
        where: { id: 'uuid-propuesta' },
        data: { estado: 'EXPIRADA' },
      });
      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('ROJO: el hueco se ocupó antes de aceptar → 409 CONFLICTO_HORARIO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(propuesta());
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { inicio: slot(0, 0), fin: slot(8, 0) },
      ]);

      await expect(
        service.aceptarPropuestaHorario('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'CONFLICTO_HORARIO', statusCode: 409 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
      expect(mockPrismaService.propuestaHorario.update).not.toHaveBeenCalled();
    });

    it('VERDE: rechazar cierra la propuesta sin mover la cita', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(propuesta());

      const res = await service.rechazarPropuestaHorario(
        'uuid-barberia',
        'uuid-reserva',
        usuarioAdmin as any,
      );

      expect(res.estado).toBe('RECHAZADA');
      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'RESERVA_PROPUESTA_RECHAZADA' }),
        expect.anything(),
      );
    });

    it('ROJO: rechazar sin propuesta viva → 409 SIN_PROPUESTA', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.propuestaHorario.findFirst.mockResolvedValue(null);

      await expect(
        service.rechazarPropuestaHorario('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'SIN_PROPUESTA', statusCode: 409 } });

      expect(mockPrismaService.propuestaHorario.update).not.toHaveBeenCalled();
    });
  });
});
