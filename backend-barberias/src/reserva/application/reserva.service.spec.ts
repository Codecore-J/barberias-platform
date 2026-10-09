import { Test, TestingModule } from '@nestjs/testing';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { ConflictException, ForbiddenException, BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';

/** Hora UTC, igual que la escribe `parseTime` (setUTCHours). */
function hora(h: number, m: number): Date {
  const d = new Date('1970-01-01T00:00:00Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

describe('ReservaService', () => {
  let service: ReservaService;

  const mockPrismaService = {
    $queryRaw: vi.fn(),
    configuracionBarberia: { findUnique: vi.fn() },
    clienteBarberia: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    reserva: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    participanteReserva: { create: vi.fn() },
    participanteServicio: { createMany: vi.fn() },
    servicio: { findMany: vi.fn() },
    barberia: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (cb, options) => {
      return cb(mockPrismaService);
    }),
  };

  const mockDisponibilidadService = {
    calcularDisponibilidad: vi.fn(),
  };

  const mockQueue = {
    add: vi.fn(),
    getJob: vi.fn(),
  };

  const mockAuditoriaService = {
    registrarEvento: vi.fn(),
  };

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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('crearReserva y Snapshot Inmutable (T6.2)', () => {
    it('debe congelar precioHistorico, duracionHistorica y margenHistorico en el snapshot de ParticipanteServicio', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
        margenGrupalMinutos: 10,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', precio: 15, duracionEstimada: 30, margenOperativo: 5 },
      ]);

      const fecha = new Date('2026-10-10');
      const inicioSlot = new Date(fecha);
      inicioSlot.setHours(9, 0, 0, 0);
      const finSlot = new Date(fecha);
      finSlot.setHours(10, 0, 0, 0);

      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { inicio: inicioSlot, fin: finSlot },
      ]);

      mockPrismaService.reserva.create.mockResolvedValue({ id: 'uuid-reserva' });
      mockPrismaService.participanteReserva.create.mockResolvedValue({ id: 'uuid-part' });

      await service.crearReserva('uuid-cliente', 'uuid-barberia', {
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '09:30',
        serviciosIds: ['s1'],
        precioTotalEsperado: 15,
      });

      expect(mockPrismaService.reserva.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalPagar: 15,
            margenGrupalHistorico: 10,
          }),
        }),
      );

      expect(mockPrismaService.participanteServicio.createMany).toHaveBeenCalledWith({
        data: [
          {
            participanteId: 'uuid-part',
            servicioId: 's1',
            precioHistorico: 15,
            duracionHistorica: 30,
            margenHistorico: 5,
          },
        ],
      });
    });

    it('D42: debe snapshottear configuracion_barberia.margen_grupal_minutos, nunca la suma de margenes ni el valor del DTO', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
        margenGrupalMinutos: 12,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', precio: 15, duracionEstimada: 20, margenOperativo: 5 },
        { id: 's2', precio: 10, duracionEstimada: 10, margenOperativo: 5 },
      ]);

      const fecha = new Date('2026-10-10');
      const inicioSlot = new Date(fecha);
      inicioSlot.setHours(9, 0, 0, 0);
      const finSlot = new Date(fecha);
      finSlot.setHours(10, 0, 0, 0);

      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { inicio: inicioSlot, fin: finSlot },
      ]);
      mockPrismaService.reserva.create.mockResolvedValue({ id: 'uuid-reserva' });
      mockPrismaService.participanteReserva.create.mockResolvedValue({ id: 'uuid-part' });

      await service.crearReserva('uuid-cliente', 'uuid-barberia', {
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '09:40',
        serviciosIds: ['s1', 's2'],
        precioTotalEsperado: 25,
      });

      expect(mockPrismaService.reserva.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            margenGrupalHistorico: 12,
          }),
        }),
      );

      expect(mockDisponibilidadService.calcularDisponibilidad).toHaveBeenCalledWith(
        expect.objectContaining({ margenRequerido: 12 }),
        expect.anything(),
      );
    });

    it('debe rechazar con BadRequestException si los servicios solicitados no existen en la barbería', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([]);

      await expect(
        service.crearReserva('uuid-cliente', 'uuid-barberia', {
          fecha: '2026-10-10',
          horaInicio: '09:00',
          horaFin: '09:30',
          serviciosIds: ['s-inexistente'],
          precioTotalEsperado: 15,
        }),
      ).rejects.toThrowError(BadRequestException);
    });

    it('debe rechazar con BadRequestException si el rango de horario solicitado es insuficiente para los servicios', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', precio: 50, duracionEstimada: 60, margenOperativo: 0 },
      ]);

      await expect(
        service.crearReserva('uuid-cliente', 'uuid-barberia', {
          fecha: '2026-10-10',
          horaInicio: '09:00',
          horaFin: '09:30',
          serviciosIds: ['s1'],
          precioTotalEsperado: 50,
        }),
      ).rejects.toThrowError(BadRequestException);
    });

    it('debe rechazar con ForbiddenException si el cliente está restringido por inasistencias', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({
        estaRestringido: true,
        motivoRestriccion: 'Bloqueo automático: Superó el límite de inasistencias',
      });

      await expect(
        service.crearReserva('uuid-cliente', 'uuid-barberia', {
          fecha: '2026-10-10',
          horaInicio: '09:00',
          horaFin: '09:30',
          serviciosIds: ['s1'],
          precioTotalEsperado: 15,
        }),
      ).rejects.toThrowError(ForbiddenException);
    });

    it('debe rechazar con UnprocessableEntityException (422 D40) si la barbería pausó nuevas reservas', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: false,
        aceptaIndividual: true,
      });

      await expect(
        service.crearReserva('uuid-cliente', 'uuid-barberia', {
          fecha: '2026-10-10',
          horaInicio: '09:00',
          horaFin: '09:30',
          serviciosIds: ['s1'],
          precioTotalEsperado: 15,
        }),
      ).rejects.toThrowError(UnprocessableEntityException);
    });

    it('debe fallar con ConflictException si no hay disponibilidad en la fecha solicitada', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', precio: 15, duracionEstimada: 30, margenOperativo: 5 },
      ]);

      const fecha = new Date('2026-10-10');
      const inicioSlot = new Date(fecha);
      inicioSlot.setHours(11, 0, 0, 0);
      const finSlot = new Date(fecha);
      finSlot.setHours(12, 0, 0, 0);

      // El bloque solicitado (09:00-09:30) no está dentro del slot de
      // disponibilidad (11:00-12:00): la regla de negocio no puede reservar ese
      // hueco y lanza ConflictException (409). Es la prueba del bloqueo de
      // concurrencia: FOR UPDATE + SERIALIZABLE + disponibilidad.
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { inicio: inicioSlot, fin: finSlot },
      ]);

      await expect(
        service.crearReserva('uuid-cliente', 'uuid-barberia', {
          fecha: '2026-10-10',
          horaInicio: '09:00',
          horaFin: '09:30',
          serviciosIds: ['s1'],
          precioTotalEsperado: 15,
        }),
      ).rejects.toThrowError(ConflictException);
    });
  });

  describe('E3-04 aceptar y rechazar solicitudes', () => {
    const usuarioAdmin = { id: 'uuid-admin', correo: 'admin@test.com', roles: ['ADMIN_BARBERIA'] };

    /** Reserva PENDIENTE coherente: fecha UTC y horas UTC como `parseTime`. */
    const reservaPendiente = (extra: Record<string, unknown> = {}) => ({
      id: 'uuid-reserva',
      barberiaId: 'uuid-barberia',
      clienteId: 'uuid-cliente',
      estado: 'PENDIENTE',
      fechaCita: new Date('2026-10-10'),
      horaInicio: hora(10, 0),
      horaFin: hora(10, 30),
      margenGrupalHistorico: 10,
      totalPagar: 30,
      expiraAt: new Date(Date.now() + 5 * 60000),
      ...extra,
    });

    /** Único slot que cubre el bloque 10:00-10:40 del día completo. */
    const slotDelDia = () => {
      const inicio = new Date('2026-10-10');
      inicio.setHours(0, 0, 0, 0);
      const fin = new Date('2026-10-10');
      fin.setHours(23, 59, 0, 0);
      return { inicio, fin };
    };

    it('ROJO: aceptar una solicitud expirada → 409 SOLICITUD_EXPIRADA', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reservaPendiente({ expiraAt: new Date(Date.now() - 60_000) }),
      );

      await expect(
        service.aceptarReserva('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'SOLICITUD_EXPIRADA', statusCode: 409 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('ROJO: aceptar una reserva que ya no está PENDIENTE → 409 ESTADO_INVALIDO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reservaPendiente({ estado: 'CONFIRMADA' }),
      );

      await expect(
        service.aceptarReserva('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 } });
    });

    it('ROJO: aceptar sin hueco disponible → 409 CONFLICTO_HORARIO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaPendiente());
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({ margenGrupalMinutos: 10 });
      // El hueco lo ocupa otro bloque: no hay slots. Se revalida ANTES de escribir.
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([]);

      await expect(
        service.aceptarReserva('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'CONFLICTO_HORARIO', statusCode: 409 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('VERDE: aceptar PENDIENTE → CONFIRMADA, revalida excluyendo la propia reserva, audita y cancela el job', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaPendiente());
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({ margenGrupalMinutos: 10 });
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([slotDelDia()]);
      mockPrismaService.reserva.update.mockResolvedValue({ id: 'uuid-reserva', estado: 'CONFIRMADA' });
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
      const remove = vi.fn().mockResolvedValue(undefined);
      mockQueue.getJob.mockResolvedValue({ remove });

      const res = await service.aceptarReserva('uuid-barberia', 'uuid-reserva', usuarioAdmin as any);

      expect(res.estado).toBe('CONFIRMADA');
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: { estado: 'CONFIRMADA' },
      });

      // La revalidación excluye la propia reserva: sigue PENDIENTE al medirse.
      expect(mockDisponibilidadService.calcularDisponibilidad).toHaveBeenCalledWith(
        expect.objectContaining({ barberiaId: 'uuid-barberia', excluirReservaId: 'uuid-reserva' }),
        expect.anything(),
      );

      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'RESERVA_CONFIRMADA', entidadId: 'uuid-reserva' }),
        expect.anything(),
      );

      // El job se busca por el id determinista del job de expiración.
      expect(mockQueue.getJob).toHaveBeenCalledWith('expirar-reserva-uuid-reserva');
      expect(remove).toHaveBeenCalled();
    });

    it('ROJO: rechazar sin motivo → 400 MOTIVO_INVALIDO (regla de dominio, no solo del DTO)', async () => {
      await expect(
        service.rechazarReserva('uuid-barberia', 'uuid-reserva', {} as any, usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'MOTIVO_INVALIDO', statusCode: 400 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('ROJO: rechazar con un código fuera del catálogo §5.5 → 400', async () => {
      await expect(
        service.rechazarReserva(
          'uuid-barberia',
          'uuid-reserva',
          { motivoCodigo: 'LO_QUE_SEA' } as any,
          usuarioAdmin as any,
        ),
      ).rejects.toMatchObject({ response: { codigo: 'MOTIVO_INVALIDO', statusCode: 400 } });
    });

    it('ROJO: rechazar con OTRO y detalle corto → 400', async () => {
      await expect(
        service.rechazarReserva(
          'uuid-barberia',
          'uuid-reserva',
          { motivoCodigo: 'OTRO', motivoDetalle: 'ab' } as any,
          usuarioAdmin as any,
        ),
      ).rejects.toMatchObject({ response: { codigo: 'MOTIVO_INVALIDO', statusCode: 400 } });
    });

    it('VERDE: rechazar PENDIENTE → RECHAZADA con motivo persistido, audita y cancela el job', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaPendiente());
      mockPrismaService.reserva.update.mockResolvedValue({
        id: 'uuid-reserva',
        estado: 'RECHAZADA',
        motivoCodigo: 'OTRO',
        motivoDetalle: 'El barbero se ausentó',
        clienteId: 'uuid-cliente',
      });
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
      mockQueue.getJob.mockResolvedValue(null);

      const res = await service.rechazarReserva(
        'uuid-barberia',
        'uuid-reserva',
        { motivoCodigo: 'OTRO', motivoDetalle: 'El barbero se ausentó' } as any,
        usuarioAdmin as any,
      );

      expect(res.estado).toBe('RECHAZADA');
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: { estado: 'RECHAZADA', motivoCodigo: 'OTRO', motivoDetalle: 'El barbero se ausentó' },
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'RESERVA_RECHAZADA', entidadId: 'uuid-reserva' }),
        expect.anything(),
      );
    });

    it('VERDE: rechazar con un código válido distinto de OTRO guarda el detalle en nulo', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaPendiente());
      mockPrismaService.reserva.update.mockResolvedValue({ id: 'uuid-reserva', estado: 'RECHAZADA' });
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
      mockQueue.getJob.mockResolvedValue(null);

      await service.rechazarReserva(
        'uuid-barberia',
        'uuid-reserva',
        { motivoCodigo: 'HORARIO_NO_DISPONIBLE' } as any,
        usuarioAdmin as any,
      );

      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: { estado: 'RECHAZADA', motivoCodigo: 'HORARIO_NO_DISPONIBLE', motivoDetalle: null },
      });
    });

    it('el job de expiración se encola con un jobId determinista (E3-04 §4)', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
        margenGrupalMinutos: 10,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', precio: 15, duracionEstimada: 30, margenOperativo: 0 },
      ]);
      const inicioSlot = new Date('2026-10-10');
      inicioSlot.setHours(9, 0, 0, 0);
      const finSlot = new Date('2026-10-10');
      finSlot.setHours(10, 30, 0, 0);
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { inicio: inicioSlot, fin: finSlot },
      ]);
      mockPrismaService.reserva.create.mockResolvedValue({ id: 'uuid-reserva' });
      mockPrismaService.participanteReserva.create.mockResolvedValue({ id: 'uuid-part' });

      await service.crearReserva('uuid-cliente', 'uuid-barberia', {
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '09:30',
        serviciosIds: ['s1'],
        precioTotalEsperado: 15,
        tipo: 'INDIVIDUAL',
      } as any);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'expirar-reserva',
        { reservaId: 'uuid-reserva' },
        expect.objectContaining({ jobId: 'expirar-reserva-uuid-reserva' }),
      );
    });
  });

  describe('obtenerDetalleReserva', () => {
    it('debe retornar el detalle de la reserva con su snapshot histórico', async () => {
      const mockReserva = {
        id: 'uuid-reserva',
        barberiaId: 'uuid-barberia',
        clienteId: 'uuid-cliente',
        totalPagar: 25.0,
        estado: 'COMPLETADA',
        participantes: [
          {
            nombreParticipante: 'Titular',
            participanteServicios: [
              {
                precioHistorico: 25.0,
                duracionHistorica: 30,
                margenHistorico: 0,
                servicio: { id: 's1', nombre: 'Corte Clásico' },
              },
            ],
          },
        ],
        pago: { estadoPago: 'PAGADA', monto: 25.0 },
      };

      const mockUser = {
        id: 'uuid-admin',
        rolesDetallados: [{ barberiaId: 'uuid-barberia', nombre: 'ADMIN_BARBERIA' }]
      };

      mockPrismaService.reserva.findFirst.mockResolvedValue(mockReserva);

      const res = await service.obtenerDetalleReserva('uuid-barberia', 'uuid-reserva', mockUser as any);
      expect(res).toEqual(mockReserva);
      expect(mockPrismaService.reserva.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'uuid-reserva', barberiaId: 'uuid-barberia' },
        }),
      );
    });

    it('debe lanzar NotFoundException si la reserva no existe', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(null);

      const mockUser = {
        id: 'uuid-admin',
        rolesDetallados: [{ barberiaId: 'uuid-barberia', nombre: 'ADMIN_BARBERIA' }]
      };

      await expect(
        service.obtenerDetalleReserva('uuid-barberia', 'uuid-inexistente', mockUser as any),
      ).rejects.toThrowError(NotFoundException);
    });
  });

  describe('marcarInasistencia (E1-04)', () => {
    it('el ADMINISTRADOR puede marcar inasistencia en una barbería ajena', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-res' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);
      mockPrismaService.usuarioRol.findFirst.mockImplementation(async (args: any) =>
        args?.where?.rol?.nombre === 'ADMINISTRADOR' ? { id: 'ur-global' } : null,
      );
      mockPrismaService.reserva.findUnique.mockResolvedValue({
        id: 'uuid-reserva',
        clienteId: 'uuid-cliente',
        barberiaId: 'uuid-barberia',
        estado: 'CONFIRMADA',
      });
      mockPrismaService.reserva.update.mockResolvedValue({ id: 'uuid-reserva' });
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({
        id: 'uuid-vinculo',
        contadorNoPresentado: 0,
        estaRestringido: false,
        motivoRestriccion: null,
      });
      mockPrismaService.clienteBarberia.update.mockResolvedValue({});

      const result = await service.marcarInasistencia(
        'uuid-barberia',
        'uuid-reserva',
        'admin-global',
      );

      expect(result.contadorNoPresentado).toBe(1);
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: { estado: 'NO_ASISTIO' },
      });
    });

    it('un ADMIN_BARBERIA de otra barbería sigue sin poder marcar inasistencia', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-res' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);

      await expect(
        service.marcarInasistencia('uuid-barberia', 'uuid-reserva', 'admin-ajeno'),
      ).rejects.toThrowError(ForbiddenException);
    });
  });
});


