import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { AuthController } from './auth.controller.js';
import { AuthService } from '../application/auth.service.js';
import { RegisterDto } from '../application/dto/register.dto.js';
import { LoginDto } from '../application/dto/login.dto.js';
import { UsuarioResponseDto } from '../application/dto/usuario-response.dto.js';
import { OtpService } from '../application/otp.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  // Dobles de `vi.fn()`: afirmar sobre el `Mock` evita referenciar un método
  // del servicio fuera de su objeto, que perdería `this`.
  let authService: { register: Mock; login: Mock; getProfile: Mock };
  // Igual que `authService`: un registro de dobles, no una instancia real.
  // Tipado así, `expect(otpService.enviar)` no es un método suelto sin `this`.
  let otpService: { enviar: Mock; verificar: Mock; actualizarContacto: Mock };

  const mockUsuarioResponse: UsuarioResponseDto = {
    id: 'user-uuid-1',
    nombreCompleto: 'Carlos Barbero',
    correo: 'carlos@example.com',
    telefono: '+584121234567',
    cedula: '12345678',
    estadoCuenta: 'ACTIVO',
    creadoAt: new Date(),
    roles: ['CLIENTE'],
    telefonoVerificado: false,
    correoVerificado: false,
    passwordHash: 'hash-excluido',
  };

  beforeEach(() => {
    authService = {
      register: vi.fn(),
      login: vi.fn(),
      getProfile: vi.fn(),
    };

    otpService = {
      enviar: vi.fn(),
      verificar: vi.fn(),
      actualizarContacto: vi.fn(),
    };

    controller = new AuthController(
      authService as unknown as AuthService,
      otpService as unknown as OtpService,
    );
  });

  describe('register', () => {
    it('debe invocar a authService.register y retornar token + usuario (auto-login E3)', async () => {
      const dto: RegisterDto = {
        nombreCompleto: 'Carlos Barbero',
        correo: 'carlos@example.com',
        telefono: '+584121234567',
        cedula: '12345678',
        password: 'Password123',
      };

      const mockRegisterResponse = {
        accessToken: 'mock-jwt-token',
        usuario: mockUsuarioResponse,
      };

      vi.spyOn(authService, 'register').mockResolvedValue(mockRegisterResponse);

      const result = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockRegisterResponse);
      expect(result.accessToken).toBe('mock-jwt-token');
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

  /**
   * T-21 · Los dos endpoints de la cuenta pendiente. Lo que se fija aquí es el
   * límite de confianza: el usuario sale SIEMPRE del token y el cuerpo solo
   * aporta el canal o el contacto nuevo. Si el controlador aceptara un id del
   * cuerpo, el endpoint sería un cambiador de teléfonos ajeno.
   */
  describe('reenvío y corrección del contacto (T-21)', () => {
    const mockUser = {
      id: 'user-uuid-1',
      correo: 'carlos@example.com',
      roles: ['CLIENTE'],
    };

    it('resendOtp delega el canal en OtpService con el usuario del token', async () => {
      const respuesta = {
        mensaje: 'Código enviado a tu teléfono.',
        expiraEn: new Date().toISOString(),
      };
      vi.spyOn(otpService, 'enviar').mockResolvedValue(respuesta);

      const result = await controller.resendOtp(mockUser, {
        tipo: 'TELEFONO' as never,
      });

      expect(otpService.enviar).toHaveBeenCalledWith('user-uuid-1', 'TELEFONO');
      expect(result).toEqual(respuesta);
    });

    it('updateContact delega en OtpService con el contacto nuevo y el usuario del token', async () => {
      const respuesta = {
        mensaje: 'Contacto actualizado.',
        telefono: '80955501777',
        correo: 'carlos@example.com',
        canalesInvalidados: ['TELEFONO' as never],
      };
      vi.spyOn(otpService, 'actualizarContacto').mockResolvedValue(respuesta);

      const result = await controller.updateContact(mockUser, {
        telefono: '80955501777',
      });

      expect(otpService.actualizarContacto).toHaveBeenCalledWith('user-uuid-1', {
        telefono: '80955501777',
      });
      expect(result).toEqual(respuesta);
    });
  });
});
