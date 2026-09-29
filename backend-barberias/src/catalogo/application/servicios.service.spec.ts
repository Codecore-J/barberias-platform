import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ServiciosService } from './servicios.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ServiciosService', () => {
  let service: ServiciosService;
  let prisma: {
    servicio: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    reserva: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  const mockBarberiaId = 'barberia-uuid-1';
  const mockServicioId = 'servicio-uuid-1';

  beforeEach(async () => {
    prisma = {
      servicio: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      reserva: {
        findMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<ServiciosService>(ServiciosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('debe crear un servicio con estado ACTIVO', async () => {
      const dto = {
        nombre: 'Corte Clásico',
        precio: 25.0,
        duracionEstimada: 30,
        margenOperativo: 10,
        destacado: true,
      };

      const mockCreated = { id: mockServicioId, barberiaId: mockBarberiaId, ...dto, estado: 'ACTIVO' };
      prisma.servicio.create.mockResolvedValue(mockCreated);

      const result = await service.create(mockBarberiaId, dto);

      expect(prisma.servicio.create).toHaveBeenCalledWith({
        data: {
          barberiaId: mockBarberiaId,
          nombre: dto.nombre,
          precio: dto.precio,
          duracionEstimada: dto.duracionEstimada,
          margenOperativo: dto.margenOperativo,
          destacado: dto.destacado,
          estado: 'ACTIVO',
        },
      });
      expect(result).toEqual(mockCreated);
    });
  });

  describe('findOne', () => {
    it('debe retornar el servicio si existe en la barbería', async () => {
      const mockServicio = { id: mockServicioId, barberiaId: mockBarberiaId, nombre: 'Corte', estado: 'ACTIVO' };
      prisma.servicio.findFirst.mockResolvedValue(mockServicio);

      const result = await service.findOne(mockBarberiaId, mockServicioId);

      expect(result).toEqual(mockServicio);
    });

    it('debe lanzar NotFoundException si el servicio no existe', async () => {
      prisma.servicio.findFirst.mockResolvedValue(null);

      await expect(service.findOne(mockBarberiaId, 'inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate (FUNC-01)', () => {
    it('debe retornar el servicio directamente si ya está INACTIVO', async () => {
      const mockInactivo = { id: mockServicioId, barberiaId: mockBarberiaId, estado: 'INACTIVO' };
      prisma.servicio.findFirst.mockResolvedValue(mockInactivo);

      const result = await service.deactivate(mockBarberiaId, mockServicioId);

      expect(result).toEqual(mockInactivo);
      expect(prisma.reserva.findMany).not.toHaveBeenCalled();
      expect(prisma.servicio.update).not.toHaveBeenCalled();
    });

    it('debe lanzar BadRequestException si existen reservas futuras en estado PENDIENTE', async () => {
      const mockActivo = { id: mockServicioId, barberiaId: mockBarberiaId, estado: 'ACTIVO' };
      prisma.servicio.findFirst.mockResolvedValue(mockActivo);

      const mockFecha = new Date('2026-10-15T10:00:00.000Z');
      prisma.reserva.findMany.mockResolvedValue([
        {
          id: 'reserva-pend-1',
          fechaCita: mockFecha,
          horaInicio: mockFecha,
        },
      ]);

      await expect(service.deactivate(mockBarberiaId, mockServicioId)).rejects.toThrow(BadRequestException);
      expect(prisma.reserva.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barberiaId: mockBarberiaId,
            estado: 'PENDIENTE',
          }),
        }),
      );
      expect(prisma.servicio.update).not.toHaveBeenCalled();
    });

    it('debe permitir la desactivación si NO hay reservas pendientes (incluso si existen confirmadas)', async () => {
      const mockActivo = { id: mockServicioId, barberiaId: mockBarberiaId, estado: 'ACTIVO' };
      const mockDeactivated = { ...mockActivo, estado: 'INACTIVO' };

      prisma.servicio.findFirst.mockResolvedValue(mockActivo);
      // La consulta solo busca PENDIENTE, por lo que reservas CONFIRMADAS no se retornan (length === 0)
      prisma.reserva.findMany.mockResolvedValue([]);
      prisma.servicio.update.mockResolvedValue(mockDeactivated);

      const result = await service.deactivate(mockBarberiaId, mockServicioId);

      expect(result).toEqual(mockDeactivated);
      expect(prisma.reserva.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barberiaId: mockBarberiaId,
            estado: 'PENDIENTE',
          }),
        }),
      );
      expect(prisma.servicio.update).toHaveBeenCalledWith({
        where: { id: mockServicioId },
        data: { estado: 'INACTIVO' },
      });
    });

    it('debe propagar NotFoundException si el servicio a desactivar no existe', async () => {
      prisma.servicio.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(mockBarberiaId, 'no-existe')).rejects.toThrow(NotFoundException);
      expect(prisma.reserva.findMany).not.toHaveBeenCalled();
    });
  });
});
