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
    usuario: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
  };

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
});
