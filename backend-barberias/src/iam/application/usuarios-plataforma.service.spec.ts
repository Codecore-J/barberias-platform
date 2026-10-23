import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosPlataformaService } from './usuarios-plataforma.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';

/**
 * E4-03/5 · D09/D24 · suspensión y reactivación de la CUENTA global.
 *
 * Lo que se fija aquí: el motivo es obligatorio (422), suspender sube
 * `token_version` (sesiones cerradas) y reactivar NO lo baja (los tokens viejos
 * siguen inválidos), y todo queda auditado con el valor anterior y el nuevo.
 */
describe('UsuariosPlataformaService (E4-03/5 · D09/D24)', () => {
  const global: UsuarioAutenticado = {
    id: 'uuid-global',
    correo: 'global@plataforma.test',
    roles: ['ADMINISTRADOR'],
    rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
  };

  const mockPrisma = {
    usuario: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    usuarioRol: { create: vi.fn() },
    rol: { findUnique: vi.fn() },
    barberia: { findUnique: vi.fn() },
    auditoria: { findMany: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
  };

  const adminSede = { id: 'rol-admin-sede', nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' };
  const rolCliente = { id: 'rol-cliente', nombre: 'CLIENTE', ambito: 'GLOBAL' };
  const rolBarbero = { id: 'rol-barbero', nombre: 'BARBERO', ambito: 'BARBERIA' };

  const mockAuditoria = { registrarEvento: vi.fn() };

  let service: UsuariosPlataformaService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsuariosPlataformaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditoriaService, useValue: mockAuditoria },
      ],
    }).compile();

    service = module.get<UsuariosPlataformaService>(UsuariosPlataformaService);
    mockAuditoria.registrarEvento.mockResolvedValue({ id: 'uuid-auditoria' });
  });

  const cuenta = (extra: Record<string, unknown> = {}) => ({
    id: 'uuid-objetivo',
    correo: 'objetivo@test.com',
    estadoCuenta: 'ACTIVO',
    tokenVersion: 0,
    ...extra,
  });

  it('ROJO: sin motivo → 422 MOTIVO_REQUERIDO y no se toca la cuenta', async () => {
    await expect(
      service.cambiarEstado('uuid-objetivo', global, { estadoCuenta: 'SUSPENDIDO' }),
    ).rejects.toMatchObject({ response: { codigo: 'MOTIVO_REQUERIDO', statusCode: 422 } });

    expect(mockPrisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
  });

  it('ROJO: un motivo en blanco tampoco vale (422)', async () => {
    await expect(
      service.cambiarEstado('uuid-objetivo', global, {
        estadoCuenta: 'SUSPENDIDO',
        motivo: '   ',
      }),
    ).rejects.toMatchObject({ response: { codigo: 'MOTIVO_REQUERIDO', statusCode: 422 } });
  });

  it('ROJO: cuenta inexistente → 404', async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(null);

    await expect(
      service.cambiarEstado('uuid-objetivo', global, {
        estadoCuenta: 'SUSPENDIDO',
        motivo: 'Abuso reiterado',
      }),
    ).rejects.toThrowError(/Usuario no encontrado/);
  });

  it('ROJO: suspender una cuenta ya suspendida → 409 ESTADO_INVALIDO', async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(cuenta({ estadoCuenta: 'SUSPENDIDO' }));

    await expect(
      service.cambiarEstado('uuid-objetivo', global, {
        estadoCuenta: 'SUSPENDIDO',
        motivo: 'Abuso reiterado',
      }),
    ).rejects.toMatchObject({ response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 } });

    expect(mockPrisma.usuario.update).not.toHaveBeenCalled();
  });

  it('VERDE: suspender sube token_version (cierra sesiones) y audita anterior/nuevo', async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(cuenta());
    mockPrisma.usuario.update.mockResolvedValue({ id: 'uuid-objetivo' });

    const resultado = await service.cambiarEstado('uuid-objetivo', global, {
      estadoCuenta: 'SUSPENDIDO',
      motivo: 'Uso indebido del catálogo',
    });

    expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 'uuid-objetivo' },
      data: { estadoCuenta: 'SUSPENDIDO', tokenVersion: 1 },
    });
    expect(resultado).toEqual({
      id: 'uuid-objetivo',
      estadoCuenta: 'SUSPENDIDO',
      tokenVersion: 1,
      sesionesCerradas: true,
    });

    expect(mockAuditoria.registrarEvento).toHaveBeenCalledTimes(1);
    const [evento, tx] = mockAuditoria.registrarEvento.mock.calls[0];
    expect(evento).toMatchObject({
      usuarioId: 'uuid-global',
      accion: 'CUENTA_SUSPENDIDA',
      entidad: 'usuarios',
      entidadId: 'uuid-objetivo',
      contexto: {
        motivo: 'Uso indebido del catálogo',
        anterior: { estadoCuenta: 'ACTIVO', tokenVersion: 0 },
        nuevo: { estadoCuenta: 'SUSPENDIDO', tokenVersion: 1 },
      },
    });
    // D28: el evento viaja dentro de la MISMA transacción que el cambio.
    expect(tx).toBeDefined();
  });

  it('VERDE: reactivar devuelve a ACTIVO sin tocar token_version (los viejos siguen fuera)', async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(
      cuenta({ estadoCuenta: 'SUSPENDIDO', tokenVersion: 1 }),
    );
    mockPrisma.usuario.update.mockResolvedValue({ id: 'uuid-objetivo' });

    const resultado = await service.cambiarEstado('uuid-objetivo', global, {
      estadoCuenta: 'ACTIVO',
      motivo: 'Se aclaró el malentendido',
    });

    expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 'uuid-objetivo' },
      data: { estadoCuenta: 'ACTIVO', tokenVersion: 1 },
    });
    expect(resultado).toMatchObject({
      estadoCuenta: 'ACTIVO',
      tokenVersion: 1,
      sesionesCerradas: false,
    });

    const [evento] = mockAuditoria.registrarEvento.mock.calls[0];
    expect(evento).toMatchObject({
      accion: 'CUENTA_REACTIVADA',
      contexto: {
        anterior: { estadoCuenta: 'SUSPENDIDO', tokenVersion: 1 },
        nuevo: { estadoCuenta: 'ACTIVO', tokenVersion: 1 },
      },
    });
  });

  describe('obtenerTodosLosUsuarios', () => {
    const fila = (extra: Record<string, unknown> = {}) => ({
      id: 'uuid-1',
      nombreCompleto: 'Ana Pérez',
      correo: 'ana@test.com',
      telefono: '8090000000',
      estadoCuenta: 'ACTIVO',
      creadoAt: new Date('2026-10-02T10:00:00.000Z'),
      usuarioRoles: [{ rol: { nombre: 'ADMIN_BARBERIA' } }, { rol: { nombre: 'CLIENTE' } }],
      ...extra,
    });

    it('VERDE: ordena por fecha de registro DESC y pide solo los campos del DTO', async () => {
      mockPrisma.usuario.findMany.mockResolvedValue([fila()]);

      await service.obtenerTodosLosUsuarios();

      expect(mockPrisma.usuario.findMany).toHaveBeenCalledWith({
        orderBy: { creadoAt: 'desc' },
        select: {
          id: true,
          nombreCompleto: true,
          correo: true,
          telefono: true,
          estadoCuenta: true,
          creadoAt: true,
          usuarioRoles: { select: { rol: { select: { nombre: true } } } },
        },
      });
    });

    it('VERDE: aplana usuario_roles a los nombres de rol, sin repetir', async () => {
      mockPrisma.usuario.findMany.mockResolvedValue([
        fila({
          usuarioRoles: [
            { rol: { nombre: 'ADMIN_BARBERIA' } },
            { rol: { nombre: 'ADMIN_BARBERIA' } },
            { rol: { nombre: 'CLIENTE' } },
          ],
        }),
      ]);

      const [usuario] = await service.obtenerTodosLosUsuarios();

      expect(usuario.roles).toEqual(['ADMIN_BARBERIA', 'CLIENTE']);
    });

    it('VERDE: mapea creado_at a fechaRegistro y no cuela datos sensibles', async () => {
      mockPrisma.usuario.findMany.mockResolvedValue([fila()]);

      const [usuario] = await service.obtenerTodosLosUsuarios();

      expect(usuario).toEqual({
        id: 'uuid-1',
        nombreCompleto: 'Ana Pérez',
        correo: 'ana@test.com',
        telefono: '8090000000',
        estadoCuenta: 'ACTIVO',
        fechaRegistro: new Date('2026-10-02T10:00:00.000Z'),
        roles: ['ADMIN_BARBERIA', 'CLIENTE'],
      });
      expect(Object.keys(usuario).sort()).toEqual(
        [
          'id',
          'nombreCompleto',
          'correo',
          'telefono',
          'estadoCuenta',
          'fechaRegistro',
          'roles',
        ].sort(),
      );
    });
  });

  describe('crearUsuario', () => {
    const dtoBase = {
      nombreCompleto: 'Ana Pérez',
      correo: 'ana@test.com',
      password: 'Secreta123',
      telefono: '8090000000',
      rolNombre: 'CLIENTE' as const,
    };

    const usuarioCreado = {
      id: 'uuid-nuevo',
      nombreCompleto: 'Ana Pérez',
      correo: 'ana@test.com',
      telefono: '8090000000',
      estadoCuenta: 'ACTIVO',
      creadoAt: new Date('2026-10-23T10:00:00.000Z'),
    };

    it('ROJO: correo ya registrado → 409 CORREO_YA_REGISTRADO y no crea nada', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue({
        correo: dtoBase.correo,
        telefono: '8091111111',
        cedula: null,
      });

      await expect(service.crearUsuario(dtoBase, global)).rejects.toMatchObject({
        response: { codigo: 'CORREO_YA_REGISTRADO', statusCode: 409 },
      });

      expect(mockPrisma.usuario.create).not.toHaveBeenCalled();
      expect(mockPrisma.usuarioRol.create).not.toHaveBeenCalled();
    });

    it('ROJO: cédula ya registrada → 409 CEDULA_YA_REGISTRADA', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue({
        correo: 'otra@test.com',
        telefono: '8091111111',
        cedula: '00112345678',
      });

      await expect(
        service.crearUsuario({ ...dtoBase, cedula: '00112345678' }, global),
      ).rejects.toMatchObject({
        response: { codigo: 'CEDULA_YA_REGISTRADA', statusCode: 409 },
      });
    });

    it('ROJO: teléfono ya registrado → 409 TELEFONO_YA_REGISTRADO', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue({
        correo: 'otra@test.com',
        telefono: dtoBase.telefono,
        cedula: null,
      });

      await expect(service.crearUsuario(dtoBase, global)).rejects.toMatchObject({
        response: { codigo: 'TELEFONO_YA_REGISTRADO', statusCode: 409 },
      });
    });

    it('ROJO: un rol de sede sin barbería → 422 BARBERIA_REQUERIDA', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      mockPrisma.rol.findUnique.mockResolvedValue(rolBarbero);

      await expect(
        service.crearUsuario({ ...dtoBase, rolNombre: 'BARBERO' }, global),
      ).rejects.toMatchObject({
        response: { codigo: 'BARBERIA_REQUERIDA', statusCode: 422 },
      });

      expect(mockPrisma.usuario.create).not.toHaveBeenCalled();
    });

    it('ROJO: un rol GLOBAL con barbería → 422 BARBERIA_NO_APLICA', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      mockPrisma.rol.findUnique.mockResolvedValue(rolCliente);

      await expect(
        service.crearUsuario({ ...dtoBase, barberiaId: 'uuid-barberia' }, global),
      ).rejects.toMatchObject({
        response: { codigo: 'BARBERIA_NO_APLICA', statusCode: 422 },
      });
    });

    it('ROJO: barbería inexistente → 404', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      mockPrisma.rol.findUnique.mockResolvedValue(adminSede);
      mockPrisma.barberia.findUnique.mockResolvedValue(null);

      await expect(
        service.crearUsuario(
          { ...dtoBase, rolNombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia' },
          global,
        ),
      ).rejects.toThrowError(/Barbería no encontrada/);
    });

    it('VERDE: crea la cuenta ACTIVA, hashea, vincula el rol de sede y audita', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      mockPrisma.rol.findUnique.mockResolvedValue(adminSede);
      mockPrisma.barberia.findUnique.mockResolvedValue({ id: 'uuid-barberia' });
      mockPrisma.usuario.create.mockResolvedValue(usuarioCreado);
      mockPrisma.usuarioRol.create.mockResolvedValue({ id: 'uuid-usuario-rol' });

      const resultado = await service.crearUsuario(
        { ...dtoBase, rolNombre: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia' },
        global,
      );

      const [argumento] = mockPrisma.usuario.create.mock.calls[0];
      expect(argumento.data).toMatchObject({
        nombreCompleto: 'Ana Pérez',
        correo: 'ana@test.com',
        telefono: '8090000000',
        cedula: null,
        estadoCuenta: 'ACTIVO',
      });
      // Mismo algoritmo y coste que /auth/register: bcrypt, 10 rondas.
      expect(argumento.data.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(argumento.data.passwordHash).not.toBe('Secreta123');

      expect(mockPrisma.usuarioRol.create).toHaveBeenCalledWith({
        data: { usuarioId: 'uuid-nuevo', rolId: 'rol-admin-sede', barberiaId: 'uuid-barberia' },
      });

      const [evento, tx] = mockAuditoria.registrarEvento.mock.calls[0];
      expect(evento).toMatchObject({
        usuarioId: 'uuid-global',
        accion: 'USUARIO_CREADO',
        entidad: 'usuarios',
        entidadId: 'uuid-nuevo',
        contexto: { rol: 'ADMIN_BARBERIA', barberiaId: 'uuid-barberia' },
      });
      // D28: el rastro viaja en la MISMA transacción que el alta.
      expect(tx).toBeDefined();

      expect(resultado).toEqual({
        id: 'uuid-nuevo',
        nombreCompleto: 'Ana Pérez',
        correo: 'ana@test.com',
        telefono: '8090000000',
        estadoCuenta: 'ACTIVO',
        fechaRegistro: usuarioCreado.creadoAt,
        roles: ['ADMIN_BARBERIA'],
      });
      expect(resultado).not.toHaveProperty('passwordHash');
    });

    it('VERDE: un CLIENTE se crea sin barbería (rol GLOBAL)', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      mockPrisma.rol.findUnique.mockResolvedValue(rolCliente);
      mockPrisma.usuario.create.mockResolvedValue(usuarioCreado);
      mockPrisma.usuarioRol.create.mockResolvedValue({ id: 'uuid-usuario-rol' });

      await service.crearUsuario(dtoBase, global);

      expect(mockPrisma.usuarioRol.create).toHaveBeenCalledWith({
        data: { usuarioId: 'uuid-nuevo', rolId: 'rol-cliente', barberiaId: null },
      });
      const [evento] = mockAuditoria.registrarEvento.mock.calls[0];
      expect(evento.contexto).toMatchObject({ rol: 'CLIENTE', barberiaId: null });
    });

    it('ROJO: la carrera con otro alta (P2002) también sale como 409', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      mockPrisma.rol.findUnique.mockResolvedValue(rolCliente);
      mockPrisma.usuario.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['correo'] },
      });

      await expect(service.crearUsuario(dtoBase, global)).rejects.toMatchObject({
        response: { codigo: 'CORREO_YA_REGISTRADO', statusCode: 409 },
      });
    });
  });

  describe('obtenerAuditoriaUsuario', () => {
    it('ROJO: cuenta inexistente → 404', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.obtenerAuditoriaUsuario('uuid-fantasma')).rejects.toThrowError(
        /Usuario no encontrado/,
      );
      expect(mockPrisma.auditoria.findMany).not.toHaveBeenCalled();
    });

    it('VERDE: lee el historial de la cuenta en DESC y extrae motivo y actor', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue({ id: 'uuid-objetivo' });
      mockPrisma.auditoria.findMany.mockResolvedValue([
        {
          id: 'aud-2',
          accion: 'CUENTA_SUSPENDIDA',
          entidad: 'usuarios',
          entidadId: 'uuid-objetivo',
          barberiaId: null,
          contexto: {
            motivo: 'Abuso reiterado',
            anterior: { estadoCuenta: 'ACTIVO', tokenVersion: 0 },
            nuevo: { estadoCuenta: 'SUSPENDIDO', tokenVersion: 1 },
            sesionesCerradas: true,
          },
          creadoAt: new Date('2026-10-20T10:00:00.000Z'),
          usuario: {
            id: 'uuid-global',
            nombreCompleto: 'Global',
            correo: 'global@plataforma.test',
          },
        },
        {
          id: 'aud-1',
          accion: 'USUARIO_CREADO',
          entidad: 'usuarios',
          entidadId: 'uuid-objetivo',
          barberiaId: null,
          contexto: { rol: 'CLIENTE' },
          creadoAt: new Date('2026-10-01T10:00:00.000Z'),
          usuario: null,
        },
      ]);

      const eventos = await service.obtenerAuditoriaUsuario('uuid-objetivo');

      expect(mockPrisma.auditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            entidadId: 'uuid-objetivo',
            entidad: { in: ['usuarios', 'Usuario'] },
          },
          orderBy: { creadoAt: 'desc' },
        }),
      );

      expect(eventos[0]).toMatchObject({
        accion: 'CUENTA_SUSPENDIDA',
        motivo: 'Abuso reiterado',
        actor: { correo: 'global@plataforma.test' },
      });
      expect(eventos[0].contexto).toMatchObject({ sesionesCerradas: true });

      // Un evento sin motivo ni actor no inventa datos.
      expect(eventos[1].motivo).toBeNull();
      expect(eventos[1].actor).toBeNull();
    });
  });
});
