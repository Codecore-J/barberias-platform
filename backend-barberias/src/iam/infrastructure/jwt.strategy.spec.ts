import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { JwtPayload } from '../domain/jwt.interface.js';

const USUARIO_ID = '11111111-1111-4111-8111-111111111111';
const SEDE_A = '22222222-2222-4222-8222-222222222222';

function usuarioDb(overrides: Record<string, unknown> = {}) {
  return {
    id: USUARIO_ID,
    correo: 'miembro@test.com',
    estadoCuenta: 'ACTIVO',
    tokenVersion: 0,
    telefonoVerificado: true,
    correoVerificado: true,
    usuarioRoles: [
      {
        barberiaId: SEDE_A,
        rol: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
      },
    ],
    ...overrides,
  };
}

function payloadDe(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: USUARIO_ID,
    correo: 'miembro@test.com',
    roles: ['ADMIN_BARBERIA'],
    tv: 0,
    ...overrides,
  };
}

describe('JwtStrategy (I-01 · D24)', () => {
  let strategy: JwtStrategy;
  let prisma: { usuario: { findUnique: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    prisma = { usuario: { findUnique: vi.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtStrategy, { provide: PrismaService, useValue: prisma }],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('carga los roles ACTIVOS de la base, no los del token', async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuarioDb());

    // El token venía con CLIENTE (firmado antes del cambio de rol): manda la BD.
    const user = await strategy.validate(payloadDe({ roles: ['CLIENTE'] }));

    expect(user.roles).toEqual(['ADMIN_BARBERIA']);
    expect(user.rolesDetallados).toEqual([
      { nombre: 'ADMIN_BARBERIA', barberiaId: SEDE_A, ambito: 'BARBERIA' },
    ]);
  });

  it('I-01 · sin vínculos ACTIVOS no devuelve los roles del token (falla cerrada)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuarioDb({ usuarioRoles: [] }));

    const user = await strategy.validate(payloadDe({ roles: ['ADMIN_BARBERIA'] }));

    expect(user.roles).toEqual([]);
    expect(user.rolesDetallados).toEqual([]);
  });

  it('I-01 · solo lee vínculos ACTIVOS: nunca pregunta por los INACTIVO', async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuarioDb());

    await strategy.validate(payloadDe());

    const consulta = prisma.usuario.findUnique.mock.calls[0][0];
    expect(consulta.select.usuarioRoles.where).toEqual({ estado: 'ACTIVO' });
  });

  it('rechaza 401 si la cuenta dejó de estar ACTIVA', async () => {
    prisma.usuario.findUnique.mockResolvedValue(
      usuarioDb({ estadoCuenta: 'SUSPENDIDO' }),
    );

    await expect(strategy.validate(payloadDe())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza 401 si el tv del token no es la versión vigente', async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuarioDb({ tokenVersion: 1 }));

    await expect(strategy.validate(payloadDe({ tv: 0 }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza 401 si el usuario ya no existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(payloadDe())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('un token sin tv se lee como versión 0 (compatibilidad pre-migración)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuarioDb({ tokenVersion: 0 }));

    const user = await strategy.validate(payloadDe({ tv: undefined }));

    expect(user.roles).toEqual(['ADMIN_BARBERIA']);
  });
});
