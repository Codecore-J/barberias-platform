import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service.js';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwtService: any;

  beforeEach(() => {
    mockPrisma = {
      usuario: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      rol: {
        findUnique: vi.fn(),
      },
      usuarioRol: {
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => {
        return cb(mockPrisma);
      }),
    };

    mockJwtService = {
      sign: vi.fn().mockReturnValue('signed-jwt-token'),
    };

    service = new AuthService(mockPrisma, mockJwtService);
  });

  describe('register', () => {
    it('debe registrar un usuario exitosamente y asignarle rol CLIENTE', async () => {
      mockPrisma.rol.findUnique.mockResolvedValue({ id: 'rol-cliente-id', nombre: 'CLIENTE' });
      mockPrisma.usuario.findUnique.mockResolvedValue(null);

      const mockCreatedUser = {
        id: 'new-user-id',
        nombreCompleto: 'Juan Pérez',
        correo: 'juan@example.com',
        telefono: '+584141234567',
        cedula: '12345678',
        passwordHash: 'hashed_password',
        estadoCuenta: 'ACTIVO',
        creadoAt: new Date(),
      };

      mockPrisma.usuario.create.mockResolvedValue(mockCreatedUser);
      mockPrisma.usuarioRol.create.mockResolvedValue({ id: 'ur-1' });

      const result = await service.register({
        nombreCompleto: 'Juan Pérez',
        correo: 'juan@example.com',
        telefono: '+584141234567',
        cedula: '12345678',
        password: 'Password123',
      });

      expect(result.id).toBe('new-user-id');
      expect(result.correo).toBe('juan@example.com');
      expect(result.roles).toContain('CLIENTE');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('debe lanzar ConflictException si la cédula ya existe', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.register({
          nombreCompleto: 'Juan Pérez',
          correo: 'juan@example.com',
          telefono: '+584141234567',
          cedula: '12345678',
          password: 'Password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('debe autenticar exitosamente y retornar token y datos de usuario', async () => {
      const passwordPlana = 'Password123';
      const hash = await bcrypt.hash(passwordPlana, 10);

      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        correo: 'juan@example.com',
        estadoCuenta: 'ACTIVO',
        passwordHash: hash,
        usuarioRoles: [
          { rol: { nombre: 'CLIENTE' } },
        ],
      });

      const result = await service.login({
        correo: 'juan@example.com',
        password: passwordPlana,
      });

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.usuario.id).toBe('user-1');
      expect(result.usuario.roles).toEqual(['CLIENTE']);
    });

    it('debe lanzar UnauthorizedException si la contraseña no coincide', async () => {
      const hash = await bcrypt.hash('OtraPassword123', 10);

      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        correo: 'juan@example.com',
        estadoCuenta: 'ACTIVO',
        passwordHash: hash,
        usuarioRoles: [],
      });

      await expect(
        service.login({
          correo: 'juan@example.com',
          password: 'PasswordIncorrecta1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe lanzar UnauthorizedException si la cuenta está INACTIVA', async () => {
      const hash = await bcrypt.hash('Password123', 10);

      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        correo: 'juan@example.com',
        estadoCuenta: 'SUSPENDIDO',
        passwordHash: hash,
        usuarioRoles: [],
      });

      await expect(
        service.login({
          correo: 'juan@example.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getProfile', () => {
    it('debe retornar el perfil del usuario si existe', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        nombreCompleto: 'Juan Pérez',
        correo: 'juan@example.com',
        telefono: '+584141234567',
        cedula: '12345678',
        estadoCuenta: 'ACTIVO',
        creadoAt: new Date(),
        usuarioRoles: [{ rol: { nombre: 'CLIENTE' } }],
      });

      const result = await service.getProfile('user-1');

      expect(result.id).toBe('user-1');
      expect(result.roles).toContain('CLIENTE');
    });

    it('debe lanzar NotFoundException si el usuario no existe', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
