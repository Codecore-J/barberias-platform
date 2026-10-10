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
    participanteServicio: { createMany: vi.fn(), findMany: vi.fn() },
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
        { reservaId: 'uuid-reserva', barberiaId: 'uuid-barberia' },
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

  describe('E3-05 cancelación manual', () => {
    const usuarioCliente = {
      id: 'uuid-cliente',
      correo: 'cliente@test.com',
      roles: ['CLIENTE'],
      rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: null, ambito: 'GLOBAL' }],
    };

    const usuarioAdmin = {
      id: 'uuid-admin',
      correo: 'admin@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [
        { nombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia', ambito: 'BARBERIA' },
      ],
    };

    const reservaVigente = (extra: Record<string, unknown> = {}) => ({
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

    beforeEach(() => {
      mockQueue.getJob.mockResolvedValue(null);
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
    });

    it('VERDE: el CLIENTE dueño cancela su PENDIENTE → CANCELADA, audita y borra el job', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaVigente());
      mockPrismaService.reserva.update.mockResolvedValue({
        id: 'uuid-reserva',
        estado: 'CANCELADA',
        clienteId: 'uuid-cliente',
      });
      const remove = vi.fn().mockResolvedValue(undefined);
      mockQueue.getJob.mockResolvedValue({ remove });

      const res = await service.cancelarReserva(
        'uuid-barberia',
        'uuid-reserva',
        usuarioCliente as any,
      );

      expect(res.estado).toBe('CANCELADA');
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: { estado: 'CANCELADA' },
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'RESERVA_CANCELADA',
          entidadId: 'uuid-reserva',
          contexto: expect.objectContaining({ canceladoPor: 'CLIENTE' }),
        }),
        expect.anything(),
      );
      expect(mockQueue.getJob).toHaveBeenCalledWith('expirar-reserva-uuid-reserva');
      expect(remove).toHaveBeenCalled();
    });

    it('ROJO: un CLIENTE no puede cancelar la reserva de OTRO cliente → 403 RESERVA_AJENA', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reservaVigente({ clienteId: 'otro-cliente' }),
      );

      await expect(
        service.cancelarReserva('uuid-barberia', 'uuid-reserva', usuarioCliente as any),
      ).rejects.toMatchObject({ response: { codigo: 'RESERVA_AJENA', statusCode: 403 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('ROJO: cancelar una reserva ya terminal → 409 ESTADO_INVALIDO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reservaVigente({ estado: 'EXPIRADA' }),
      );

      await expect(
        service.cancelarReserva('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 } });
    });

    it('ROJO: sin rol en esa barbería → 403 antes de tocar la reserva', async () => {
      await expect(
        service.cancelarReserva('uuid-barberia', 'uuid-reserva', {
          ...usuarioCliente,
          rolesDetallados: [],
        } as any),
      ).rejects.toThrowError(ForbiddenException);

      expect(mockPrismaService.reserva.findFirst).not.toHaveBeenCalled();
    });

    it('VERDE: el staff de la sede cancela una CONFIRMADA y la auditoría lo marca como STAFF', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reservaVigente({ estado: 'CONFIRMADA' }),
      );
      mockPrismaService.reserva.update.mockResolvedValue({
        id: 'uuid-reserva',
        estado: 'CANCELADA',
      });

      await service.cancelarReserva('uuid-barberia', 'uuid-reserva', usuarioAdmin as any);

      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'RESERVA_CANCELADA',
          usuarioId: 'uuid-admin',
          contexto: expect.objectContaining({
            estadoAnterior: 'CONFIRMADA',
            canceladoPor: 'STAFF',
          }),
        }),
        expect.anything(),
      );
    });
  });

  // ── E3-07 · ventana de cancelación del CLIENTE (§5.7) ────────────────────
  describe('E3-07 ventana de cancelación del CLIENTE', () => {
    const usuarioCliente = {
      id: 'uuid-cliente',
      correo: 'cliente@test.com',
      roles: ['CLIENTE'],
      rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: null, ambito: 'GLOBAL' }],
    };

    const usuarioAdmin = {
      id: 'uuid-admin',
      correo: 'admin@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [
        { nombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia', ambito: 'BARBERIA' },
      ],
    };

    /**
     * Cita a las 12:00 del 2026-10-10. `fechaCita` es la medianoche UTC del día
     * guardado (es lo que devuelve Prisma para un `@db.Date`) y `horaInicio` va en
     * convención UTC, como la escribe `parseTime`; el instante que mide la ventana
     * es, entonces, el 2026-10-10 a las 12:00 en la zona del servidor.
     */
    const reservaVigente = (extra: Record<string, unknown> = {}) => ({
      id: 'uuid-reserva',
      barberiaId: 'uuid-barberia',
      clienteId: 'uuid-cliente',
      estado: 'CONFIRMADA',
      fechaCita: new Date('2026-10-10T00:00:00.000Z'),
      horaInicio: hora(12, 0),
      horaFin: hora(12, 30),
      margenGrupalHistorico: 10,
      totalPagar: 30,
      expiraAt: null,
      ...extra,
    });

    /** Reloj fijo: la ventana se mide contra `Date.now()`, no contra la base. */
    const aLas = (h: number, m: number) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 10, h, m, 0));
    };

    beforeEach(() => {
      mockQueue.getJob.mockResolvedValue(null);
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
      mockPrismaService.reserva.update.mockResolvedValue({
        id: 'uuid-reserva',
        estado: 'CANCELADA',
        clienteId: 'uuid-cliente',
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('VERDE: a 31 minutos del inicio el CLIENTE aún cancela su CONFIRMADA', async () => {
      aLas(11, 29);
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaVigente());

      const res = await service.cancelarReserva(
        'uuid-barberia',
        'uuid-reserva',
        usuarioCliente as any,
      );

      expect(res.estado).toBe('CANCELADA');
      expect(mockPrismaService.reserva.update).toHaveBeenCalled();
    });

    it('VERDE: exactamente a 30 minutos todavía entra (el límite es «ahora <= inicio − 30»)', async () => {
      aLas(11, 30);
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaVigente());

      const res = await service.cancelarReserva(
        'uuid-barberia',
        'uuid-reserva',
        usuarioCliente as any,
      );

      expect(res.estado).toBe('CANCELADA');
    });

    it('ROJO: a 29 minutos → 422 FUERA_DE_VENTANA y la reserva no se toca', async () => {
      aLas(11, 31);
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaVigente());

      await expect(
        service.cancelarReserva('uuid-barberia', 'uuid-reserva', usuarioCliente as any),
      ).rejects.toMatchObject({ response: { codigo: 'FUERA_DE_VENTANA', statusCode: 422 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
      expect(mockAuditoriaService.registrarEvento).not.toHaveBeenCalled();
    });

    it('ROJO: una CONFIRMADA que ya empezó → 422 FUERA_DE_VENTANA', async () => {
      aLas(12, 5);
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaVigente());

      await expect(
        service.cancelarReserva('uuid-barberia', 'uuid-reserva', usuarioCliente as any),
      ).rejects.toMatchObject({ response: { codigo: 'FUERA_DE_VENTANA', statusCode: 422 } });
    });

    it('VERDE: una solicitud PENDIENTE se cancela siempre, aunque falten 5 minutos', async () => {
      aLas(11, 55);
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reservaVigente({ estado: 'PENDIENTE' }),
      );

      const res = await service.cancelarReserva(
        'uuid-barberia',
        'uuid-reserva',
        usuarioCliente as any,
      );

      expect(res.estado).toBe('CANCELADA');
    });

    it('VERDE: el STAFF no tiene ventana — el admin cancela a 5 minutos del inicio', async () => {
      aLas(11, 55);
      mockPrismaService.reserva.findFirst.mockResolvedValue(reservaVigente());

      const res = await service.cancelarReserva(
        'uuid-barberia',
        'uuid-reserva',
        usuarioAdmin as any,
      );

      expect(res.estado).toBe('CANCELADA');
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          contexto: expect.objectContaining({ canceladoPor: 'STAFF' }),
        }),
        expect.anything(),
      );
    });
  });

  // ── E3-06 · reprogramación de una reserva vigente ────────────────────────
  describe('E3-06 reprogramación', () => {
    const usuarioAdmin = {
      id: 'uuid-admin',
      correo: 'admin@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [
        { nombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia', ambito: 'BARBERIA' },
      ],
    };

    const CONFIG = {
      margenGrupalMinutos: 10,
      nuevasReservasActivas: true,
      horizonteReservaDias: 30,
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

    const dto = { fecha: '2026-10-12', horaInicio: '10:00', horaFin: '10:30' };

    /** Slot del 2026-10-12 a la hora local indicada (mismo armado que el servicio). */
    const slot = (h: number, m: number) => {
      const d = new Date('2026-10-12');
      d.setHours(h, m, 0, 0);
      return d;
    };

    beforeEach(() => {
      // Reloj fijo del 2026-10-10 09:00 local: el horizonte de 30 días y el
      // «día de calendario» de la sede quedan deterministas.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 10, 9, 0, 0));

      mockQueue.getJob.mockResolvedValue(null);
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue(CONFIG);
      mockPrismaService.participanteServicio.findMany.mockResolvedValue([
        { duracionHistorica: 30 },
      ]);
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
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('VERDE: mueve la cita al bloque nuevo, excluye su propio hueco y audita el cambio', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());

      const res = await service.reprogramarReserva(
        'uuid-barberia',
        'uuid-reserva',
        dto,
        usuarioAdmin as any,
      );

      expect(res.horaInicio).toEqual(hora(10, 0));

      // La revalidación tiene que ignorar el hueco ACTUAL de la propia reserva:
      // sin `excluirReservaId` se bloquearía a sí misma.
      expect(mockDisponibilidadService.calcularDisponibilidad).toHaveBeenCalledWith(
        expect.objectContaining({
          barberiaId: 'uuid-barberia',
          duracionTotal: 30,
          margenRequerido: 10,
          excluirReservaId: 'uuid-reserva',
        }),
        expect.anything(),
      );

      // Lo ÚNICO que cambia es el cuándo: ni estado, ni snapshots, ni total.
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: {
          fechaCita: new Date('2026-10-12'),
          horaInicio: hora(10, 0),
          horaFin: hora(10, 30),
        },
      });

      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'RESERVA_REPROGRAMADA',
          entidadId: 'uuid-reserva',
          usuarioId: 'uuid-admin',
          contexto: expect.objectContaining({
            estadoAnterior: 'CONFIRMADA',
            estadoNuevo: 'CONFIRMADA',
            horaAnterior: '09:00-09:30',
            horaNueva: '10:00-10:30',
          }),
        }),
        expect.anything(),
      );
    });

    it('ROJO: colisión con otro hueco ocupado → 409 CONFLICTO_HORARIO y la cita no se mueve', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      // Solo queda libre de 06:00 a 08:00: el bloque nuevo (10:00-10:30+10) no cabe.
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { inicio: slot(6, 0), fin: slot(8, 0) },
      ]);

      await expect(
        service.reprogramarReserva('uuid-barberia', 'uuid-reserva', dto, usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'CONFLICTO_HORARIO', statusCode: 409 } });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
      expect(mockAuditoriaService.registrarEvento).not.toHaveBeenCalled();
    });

    it('ROJO: una reserva terminal → 409 ESTADO_INVALIDO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reserva({ estado: 'CANCELADA' }),
      );

      await expect(
        service.reprogramarReserva('uuid-barberia', 'uuid-reserva', dto, usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 } });
    });

    it('ROJO: con la sede en pausa no se aceptan cambios de horario → 422 RESERVAS_PAUSADAS', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        ...CONFIG,
        nuevasReservasActivas: false,
      });

      await expect(
        service.reprogramarReserva('uuid-barberia', 'uuid-reserva', dto, usuarioAdmin as any),
      ).rejects.toMatchObject({ response: { codigo: 'RESERVAS_PAUSADAS', statusCode: 422 } });
    });

    it('ROJO: fuera del horizonte de la sede → 422 FUERA_DE_HORIZONTE', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());

      await expect(
        service.reprogramarReserva(
          'uuid-barberia',
          'uuid-reserva',
          { ...dto, fecha: '2026-12-15' },
          usuarioAdmin as any,
        ),
      ).rejects.toMatchObject({ response: { codigo: 'FUERA_DE_HORIZONTE', statusCode: 422 } });
    });

    it('ROJO: un bloque más corto que los servicios congelados → 400', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      mockPrismaService.participanteServicio.findMany.mockResolvedValue([
        { duracionHistorica: 30 },
        { duracionHistorica: 40 },
      ]);

      await expect(
        service.reprogramarReserva('uuid-barberia', 'uuid-reserva', dto, usuarioAdmin as any),
      ).rejects.toThrowError(BadRequestException);

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('ROJO: una reserva inexistente en esa sede → 404', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(null);

      await expect(
        service.reprogramarReserva('uuid-barberia', 'uuid-reserva', dto, usuarioAdmin as any),
      ).rejects.toThrowError(NotFoundException);
    });
  });
});


