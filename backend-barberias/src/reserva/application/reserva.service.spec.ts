import { Test, TestingModule } from '@nestjs/testing';
import { ReservaService } from './reserva.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { ConflictException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';

describe('ReservaService', () => {
  let service: ReservaService;

  const mockPrismaService = {
    $queryRaw: vi.fn(),
    configuracionBarberia: { findUnique: vi.fn() },
    clienteBarberia: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    reserva: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
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
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DisponibilidadService, useValue: mockDisponibilidadService },
        { provide: getQueueToken('reservas-pendientes'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<ReservaService>(ReservaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('crearReserva y Snapshot Inmutable (T6.2)', () => {
    it('debe congelar precioHistorico, duracionHistorica y margenHistorico en el snapshot de ParticipanteServicio', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue(null); // No restringido
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
      });

      // Simular catálogo con precio oficial de $15, 30 mins, 5 margen
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

      // Verificar que se creó la reserva con totalPagar del catálogo
      expect(mockPrismaService.reserva.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalPagar: 15,
            margenGrupalHistorico: 5,
          }),
        }),
      );

      // Verificar snapshot congelado e inmutable en participanteServicio
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

    it('debe rechazar con BadRequestException si los servicios solicitados no existen en la barbería', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue(null);
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
      });

      // No encuentra el servicio
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
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue(null);
      mockPrismaService.configuracionBarberia.findUnique.mockResolvedValue({
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
      });

      // Servicio dura 60 minutos
      mockPrismaService.servicio.findMany.mockResolvedValue([
        { id: 's1', precio: 50, duracionEstimada: 60, margenOperativo: 0 },
      ]);

      // Usuario solo pide 30 minutos (09:00 a 09:30)
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

    it('debe rechazar con BadRequestException si la barbería pausó nuevas reservas', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue(null);
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
      ).rejects.toThrowError(BadRequestException);
    });

    it('debe fallar con ConflictException si no hay disponibilidad en la fecha solicitada', async () => {
      mockPrismaService.clienteBarberia.findUnique.mockResolvedValue(null);
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

      // Disponibilidad en otro horario (11:00 a 12:00, pero pide 09:00 a 09:30)
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
});


