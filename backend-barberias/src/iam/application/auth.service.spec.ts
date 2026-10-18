import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service.js';
import { ConflictException, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwtService: any;

  beforeEach(() => {
    mockPrisma = {
      usuario: {
        findUnique: vi.fn(),
        create: vi.fn(),
        // Regla 1.6 (H69): el reseteo escribe el hash nuevo.
        update: vi.fn(),
      },
      rol: {
        findUnique: vi.fn(),
      },
      usuarioRol: {
        create: vi.fn(),
      },
      // Regla 1.6 (H69): recuperación de contraseña.
      tokenRecuperacion: {
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        findUnique: vi.fn(),
      },
      notificacion: {
        create: vi.fn(),
      },
      auditoria: {
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => {
        return cb(mockPrisma);
      }),
    };

    mockJwtService = {
      sign: vi.fn().mockReturnValue('signed-jwt-token'),
      signAsync: vi.fn().mockResolvedValue('signed-jwt-token'),
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

    it('E1-04: un rol de ámbito BARBERIA sin barberiaId debe fallar con error de dominio', async () => {
      // Catálogo mal configurado: CLIENTE declarado de ámbito BARBERIA, y el
      // registro no tiene barbería a la que vincularlo.
      mockPrisma.rol.findUnique.mockResolvedValue({
        id: 'rol-cliente-id',
        nombre: 'CLIENTE',
        ambito: 'BARBERIA',
      });
      mockPrisma.usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.register({
          nombreCompleto: 'Juan Pérez',
          correo: 'juan@example.com',
          telefono: '+584141234567',
          password: 'Password123',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockPrisma.usuarioRol.create).not.toHaveBeenCalled();
    });

    it('E1-04: un rol de ámbito GLOBAL sin barberiaId es válido', async () => {
      mockPrisma.rol.findUnique.mockResolvedValue({
        id: 'rol-cliente-id',
        nombre: 'CLIENTE',
        ambito: 'GLOBAL',
      });
      mockPrisma.usuario.findUnique.mockResolvedValue(null);
      mockPrisma.usuario.create.mockResolvedValue({
        id: 'new-user-id',
        nombreCompleto: 'Juan Pérez',
        correo: 'juan@example.com',
        telefono: '+584141234567',
        cedula: null,
        passwordHash: 'hashed',
        estadoCuenta: 'ACTIVO',
        creadoAt: new Date(),
      });
      mockPrisma.usuarioRol.create.mockResolvedValue({ id: 'ur-1' });

      const result = await service.register({
        nombreCompleto: 'Juan Pérez',
        correo: 'juan@example.com',
        telefono: '+584141234567',
        password: 'Password123',
      });

      expect(result.id).toBe('new-user-id');
      expect(mockPrisma.usuarioRol.create).toHaveBeenCalledWith({
        data: { usuarioId: 'new-user-id', rolId: 'rol-cliente-id', barberiaId: null },
      });
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

    it('debe lanzar UnauthorizedException con mensaje descriptivo si la cuenta está SUSPENDIDA (IAM-01)', async () => {
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
      ).rejects.toThrow('Su cuenta se encuentra suspendida. Contacte al administrador.');
    });

    it('debe lanzar mensaje genérico si la contraseña es incorrecta incluso si la cuenta está SUSPENDIDA', async () => {
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
          password: 'PasswordIncorrecta',
        }),
      ).rejects.toThrow('Credenciales inválidas.');
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

  /**
   * Regla 1.6 · H69. La recuperación de contraseña estaba implementada y
   * justificada, pero la única comprobación era el guion manual
   * `test/manual/sec01-recovery.ts`: ningún test ejecutaba los endpoints.
   *
   * Aquí se fija el flujo completo —generación del token, «envío» simulado y
   * reseteo— y, tan importante como eso, lo que NO debe pasar: un correo
   * desconocido no puede distinguirse de uno real, y un token usado, vencido o
   * de una cuenta suspendida no cambia ninguna contraseña.
   */
  describe('forgotPassword (regla 1.6 · H69)', () => {
    const RESPUESTA_GENERICA =
      'Si el correo electrónico está registrado, recibirás un enlace con instrucciones para restablecer tu contraseña.';

    function prepararEnvio() {
      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        correo: 'juan@example.com',
        estadoCuenta: 'ACTIVO',
      });
      mockPrisma.tokenRecuperacion.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tokenRecuperacion.create.mockResolvedValue({ id: 'token-1' });
      mockPrisma.notificacion.create.mockResolvedValue({ id: 'notif-1' });
    }

    it('genera un token de un solo uso, lo guarda hasheado y encola el correo', async () => {
      prepararEnvio();

      const antes = Date.now();
      const respuesta = await service.forgotPassword({ correo: '  Juan@Example.com ' });
      const despues = Date.now();

      // La respuesta no revela si el correo existe. `debugToken` aparece porque
      // la suite no corre en production: es la única forma de ver el token en
      // claro, igual que lo vería el usuario en el correo.
      expect(respuesta.message).toBe(RESPUESTA_GENERICA);
      expect(respuesta.debugToken).toMatch(/^[a-f0-9]{64}$/);

      // El correo se normaliza antes de buscar (el usuario pudo teclearlo con
      // mayúsculas o espacios).
      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { correo: 'juan@example.com' },
      });

      // 1. Los tokens pendientes anteriores se queman: solo vale el último.
      expect(mockPrisma.tokenRecuperacion.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 'user-1', usado: false },
        data: { usado: true },
      });

      // 2. En la base queda el SHA-256, nunca el token en claro.
      const creado = mockPrisma.tokenRecuperacion.create.mock.calls[0][0].data;
      expect(creado.usuarioId).toBe('user-1');
      expect(creado.usado).toBe(false);
      expect(creado.tokenHash).toBe(
        crypto.createHash('sha256').update(respuesta.debugToken!).digest('hex'),
      );
      expect(creado.tokenHash).not.toBe(respuesta.debugToken);

      // 3. Quince minutos de vida, ni uno más.
      expect(creado.expiraAt.getTime()).toBeGreaterThanOrEqual(antes + 15 * 60 * 1000 - 1000);
      expect(creado.expiraAt.getTime()).toBeLessThanOrEqual(despues + 15 * 60 * 1000 + 1000);

      // 4. «Envío» simulado: la notificación EMAIL queda en cola con el token.
      expect(mockPrisma.notificacion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          usuarioId: 'user-1',
          canal: 'EMAIL',
          tipo: 'RECUPERACION_PASSWORD',
          estado: 'PENDIENTE',
          contenido: expect.stringContaining(respuesta.debugToken!),
        }),
      });
    });

    it('un correo desconocido recibe la MISMA respuesta y no crea token ni notificación', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue(null);

      const respuesta = await service.forgotPassword({ correo: 'nadie@example.com' });

      // Mismo cuerpo exacto que con un correo real: no hay enumeración.
      expect(respuesta).toEqual({ message: RESPUESTA_GENERICA });
      expect(mockPrisma.tokenRecuperacion.create).not.toHaveBeenCalled();
      expect(mockPrisma.notificacion.create).not.toHaveBeenCalled();
    });

    it('una cuenta SUSPENDIDO tampoco recibe token ni correo', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        correo: 'suspendido@example.com',
        estadoCuenta: 'SUSPENDIDO',
      });

      const respuesta = await service.forgotPassword({ correo: 'suspendido@example.com' });

      expect(respuesta).toEqual({ message: RESPUESTA_GENERICA });
      expect(mockPrisma.tokenRecuperacion.create).not.toHaveBeenCalled();
      expect(mockPrisma.notificacion.create).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword (regla 1.6 · H69)', () => {
    const TOKEN = 'a'.repeat(64);
    const HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

    function tokenVigente(extra: Record<string, unknown> = {}) {
      return {
        id: 'token-1',
        usuarioId: 'user-1',
        tokenHash: HASH,
        usado: false,
        expiraAt: new Date(Date.now() + 10 * 60 * 1000),
        usuario: { id: 'user-1', estadoCuenta: 'ACTIVO' },
        ...extra,
      };
    }

    function prepararReseteo(registro: unknown) {
      mockPrisma.tokenRecuperacion.findUnique.mockResolvedValue(registro);
      mockPrisma.usuario.update.mockResolvedValue({ id: 'user-1' });
      mockPrisma.tokenRecuperacion.update.mockResolvedValue({ id: 'token-1' });
      mockPrisma.auditoria.create.mockResolvedValue({ id: 'aud-1' });
    }

    it('con un token vigente cambia la contraseña, lo quema y audita', async () => {
      prepararReseteo(tokenVigente());

      const respuesta = await service.resetPassword({
        token: ` ${TOKEN} `,
        newPassword: 'NuevaClave123',
      });

      expect(respuesta.message).toMatch(/restablecida exitosamente/);

      // El token llega en claro y se busca por su hash: el crudo no se guarda.
      expect(mockPrisma.tokenRecuperacion.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: HASH },
        include: { usuario: true },
      });

      // La contraseña nueva se guarda hasheada y se puede verificar.
      const escrito = mockPrisma.usuario.update.mock.calls[0][0];
      expect(escrito.where).toEqual({ id: 'user-1' });
      expect(escrito.data.passwordHash).not.toBe('NuevaClave123');
      expect(await bcrypt.compare('NuevaClave123', escrito.data.passwordHash)).toBe(true);

      // El token queda consumido y el cambio deja rastro de auditoría.
      expect(mockPrisma.tokenRecuperacion.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { usado: true },
      });
      expect(mockPrisma.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          usuarioId: 'user-1',
          accion: 'RECUPERACION_PASSWORD_EXITOSA',
        }),
      });

      // Contraseña, token y auditoría van en la MISMA transacción.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('un token desconocido responde 400 y no escribe nada', async () => {
      prepararReseteo(null);

      await expect(
        service.resetPassword({ token: TOKEN, newPassword: 'NuevaClave123' }),
      ).rejects.toThrow(/inválido o ya ha sido utilizado/);

      expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('el token es de un solo uso: con `usado` ya no cambia la contraseña', async () => {
      prepararReseteo(tokenVigente({ usado: true }));

      await expect(
        service.resetPassword({ token: TOKEN, newPassword: 'NuevaClave123' }),
      ).rejects.toThrow(/inválido o ya ha sido utilizado/);

      expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
    });

    it('un token vencido responde 400 aunque nadie lo haya usado', async () => {
      prepararReseteo(tokenVigente({ expiraAt: new Date(Date.now() - 60 * 1000) }));

      await expect(
        service.resetPassword({ token: TOKEN, newPassword: 'NuevaClave123' }),
      ).rejects.toThrow(/ha expirado/);

      expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
    });

    it('una cuenta no ACTIVO no puede restablecer la contraseña', async () => {
      prepararReseteo(tokenVigente({ usuario: { id: 'user-1', estadoCuenta: 'SUSPENDIDO' } }));

      await expect(
        service.resetPassword({ token: TOKEN, newPassword: 'NuevaClave123' }),
      ).rejects.toThrow(/no está activa/);

      expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
    });

    /** El flujo real, de punta a punta: olvidé → token «enviado» → reseteo → login. */
    it('el flujo completo deja entrar con la contraseña nueva', async () => {
      // 1. Olvidé mi contraseña.
      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        correo: 'juan@example.com',
        estadoCuenta: 'ACTIVO',
      });
      mockPrisma.tokenRecuperacion.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.tokenRecuperacion.create.mockResolvedValue({ id: 'token-1' });
      mockPrisma.notificacion.create.mockResolvedValue({ id: 'notif-1' });

      const { debugToken } = await service.forgotPassword({ correo: 'juan@example.com' });
      const hashGuardado = mockPrisma.tokenRecuperacion.create.mock.calls[0][0].data.tokenHash;
      expect(hashGuardado).toBe(
        crypto.createHash('sha256').update(debugToken!).digest('hex'),
      );

      // 2. Reseteo con el token que «llegó» por correo.
      prepararReseteo(tokenVigente({ tokenHash: hashGuardado }));
      await service.resetPassword({ token: debugToken!, newPassword: 'NuevaClave123' });
      const hashNuevo = mockPrisma.usuario.update.mock.calls[0][0].data.passwordHash;

      // 3. Login con la contraseña nueva.
      mockPrisma.usuario.findUnique.mockResolvedValue({
        id: 'user-1',
        correo: 'juan@example.com',
        estadoCuenta: 'ACTIVO',
        passwordHash: hashNuevo,
        usuarioRoles: [{ rol: { nombre: 'CLIENTE' } }],
      });

      const sesion = await service.login({
        correo: 'juan@example.com',
        password: 'NuevaClave123',
      });

      expect(sesion.accessToken).toBe('signed-jwt-token');
      expect(sesion.usuario.id).toBe('user-1');
    });
  });
});
