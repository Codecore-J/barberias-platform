import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { BarberiaService } from './barberia.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

const BARBERIA_A = 'barberia-a';
const BARBERIA_B = 'barberia-b';

const CLIENTE: UsuarioAutenticado = {
  id: 'usuario-cliente',
  correo: 'cliente@test.com',
  roles: ['CLIENTE'],
  rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: BARBERIA_A, ambito: 'BARBERIA' }],
};

const ADMIN_A: UsuarioAutenticado = {
  id: 'usuario-admin-a',
  correo: 'admin.a@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: BARBERIA_A, ambito: 'BARBERIA' }],
};

const ADMIN_B: UsuarioAutenticado = {
  id: 'usuario-admin-b',
  correo: 'admin.b@test.com',
  roles: ['ADMIN_BARBERIA'],
  rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId: BARBERIA_B, ambito: 'BARBERIA' }],
};

const ADMINISTRADOR: UsuarioAutenticado = {
  id: 'usuario-global',
  correo: 'global@test.com',
  roles: ['ADMINISTRADOR'],
  rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
};

const BARBERO_A: UsuarioAutenticado = {
  id: 'usuario-barbero',
  correo: 'barbero@test.com',
  roles: ['BARBERO'],
  rolesDetallados: [{ nombre: 'BARBERO', barberiaId: BARBERIA_A, ambito: 'BARBERIA' }],
};

/** Fila de usuario_roles tal y como la devuelve Prisma. */
function filaRol(usuarioId: string, nombreRol: string) {
  return {
    barberiaId: BARBERIA_B,
    usuario: {
      id: usuarioId,
      nombreCompleto: 'Persona',
      correo: `${usuarioId}@test.com`,
      telefono: '600000000',
      estadoCuenta: 'ACTIVO',
    },
    rol: { nombre: nombreRol },
  };
}

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
              findMany: vi.fn(),
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

  describe('findPersonal (E1-03 · H19)', () => {
    beforeEach(() => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([]);
    });

    it('debe rechazar a un CLIENTE antes de leer nada', async () => {
      await expect(service.findPersonal(BARBERIA_B, CLIENTE)).rejects.toThrow(ForbiddenException);
      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    });

    it('debe rechazar a un ADMIN de otra barbería antes de leer nada', async () => {
      await expect(service.findPersonal(BARBERIA_B, ADMIN_A)).rejects.toThrow(ForbiddenException);
      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    });

    it('debe listar el personal al ADMIN de esa barbería, con correo y teléfono', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([
        filaRol('barbero-1', 'BARBERO'),
        filaRol('admin-1', 'ADMIN_BARBERIA'),
      ]);

      const result = await service.findPersonal(BARBERIA_B, ADMIN_B);

      expect(prisma.usuarioRol.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { barberiaId: BARBERIA_B } }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'barbero-1',
        correo: 'barbero-1@test.com',
        telefono: '600000000',
        roles: ['BARBERO'],
      });
    });

    it('debe dejar pasar al ADMINISTRADOR global (regla global) con correo y teléfono', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([filaRol('admin-1', 'ADMIN_BARBERIA')]);

      const result = await service.findPersonal(BARBERIA_B, ADMINISTRADOR);

      expect(result).toHaveLength(1);
      expect(result[0].correo).toBe('admin-1@test.com');
      expect(result[0].telefono).toBe('600000000');
    });

    it('debe rechazar a un BARBERO: no existe respuesta sin correo ni teléfono para un no admin', async () => {
      (prisma.usuarioRol.findMany as any).mockResolvedValue([filaRol('barbero-1', 'BARBERO')]);

      await expect(service.findPersonal(BARBERIA_A, BARBERO_A)).rejects.toThrow(ForbiddenException);

      expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
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
