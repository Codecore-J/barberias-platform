import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthController } from './auth.controller.js';
import { AuthService } from '../application/auth.service.js';
import { RegisterDto } from '../application/dto/register.dto.js';
import { LoginDto } from '../application/dto/login.dto.js';
import { UsuarioResponseDto } from '../application/dto/usuario-response.dto.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockUsuarioResponse: UsuarioResponseDto = {
    id: 'user-uuid-1',
    nombreCompleto: 'Carlos Barbero',
    correo: 'carlos@example.com',
    telefono: '+584121234567',
    cedula: '12345678',
    estadoCuenta: 'ACTIVO',
    creadoAt: new Date(),
    roles: ['CLIENTE'],
    passwordHash: 'hash-excluido',
  };

  beforeEach(() => {
    authService = {
      register: vi.fn(),
      login: vi.fn(),
      getProfile: vi.fn(),
    } as any;

    controller = new AuthController(authService);
  });

  describe('register', () => {
    it('debe invocar a authService.register y retornar el usuario creado', async () => {
      const dto: RegisterDto = {
        nombreCompleto: 'Carlos Barbero',
        correo: 'carlos@example.com',
        telefono: '+584121234567',
        cedula: '12345678',
        password: 'Password123',
      };

      vi.spyOn(authService, 'register').mockResolvedValue(mockUsuarioResponse);

      const result = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockUsuarioResponse);
    });
  });

  describe('login', () => {
    it('debe invocar a authService.login y retornar el token con el perfil', async () => {
      const dto: LoginDto = {
        correo: 'carlos@example.com',
        password: 'Password123',
      };

      const mockLoginResponse = {
        accessToken: 'mock-jwt-token',
        usuario: mockUsuarioResponse,
      };

      vi.spyOn(authService, 'login').mockResolvedValue(mockLoginResponse);

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockLoginResponse);
    });
  });

  describe('getProfile (/me)', () => {
    it('debe invocar a authService.getProfile con el id del usuario autenticado', async () => {
      const mockUser = {
        id: 'user-uuid-1',
        correo: 'carlos@example.com',
        roles: ['CLIENTE'],
      };

      vi.spyOn(authService, 'getProfile').mockResolvedValue(mockUsuarioResponse);

      const result = await controller.getProfile(mockUser);

      expect(authService.getProfile).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual(mockUsuarioResponse);
    });
  });
});
