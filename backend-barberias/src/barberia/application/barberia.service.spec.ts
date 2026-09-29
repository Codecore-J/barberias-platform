import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { BarberiaService } from './barberia.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('BarberiaService', () => {
  let service: BarberiaService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarberiaService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn().mockImplementation(async (cb) => {
              return await cb(prisma); // Mocking the transaction execution
            }),
            usuario: {
              findUnique: vi.fn(),
            },
            barberia: {
              create: vi.fn(),
              findMany: vi.fn(),
              findUnique: vi.fn(),
              update: vi.fn(),
            },
            rol: {
              findUnique: vi.fn(),
            },
            usuarioRol: {
              upsert: vi.fn(),
            },
            configuracionBarberia: {
              create: vi.fn(),
            },
            clienteBarberia: {
              findUnique: vi.fn(),
              count: vi.fn(),
              create: vi.fn(),
              updateMany: vi.fn(),
              update: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<BarberiaService>(BarberiaService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('debe retornar la barberia si existe', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      const result = await service.findOne('uuid-1');
      expect(result.id).toBe(mockBarberia.id);
      expect(result.nombre).toBe(mockBarberia.nombre);
    });

    it('debe arrojar NotFoundException si no existe', async () => {
      (prisma.barberia.findUnique as any).mockResolvedValue(null);
      await expect(service.findOne('uuid-invalid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('debe arrojar ForbiddenException si no es super admin ni responsable', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);

      await expect(service.update('uuid-1', 'other-user', {}, false)).rejects.toThrow(ForbiddenException);
    });

    it('debe permitir si es responsable', async () => {
      const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.barberia.update as any).mockResolvedValue({ ...mockBarberia, nombre: 'Updated' });

      const result = await service.update('uuid-1', 'res-1', { nombre: 'Updated' }, false);
      expect(result.nombre).toBe('Updated');
    });
  });

  describe('remove (soft-delete)', () => {
      it('debe actualizar el estado a INACTIVO', async () => {
        const mockBarberia = { id: 'uuid-1', nombre: 'Barberia 1', responsableId: 'res-1' };
        (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
        (prisma.barberia.update as any).mockResolvedValue({ ...mockBarberia, estado: 'INACTIVO' });
  
        await service.remove('uuid-1', 'res-1', false);
        expect(prisma.barberia.update).toHaveBeenCalledWith({
            where: { id: 'uuid-1' },
            data: { estado: 'INACTIVO' }
        });
      });
  });

  describe('vincularCliente (T2.2)', () => {
    it('debe vincular al cliente con estado ACTIVO y esBarberiaActiva true si es la primera', async () => {
      const mockBarberia = { id: 'barberia-1', codigoAcceso: 'ABC12345', estado: 'ACTIVO' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(null);
      (prisma.clienteBarberia.count as any).mockResolvedValue(0); // 0 previas
      const mockCreated = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'ACTIVO', esBarberiaActiva: true };
      (prisma.clienteBarberia.create as any).mockResolvedValue(mockCreated);

      const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });
      expect(result.estadoVinculacion).toBe('ACTIVO');
      expect(result.esBarberiaActiva).toBe(true);
    });

    it('debe vincular al cliente con estado PENDIENTE si ya tiene 5 o más vinculaciones', async () => {
      const mockBarberia = { id: 'barberia-1', codigoAcceso: 'ABC12345', estado: 'ACTIVO' };
      (prisma.barberia.findUnique as any).mockResolvedValue(mockBarberia);
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(null);
      (prisma.clienteBarberia.count as any).mockResolvedValue(5); // 5 previas
      const mockCreated = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'PENDIENTE', esBarberiaActiva: false };
      (prisma.clienteBarberia.create as any).mockResolvedValue(mockCreated);

      const result = await service.vincularCliente('user-1', { codigoAcceso: 'ABC12345' });
      expect(result.estadoVinculacion).toBe('PENDIENTE');
      expect(result.esBarberiaActiva).toBe(false);
    });
  });

  describe('seleccionarBarberiaActiva (T2.3)', () => {
    it('debe desactivar las demás barberías y activar la seleccionada', async () => {
      const mockVinculacion = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'ACTIVO', esBarberiaActiva: false };
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(mockVinculacion);
      (prisma.clienteBarberia.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.clienteBarberia.update as any).mockResolvedValue({ ...mockVinculacion, esBarberiaActiva: true });

      const result = await service.seleccionarBarberiaActiva('user-1', 'barberia-1');

      expect(prisma.clienteBarberia.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 'user-1' },
        data: { esBarberiaActiva: false },
      });
      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { uk_cliente_barberia: { usuarioId: 'user-1', barberiaId: 'barberia-1' } },
        data: { esBarberiaActiva: true },
      });
      expect(result.esBarberiaActiva).toBe(true);
    });

    it('debe arrojar ForbiddenException si la vinculación está en PENDIENTE', async () => {
      const mockVinculacion = { usuarioId: 'user-1', barberiaId: 'barberia-1', estadoVinculacion: 'PENDIENTE', esBarberiaActiva: false };
      (prisma.clienteBarberia.findUnique as any).mockResolvedValue(mockVinculacion);

      await expect(service.seleccionarBarberiaActiva('user-1', 'barberia-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
