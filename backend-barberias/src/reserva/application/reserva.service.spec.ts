import { Test, TestingModule } from '@nestjs/testing';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { ConflictException, ForbiddenException, BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';

/** Hora UTC, igual que la escribe `parseTime` (setUTCHours). */
function hora(h: number, m: number): Date {
  const d = new Date('1970-01-01T00:00:00Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/**
 * E2-04: zona de la sede del catálogo D15. Los slots esperados se componen con
 * el MISMO reloj central que usa el servicio, así el armado depende de la zona
 * de la sede y no de la del servidor que corre la suite (TZ=UTC o
 * TZ=America/Santo_Domingo, ambos deben pasar).
 */
const TZ_SEDE = ZONA_POR_DEFECTO;
const tiempoTest = new TiempoService();
function enSede(fecha: string, h: number, m = 0): Date {
  return tiempoTest.aInstante(
    fecha,
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    TZ_SEDE,
  );
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
    // E4-02: por defecto el error de agenda viaja SIN alternativas, que es el
    // comportamiento previo. Los tests que quieran comprobar el carril A lo
    // sobrescriben con `mockResolvedValue`.
    buscarAlternativas: vi.fn(async () => []),
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

      // E2-04: instantes en la zona de la SEDE (mismo armado que el servicio).
      const inicioSlot = enSede('2026-10-10', 9);
      const finSlot = enSede('2026-10-10', 10);

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
            margenGrupalHistorico: 0,
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

    it('Sprint de estabilización: el INDIVIDUAL NO suma el margen de la sede (antes lo hacía: D42 mal aplicado)', async () => {
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

      // E2-04: instantes en la zona de la SEDE (mismo armado que el servicio).
      const inicioSlot = enSede('2026-10-10', 9);
      const finSlot = enSede('2026-10-10', 10);

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
            margenGrupalHistorico: 0,
          }),
        }),
      );

      expect(mockDisponibilidadService.calcularDisponibilidad).toHaveBeenCalledWith(
        expect.objectContaining({ margenRequerido: 0 }),
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
      ).rejects.toMatchObject({ response: { codigo: 'RESERVAS_PAUSADAS', statusCode: 422 } });
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

      // E2-04: instantes en la zona de la SEDE.
      const inicioSlot = enSede('2026-10-10', 11);
      const finSlot = enSede('2026-10-10', 12);

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

  describe('E2-05 · margen del bloque individual (sprint de estabilización, 2026-10-12)', () => {
    // Decisión del dueño: `margen_grupal_minutos` (D42) pertenece al flujo GRUPAL.
    // En el INDIVIDUAL el bloque es la ventana pedida y sus márgenes son los de SUS
    // servicios (D01/E2-05). Antes se sumaba SIEMPRE el margen de la sede, así que
    // cada reserva individual arrastraba 10 minutos fantasma en la agenda y en la
    // cotización previa a reservar.

    it('cotizar un INDIVIDUAL devuelve Σ márgenes de los servicios, nunca el de la sede', async () => {
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        aceptaIndividual: true,
        margenGrupalMinutos: 12,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', nombre: 'Corte', precio: 15, duracionEstimada: 20, margenOperativo: 5 },
        { id: 's2', nombre: 'Barba', precio: 10, duracionEstimada: 10, margenOperativo: 3 },
      ]);

      const cotizacion = await service.cotizar('uuid-barberia', {
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '09:40',
        serviciosIds: ['s1', 's2'],
        precioTotalEsperado: 25,
      });

      expect(cotizacion.bloqueTotal.margenTotal).toBe(8);
      expect(cotizacion.bloqueTotal.duracionTotal).toBe(40);
      expect(cotizacion.bloqueTotal.precioTotal).toBe(25);
    });

    it('D42 intacto: la cotización GRUPAL sí lleva el margen de la sede', async () => {
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        aceptaGrupal: true,
        maxPersonasTotal: 3,
        maxNinos: 2,
        margenGrupalMinutos: 12,
      });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', nombre: 'Corte', precio: 15, duracionEstimada: 20, margenOperativo: 5 },
        { id: 's2', nombre: 'Barba infantil', precio: 10, duracionEstimada: 10, margenOperativo: 3 },
      ]);

      const cotizacion = await service.cotizar('uuid-barberia', {
        fecha: '2026-10-10',
        horaInicio: '09:00',
        horaFin: '10:00',
        tipo: 'GRUPAL',
        participantes: [
          { nombre: 'Adulto', esAdultoResponsable: true, servicios: ['s1'] },
          { nombre: 'Niño', esAdultoResponsable: false, servicios: ['s2'] },
        ],
        precioTotalEsperado: 25,
      });

      expect(cotizacion.bloqueTotal.margenTotal).toBe(12);
      expect(cotizacion.bloqueTotal.duracionTotal).toBe(42);
      expect(cotizacion.bloqueTotal.precioTotal).toBe(25);
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
    const slotDelDia = () => ({
      inicio: enSede('2026-10-10', 0),
      fin: enSede('2026-10-10', 23, 59),
    });

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
      // E2-04: instantes en la zona de la SEDE.
      const inicioSlot = enSede('2026-10-10', 9);
      const finSlot = enSede('2026-10-10', 10, 30);
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
      // E2-02: el estado del catálogo (D08) es NO_PRESENTADO; NO_ASISTIO nunca
      // perteneció a los 8 de §5.1 y se escribía fuera del catálogo.
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: { estado: 'NO_PRESENTADO' },
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

    /**
     * Reloj fijo: la ventana se mide contra `Date.now()`, no contra la base.
     *
     * E2-04: la hora es LOCAL DE LA SEDE. Antes se fijaba con
     * `new Date(2026, 9, 10, h, m)`, que es la zona del servidor; con la cita
     * compuesta en la zona de la sede la cuenta de minutos salía desplazada y las
     * aserciones de 29/30/31 minutos medían otra cosa. Re-anclado al nuevo reloj.
     */
    const aLas = (h: number, m: number) => {
      vi.useFakeTimers();
      vi.setSystemTime(enSede('2026-10-10', h, m));
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

    it('H36: la ventana de una cita a las 21:00 locales se mide contra la SEDE, no contra el servidor', async () => {
      // Regresión de H36. A las 16:35 locales faltan 4 h 25 min para las 21:00
      // locales: el CLIENTE debe poder cancelar. Con el código viejo, en un
      // servidor UTC (Render) el instante se componía como 21:00 UTC y la misma
      // petición daba 422 a 25 min (ventana cerrada 4 h antes de tiempo). Es la
      // prueba ROJA con TZ=UTC de la ficha E2-04.
      mockPrismaService.reserva.findFirst.mockResolvedValue(
        reservaVigente({ horaInicio: hora(21, 0), horaFin: hora(21, 30) }),
      );
      mockPrismaService.reserva.update.mockResolvedValue({
        id: 'uuid-reserva',
        estado: 'CANCELADA',
        clienteId: 'uuid-cliente',
      });

      aLas(16, 35);
      const res = await service.cancelarReserva(
        'uuid-barberia',
        'uuid-reserva',
        usuarioCliente as any,
      );
      expect(res.estado).toBe('CANCELADA');

      // Y a las 20:31 locales (29 minutos reales) la ventana ya está cerrada.
      vi.setSystemTime(enSede('2026-10-10', 20, 31));
      await expect(
        service.cancelarReserva('uuid-barberia', 'uuid-reserva', usuarioCliente as any),
      ).rejects.toMatchObject({ response: { codigo: 'FUERA_DE_VENTANA', statusCode: 422 } });
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

    /** Slot del 2026-10-12 a la hora local de la SEDE (E2-04). */
    const slot = (h: number, m: number) => enSede('2026-10-12', h, m);

    beforeEach(() => {
      // Reloj fijo del 2026-10-10 09:00 LOCAL DE LA SEDE (E2-04): el horizonte de
      // 30 días y el «día de calendario» de la sede quedan deterministas en
      // cualquier TZ del servidor que corre la suite.
      vi.useFakeTimers();
      vi.setSystemTime(enSede('2026-10-10', 9));

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

    it('E4-02: la colisión ofrece alternativas reales dentro del 409 (Carril A)', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva());
      // Solo queda libre de 06:00 a 08:00: el bloque nuevo (10:00-10:30+10) no cabe.
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { inicio: slot(6, 0), fin: slot(8, 0) },
      ]);
      mockPrismaService.reserva.findUnique.mockResolvedValue({ margenGrupalHistorico: 10 });
      mockPrismaService.barberia.findUnique.mockResolvedValue({ zonaHoraria: TZ_SEDE });
      const alternativas = [{ fecha: '2026-10-12', horaInicio: '11:00', horaFin: '11:30' }];
      mockDisponibilidadService.buscarAlternativas.mockReset();
      mockDisponibilidadService.buscarAlternativas.mockResolvedValueOnce(alternativas);

      await expect(
        service.reprogramarReserva('uuid-barberia', 'uuid-reserva', dto, usuarioAdmin as any),
      ).rejects.toMatchObject({
        response: { codigo: 'CONFLICTO_HORARIO', statusCode: 409, alternativas },
      });

      // D47: el MISMO cálculo, con el bloque pactado (30 + margen histórico 10)
      // y la hora pedida como objetivo de cercanía.
      expect(mockDisponibilidadService.buscarAlternativas).toHaveBeenCalledWith({
        barberiaId: 'uuid-barberia',
        fecha: '2026-10-12',
        duracionRequeridaMinutos: 40,
        horaObjetivo: '10:00',
      });
      // La sugerencia no retiene nada: la reprogramación no llegó a escribirse.
      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
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

  // ── E2-02 · la máquina de estados gobierna las transiciones (§5.2) ───────
  describe('E2-02 máquina de estados', () => {
    const usuarioAdmin = {
      id: 'uuid-admin',
      correo: 'admin@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [
        { nombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia', ambito: 'BARBERIA' },
      ],
    };

    const reserva = (estado: string) => ({
      id: 'uuid-reserva',
      barberiaId: 'uuid-barberia',
      clienteId: 'uuid-cliente',
      estado,
      fechaCita: new Date('2026-10-10'),
      horaInicio: hora(10, 0),
      horaFin: hora(10, 30),
      margenGrupalHistorico: 10,
      totalPagar: 30,
      expiraAt: new Date(Date.now() + 5 * 60000),
    });

    /** Deja pasar las comprobaciones de permiso de `marcarInasistencia` como ADMINISTRADOR global. */
    const permitirAlSolicitante = () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-res' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);
      mockPrismaService.usuarioRol.findFirst.mockImplementation(async (args: any) =>
        args?.where?.rol?.nombre === 'ADMINISTRADOR' ? { id: 'ur-global' } : null,
      );
    };

    beforeEach(() => {
      mockQueue.getJob.mockResolvedValue(null);
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({
        id: 'uuid-vinculo',
        contadorNoPresentado: 0,
        estaRestringido: false,
        motivoRestriccion: null,
      });
      mockPrismaService.clienteBarberia.update.mockResolvedValue({});
      mockPrismaService.clienteBarberia.create.mockResolvedValue({ id: 'uuid-vinculo' });
    });

    it('ROJO: marcar inasistencia sobre una CANCELADA → 409 ESTADO_INVALIDO y no se escribe', async () => {
      permitirAlSolicitante();
      mockPrismaService.reserva.findUnique.mockResolvedValue(reserva('CANCELADA'));

      await expect(
        service.marcarInasistencia('uuid-barberia', 'uuid-reserva', 'admin-global'),
      ).rejects.toMatchObject({
        response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 },
      });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
      expect(mockPrismaService.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('ROJO: marcar inasistencia dos veces → 409 ESTADO_INVALIDO', async () => {
      permitirAlSolicitante();
      mockPrismaService.reserva.findUnique.mockResolvedValue(reserva('NO_PRESENTADO'));

      await expect(
        service.marcarInasistencia('uuid-barberia', 'uuid-reserva', 'admin-global'),
      ).rejects.toMatchObject({
        response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 },
      });

      expect(mockPrismaService.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('ROJO: el staff no cancela una PENDIENTE (la sede la rechaza) → 409 ESTADO_INVALIDO', async () => {
      mockPrismaService.reserva.findFirst.mockResolvedValue(reserva('PENDIENTE'));

      await expect(
        service.cancelarReserva('uuid-barberia', 'uuid-reserva', usuarioAdmin as any),
      ).rejects.toMatchObject({
        response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 },
      });

      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('VERDE: la inasistencia escribe NO_PRESENTADO y el hook cierra el temporizador', async () => {
      permitirAlSolicitante();
      mockPrismaService.reserva.findUnique.mockResolvedValue(reserva('CONFIRMADA'));
      mockPrismaService.reserva.update.mockResolvedValue({ id: 'uuid-reserva' });

      const result = await service.marcarInasistencia(
        'uuid-barberia',
        'uuid-reserva',
        'admin-global',
      );

      expect(result.contadorNoPresentado).toBe(1);
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: 'uuid-reserva' },
        data: { estado: 'NO_PRESENTADO' },
      });
      expect(mockQueue.getJob).toHaveBeenCalledWith('expirar-reserva-uuid-reserva');
    });
  });

  // ── E4-02 · Carril A: la creación fallida viaja con las alternativas ─────
  describe('E4-02 Carril A · alternativas en el error de creación', () => {
    const ALTERNATIVAS = [
      { fecha: '2026-10-12', horaInicio: '11:00', horaFin: '11:30' },
      { fecha: '2026-10-12', horaInicio: '15:00', horaFin: '15:30' },
    ];

    const CONFIG = {
      modoReserva: 'MANUAL',
      nuevasReservasActivas: true,
      aceptaIndividual: true,
      aceptaGrupal: true,
      margenGrupalMinutos: 10,
      horizonteReservaDias: 30,
    };

    const dto = {
      fecha: '2026-10-12',
      horaInicio: '10:00',
      horaFin: '10:30',
      serviciosIds: ['s1'],
      precioTotalEsperado: 15,
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(enSede('2026-10-10', 9));
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({ estaRestringido: false });
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue(CONFIG);
      mockPrismaService.barberia.findUnique.mockResolvedValue({ zonaHoraria: TZ_SEDE });
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', precio: 15, duracionEstimada: 30, margenOperativo: 0 },
      ]);
      mockQueue.getJob.mockResolvedValue(null);
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
      // Limpia cualquier `once` en cola: cada test decide su propia respuesta.
      mockDisponibilidadService.buscarAlternativas.mockReset();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('VERDE: sin hueco → 409 CONFLICTO_HORARIO con las alternativas del mismo día', async () => {
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([]);
      mockDisponibilidadService.buscarAlternativas.mockResolvedValueOnce(ALTERNATIVAS);

      await expect(service.crearReserva('uuid-cliente', 'uuid-barberia', dto)).rejects.toMatchObject({
        response: { statusCode: 409, codigo: 'CONFLICTO_HORARIO', alternativas: ALTERNATIVAS },
      });

      // D47: el bloque REAL del INDIVIDUAL es su ventana (30 min) SIN margen de
      // sede — el margen de D42 es del GRUPAL (sprint de estabilización,
      // 2026-10-12) — y la hora pedida.
      expect(mockDisponibilidadService.buscarAlternativas).toHaveBeenCalledWith({
        barberiaId: 'uuid-barberia',
        fecha: '2026-10-12',
        duracionRequeridaMinutos: 30,
        horaObjetivo: '10:00',
      });
      expect(mockPrismaService.reserva.create).not.toHaveBeenCalled();
    });

    it('VERDE: un grupo que no cabe → 422 CAPACIDAD_EXCEDIDA con alternativas en el cuerpo', async () => {
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        ...CONFIG,
        maxPersonasTotal: 2,
      });
      mockDisponibilidadService.buscarAlternativas.mockResolvedValueOnce(ALTERNATIVAS);

      await expect(
        service.crearReserva('uuid-cliente', 'uuid-barberia', {
          ...dto,
          // Ventana de 105 min: el grupo se mide por Σ servicios, no por aquí (D46/§5.4).
          horaFin: '11:45',
          precioTotalEsperado: 45,
          tipo: 'GRUPAL',
          participantes: [
            { nombre: 'Ana', esAdultoResponsable: true, servicios: ['s1'] },
            { nombre: 'Nico', esAdultoResponsable: false, servicios: ['s1'] },
            { nombre: 'Sofi', esAdultoResponsable: false, servicios: ['s1'] },
          ],
        }),
      ).rejects.toMatchObject({
        response: { statusCode: 422, codigo: 'CAPACIDAD_EXCEDIDA', alternativas: ALTERNATIVAS },
      });

      // Σ duraciones (30) + margen (10): la ventana de 105 min no manda.
      expect(mockDisponibilidadService.buscarAlternativas).toHaveBeenCalledWith({
        barberiaId: 'uuid-barberia',
        fecha: '2026-10-12',
        duracionRequeridaMinutos: 40,
        horaObjetivo: '10:00',
      });
      // Un rechazo por capacidad no escribe nada (§E4-01).
      expect(mockPrismaService.reserva.create).not.toHaveBeenCalled();
    });

    it('VERDE: si el calculador no encuentra nada, el error viaja tal cual (nunca un hueco falso)', async () => {
      mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([]);

      const error = await service
        .crearReserva('uuid-cliente', 'uuid-barberia', dto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ statusCode: 409, codigo: 'CONFLICTO_HORARIO' });
      expect(error.getResponse().alternativas).toBeUndefined();
    });

    it('VERDE: un error que no es de agenda ni de capacidad no consulta alternativas', async () => {
      mockPrismaService.servicio.findMany.mockResolvedValue([]); // → 400 SERVICIO_FUERA_DE_BARBERIA

      await expect(service.crearReserva('uuid-cliente', 'uuid-barberia', dto)).rejects.toThrowError(
        BadRequestException,
      );

      expect(mockDisponibilidadService.buscarAlternativas).not.toHaveBeenCalled();
    });
  });

  /**
   * E4-03 · fidelización por inasistencias (spec 01 §5.8, D48).
   *
   * Dos mitades de la misma regla: la creación bloquea al restringido de ESA
   * sede (individual y grupal) y el marcado de inasistencia es lo que restringe
   * al llegar al límite, con su motivo y su auditoría.
   */
  describe('E4-03 · fidelización por inasistencias', () => {
    const dtoIndividual = {
      fecha: '2026-10-12',
      horaInicio: '10:00',
      horaFin: '10:30',
      serviciosIds: ['s1'],
      precioTotalEsperado: 15,
    };

    const dtoGrupal = {
      fecha: '2026-10-12',
      horaInicio: '10:00',
      horaFin: '11:45',
      serviciosIds: ['s1'],
      precioTotalEsperado: 45,
      tipo: 'GRUPAL' as const,
      participantes: [
        { nombre: 'Ana', esAdultoResponsable: true, servicios: ['s1'] },
        { nombre: 'Nico', esAdultoResponsable: false, servicios: ['s1'] },
      ],
    };

    const vinculoRestringido = {
      id: 'uuid-vinculo',
      contadorNoPresentado: 5,
      estaRestringido: true,
      motivoRestriccion: 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.',
    };

    beforeEach(() => {
      mockQueue.getJob.mockResolvedValue(null);
      mockAuditoriaService.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
    });

    it('VERDE: el INDIVIDUAL de un cliente restringido responde 403 CLIENTE_RESTRINGIDO', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue(vinculoRestringido);

      const error = await service
        .crearReserva('uuid-cliente', 'uuid-barberia', dtoIndividual)
        .catch((e: any) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({
        statusCode: 403,
        codigo: 'CLIENTE_RESTRINGIDO',
        mensaje: vinculoRestringido.motivoRestriccion,
      });
      // La regla de negocio se resuelve ANTES de leer configuración o disponibilidad.
      expect(mockPrismaService.configuracionBarberia.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.reserva.create).not.toHaveBeenCalled();
    });

    it('VERDE: el GRUPAL de un cliente restringido también se rechaza con 403 CLIENTE_RESTRINGIDO', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue(vinculoRestringido);

      const error = await service
        .crearReserva('uuid-cliente', 'uuid-barberia', dtoGrupal)
        .catch((e: any) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({
        statusCode: 403,
        codigo: 'CLIENTE_RESTRINGIDO',
      });
      expect(mockPrismaService.configuracionBarberia.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.participanteReserva.create).not.toHaveBeenCalled();
      expect(mockPrismaService.reserva.create).not.toHaveBeenCalled();
    });

    describe('marcarInasistencia', () => {
      const reservaConfirmada = {
        id: 'uuid-reserva',
        clienteId: 'uuid-cliente',
        barberiaId: 'uuid-barberia',
        estado: 'CONFIRMADA',
      };

      beforeEach(() => {
        // El responsable de la sede marca la inasistencia (D02).
        mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'uuid-admin-sede' });
        mockPrismaService.reserva.findUnique.mockResolvedValue(reservaConfirmada);
        mockPrismaService.reserva.update.mockResolvedValue({ id: 'uuid-reserva' });
        mockPrismaService.clienteBarberia.update.mockResolvedValue({});
      });

      it('VERDE: la 5ª inasistencia restringe con motivo y se audita (D28)', async () => {
        mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({
          id: 'uuid-vinculo',
          contadorNoPresentado: 4,
          estaRestringido: false,
          motivoRestriccion: null,
        });

        const resultado = await service.marcarInasistencia(
          'uuid-barberia',
          'uuid-reserva',
          'uuid-admin-sede',
        );

        expect(resultado).toMatchObject({
          success: true,
          contadorNoPresentado: 5,
          estaRestringido: true,
          advertencia: true,
        });
        expect(resultado.motivoRestriccion).toContain('5 inasistencias');

        expect(mockPrismaService.clienteBarberia.update).toHaveBeenCalledWith({
          where: { id: 'uuid-vinculo' },
          data: {
            contadorNoPresentado: 5,
            estaRestringido: true,
            motivoRestriccion: expect.stringContaining('5 inasistencias'),
          },
        });

        expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledTimes(1);
        expect(mockAuditoriaService.registrarEvento.mock.calls[0][0]).toMatchObject({
          usuarioId: 'uuid-admin-sede',
          accion: 'CLIENTE_RESTRINGIDO',
          entidad: 'cliente_barberias',
          entidadId: 'uuid-vinculo',
          contexto: { barberiaId: 'uuid-barberia', clienteId: 'uuid-cliente' },
        });
      });

      it('la 3ª inasistencia deja advertencia pero NO restringe', async () => {
        mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({
          id: 'uuid-vinculo',
          contadorNoPresentado: 2,
          estaRestringido: false,
          motivoRestriccion: null,
        });

        const resultado = await service.marcarInasistencia(
          'uuid-barberia',
          'uuid-reserva',
          'uuid-admin-sede',
        );

        expect(resultado).toMatchObject({
          contadorNoPresentado: 3,
          estaRestringido: false,
          advertencia: true,
          motivoRestriccion: null,
        });
        expect(mockAuditoriaService.registrarEvento).not.toHaveBeenCalled();
      });

      it('D20: una restricción vigente conserva su motivo y no se vuelve a auditar', async () => {
        mockPrismaService.clienteBarberia.findUnique.mockResolvedValue({
          id: 'uuid-vinculo',
          contadorNoPresentado: 5,
          estaRestringido: true,
          motivoRestriccion: 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.',
        });

        const resultado = await service.marcarInasistencia(
          'uuid-barberia',
          'uuid-reserva',
          'uuid-admin-sede',
        );

        expect(resultado).toMatchObject({
          contadorNoPresentado: 6,
          estaRestringido: true,
        });
        expect(resultado.motivoRestriccion).toBe(
          'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.',
        );
        expect(mockAuditoriaService.registrarEvento).not.toHaveBeenCalled();
      });

      it('un admin de OTRA sede no puede marcar la inasistencia (403)', async () => {
        mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-res' });
        mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);
        mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);

        await expect(
          service.marcarInasistencia('uuid-barberia', 'uuid-reserva', 'admin-ajeno'),
        ).rejects.toThrowError(ForbiddenException);
        expect(mockPrismaService.clienteBarberia.update).not.toHaveBeenCalled();
      });
    });
  });
});


