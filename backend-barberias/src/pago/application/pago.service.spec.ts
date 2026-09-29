import { Test, TestingModule } from '@nestjs/testing';
import { PagoService } from './pago.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

describe('PagoService', () => {
  let service: PagoService;

  const mockPrismaService = {
    barberia: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    reserva: { findFirst: vi.fn(), update: vi.fn() },
    pago: { upsert: vi.fn() },
    auditoria: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(mockPrismaService)),
  };

  const mockAuditoriaService = {
    registrarEvento: vi.fn().mockResolvedValue({ id: 'uuid-audit' }),
    consultarAuditorias: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PagoService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditoriaService, useValue: mockAuditoriaService },
      ],
    }).compile();

    service = module.get<PagoService>(PagoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registrarPagoEnPersona', () => {
    const usuarioId = 'uuid-responsable';
    const barberiaId = 'uuid-barberia';
    const reservaId = 'uuid-reserva';

    it('debe registrar el pago en persona exitosamente, marcar la reserva como COMPLETADA y crear auditoría', async () => {
      // 1. Acceso permitido (responsable)
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });

      // 2. Reserva encontrada en estado CONFIRMADA sin pago previo
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        clienteId: 'uuid-cliente',
        estado: 'CONFIRMADA',
        totalPagar: 25.0,
        pago: null,
      });

      // 3. Upsert de pago
      const mockPago = {
        id: 'uuid-pago',
        reservaId,
        estadoPago: 'PAGADA',
        monto: 25.0,
        registradoPor: usuarioId,
      };
      mockPrismaService.pago.upsert.mockResolvedValue(mockPago);

      // 4. Update de reserva
      const mockReservaCompletada = {
        id: reservaId,
        estado: 'COMPLETADA',
      };
      mockPrismaService.reserva.update.mockResolvedValue(mockReservaCompletada);

      const result = await service.registrarPagoEnPersona(usuarioId, barberiaId, {
        reservaId,
        monto: 25.0,
        metodoPago: 'EFECTIVO',
      });

      expect(result.pago).toEqual(mockPago);
      expect(result.reserva.estado).toBe('COMPLETADA');
      expect(mockPrismaService.pago.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reservaId },
          create: expect.objectContaining({
            reservaId,
            estadoPago: 'PAGADA',
            monto: 25.0,
            registradoPor: usuarioId,
          }),
        }),
      );
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: reservaId },
        data: { estado: 'COMPLETADA' },
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId,
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          entidad: 'PAGO',
          entidadId: mockPago.id,
        }),
        expect.anything(),
      );
    });

    it('debe tomar totalPagar de la reserva si no se especifica monto en el DTO', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });

      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        clienteId: 'uuid-cliente',
        estado: 'PENDIENTE',
        totalPagar: 35.5,
        pago: null,
      });

      mockPrismaService.pago.upsert.mockResolvedValue({
        id: 'uuid-pago',
        monto: 35.5,
      });
      mockPrismaService.reserva.update.mockResolvedValue({
        id: reservaId,
        estado: 'COMPLETADA',
      });

      await service.registrarPagoEnPersona(usuarioId, barberiaId, {
        reservaId,
      });

      expect(mockPrismaService.pago.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            monto: 35.5,
          }),
        }),
      );
    });

    it('debe lanzar ForbiddenException si el usuario no tiene permisos', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'otro-usuario',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null); // No es SUPER_ADMIN
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]); // No tiene roles

      await expect(
        service.registrarPagoEnPersona('usuario-no-autorizado', barberiaId, {
          reservaId,
        }),
      ).rejects.toThrowError(ForbiddenException);
    });

    it('debe lanzar NotFoundException si la reserva no existe en la barbería', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue(null);

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, {
          reservaId: 'reserva-inexistente',
        }),
      ).rejects.toThrowError(NotFoundException);
    });

    it('debe lanzar BadRequestException si la reserva está CANCELADA', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        estado: 'CANCELADA',
      });

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, {
          reservaId,
        }),
      ).rejects.toThrowError(BadRequestException);
    });

    it('debe lanzar ConflictException si la reserva ya estaba PAGADA', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        estado: 'COMPLETADA',
        pago: {
          estadoPago: 'PAGADA',
          monto: 20,
        },
      });

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, {
          reservaId,
        }),
      ).rejects.toThrowError(ConflictException);
    });
  });

  describe('obtenerAuditoriaPagos', () => {
    const usuarioId = 'uuid-responsable';
    const barberiaId = 'uuid-barberia';

    it('debe validar permisos y retornar los registros de auditoría de pagos', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });

      const mockAuditorias = {
        total: 1,
        limite: 50,
        offset: 0,
        registros: [
          {
            id: 'audit-1',
            accion: 'REGISTRO_PAGO_EN_PERSONA',
            entidad: 'PAGO',
            entidadId: 'pago-1',
          },
        ],
      };
      mockAuditoriaService.consultarAuditorias.mockResolvedValue(mockAuditorias);

      const result = await service.obtenerAuditoriaPagos(usuarioId, barberiaId, 50, 0);

      expect(result).toEqual(mockAuditorias);
      expect(mockAuditoriaService.consultarAuditorias).toHaveBeenCalledWith({
        entidad: 'PAGO',
        accion: 'REGISTRO_PAGO_EN_PERSONA',
        barberiaId,
        limite: 50,
        offset: 0,
      });
    });
  });
});
