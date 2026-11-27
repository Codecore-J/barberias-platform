import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { UsuariosPlataformaService } from '../src/iam/application/usuarios-plataforma.service.js';
import { PlataformaSedesController } from '../src/iam/infrastructure/plataforma-sedes.controller.js';

/**
 * F7 / T-73 · transferir la administración de una sede antes de eliminar al
 * dueño actual.
 *
 * El trigger de PostgreSQL solo permite UN `ADMIN_BARBERIA` ACTIVO por sede y
 * cuenta activa, así que la transferencia degrada primero al anterior y después
 * promueve al nuevo, dentro de la misma transacción.
 *
 * En rojo falla porque el controlador no existe (404) y el servicio no tiene
 * `transferirAdministracionSede`.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const ADMIN_ANTERIOR = '22222222-2222-4222-8222-222222222222';
const NUEVO_ADMIN = '33333333-3333-4333-8333-333333333333';
const SOLICITANTE = '44444444-4444-4444-8444-444444444444';

interface TxFalso {
  barberia: { findUnique: ReturnType<typeof vi.fn> };
  usuario: { findUnique: ReturnType<typeof vi.fn> };
  rol: { findUnique: ReturnType<typeof vi.fn> };
  usuarioRol: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

/** `vinculoNuevo` permite simular los tres casos del nuevo administrador. */
function txFalso(vinculoNuevo: unknown = null): TxFalso {
  return {
    barberia: {
      findUnique: vi.fn(async () => ({ id: SEDE, nombre: 'Sede Centro' })),
    },
    usuario: {
      findUnique: vi.fn(async () => ({
        id: NUEVO_ADMIN,
        correo: 'nuevo@demo.com',
        nombreCompleto: 'Nuevo Dueño',
        estadoCuenta: 'ACTIVO',
      })),
    },
    rol: {
      findUnique: vi.fn(async () => ({ id: 'rol-admin-sede' })),
    },
    usuarioRol: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Consulta del vínculo del NUEVO administrador: por su usuarioId.
        if (where.usuarioId === NUEVO_ADMIN) return vinculoNuevo;
        // Consulta del administrador que ocupa la sede: sin `usuarioId`.
        return {
          id: 'vinculo-anterior',
          usuarioId: ADMIN_ANTERIOR,
          estado: 'ACTIVO',
          usuario: {
            id: ADMIN_ANTERIOR,
            correo: 'anterior@demo.com',
            nombreCompleto: 'Dueño Anterior',
          },
        };
      }),
      update: vi.fn(async () => ({ id: 'vinculo-anterior', estado: 'INACTIVO' })),
      create: vi.fn(async () => ({ id: 'vinculo-nuevo' })),
    },
  };
}

function preparar(tx = txFalso()) {
  const prisma = {
    $transaction: vi.fn(async (cb: (cliente: typeof tx) => unknown) => cb(tx)),
  };
  const auditoria = { registrarEvento: vi.fn(async () => ({ id: 'aud-1' })) };

  return {
    service: new UsuariosPlataformaService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
    ),
    prisma,
    tx,
    auditoria,
  };
}

describe('T-73 · transferir administración de sede', () => {
  it('declara PATCH /plataforma/sedes/:sedeId/transferir-admin', () => {
    const proto = PlataformaSedesController.prototype as unknown as Record<string, unknown>;
    const rutas = Object.getOwnPropertyNames(proto)
      .map((nombre) => proto[nombre])
      .filter((c): c is (...args: never[]) => unknown => typeof c === 'function')
      .map((c) => ({
        ruta: Reflect.getMetadata(PATH_METADATA, c) as string | undefined,
        metodo: Reflect.getMetadata(METHOD_METADATA, c) as number | undefined,
      }));

    expect(rutas).toEqual(
      expect.arrayContaining([
        { ruta: ':sedeId/transferir-admin', metodo: RequestMethod.PATCH },
      ]),
    );
  });

  it('degrada al anterior y promueve al nuevo en la misma transacción', async () => {
    const { service, tx, auditoria } = preparar();

    const resultado = await service.transferirAdministracionSede(
      SEDE,
      { nuevoAdminId: NUEVO_ADMIN },
      { id: SOLICITANTE, correo: 'admin@demo.com' } as never,
    );

    expect(tx.usuarioRol.update).toHaveBeenCalledWith({
      where: { id: 'vinculo-anterior' },
      data: { estado: 'INACTIVO' },
    });
    expect(tx.usuarioRol.create).toHaveBeenCalledWith({
      data: { usuarioId: NUEVO_ADMIN, rolId: 'rol-admin-sede', barberiaId: SEDE },
    });
    expect(resultado).toMatchObject({
      sedeId: SEDE,
      adminAnteriorId: ADMIN_ANTERIOR,
      nuevoAdminId: NUEVO_ADMIN,
    });
    expect(auditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: SOLICITANTE,
        accion: 'ADMIN_TRANSFERIDO',
        entidad: 'usuario_roles',
        barberiaId: SEDE,
        contexto: expect.objectContaining({
          adminAnteriorId: ADMIN_ANTERIOR,
          nuevoAdminId: NUEVO_ADMIN,
        }),
      }),
      tx,
    );
  });

  it('si el nuevo ya tiene un ADMIN_BARBERIA inactivo, lo reactiva', async () => {
    const { service, tx } = preparar(
      txFalso({ id: 'vinculo-nuevo-inactivo', estado: 'INACTIVO' }),
    );

    await service.transferirAdministracionSede(
      SEDE,
      { nuevoAdminId: NUEVO_ADMIN },
      { id: SOLICITANTE } as never,
    );

    expect(tx.usuarioRol.update).toHaveBeenCalledWith({
      where: { id: 'vinculo-nuevo-inactivo' },
      data: { estado: 'ACTIVO' },
    });
    expect(tx.usuarioRol.create).not.toHaveBeenCalled();
  });

  it('un nuevo administrador que ya está ACTIVO responde 409 YA_ES_ADMIN_SEDE', async () => {
    const { service, tx } = preparar(
      txFalso({ id: 'vinculo-nuevo-activo', estado: 'ACTIVO' }),
    );

    const error = await service
      .transferirAdministracionSede(SEDE, { nuevoAdminId: NUEVO_ADMIN }, { id: SOLICITANTE } as never)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, response: { codigo: 'YA_ES_ADMIN_SEDE' } });
    expect(tx.usuarioRol.update).not.toHaveBeenCalled();
  });

  it('una sede sin administrador responde 409 SEDE_SIN_ADMIN', async () => {
    const { service, tx } = preparar();
    tx.usuarioRol.findFirst.mockResolvedValue(null);

    const error = await service
      .transferirAdministracionSede(SEDE, { nuevoAdminId: NUEVO_ADMIN }, { id: SOLICITANTE } as never)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, response: { codigo: 'SEDE_SIN_ADMIN' } });
  });

  it('una cuenta suspendida responde 409 CUENTA_NO_ACTIVA y no transfiere', async () => {
    const { service, tx } = preparar();
    tx.usuario.findUnique.mockResolvedValue({
      id: NUEVO_ADMIN,
      correo: 'nuevo@demo.com',
      nombreCompleto: 'Nuevo Dueño',
      estadoCuenta: 'SUSPENDIDO',
    });

    const error = await service
      .transferirAdministracionSede(SEDE, { nuevoAdminId: NUEVO_ADMIN }, { id: SOLICITANTE } as never)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, response: { codigo: 'CUENTA_NO_ACTIVA' } });
    expect(tx.usuarioRol.update).not.toHaveBeenCalled();
  });

  it('transferir al mismo dueño responde 409 TRANSFERENCIA_AL_MISMO_ADMIN', async () => {
    const { service } = preparar();

    const error = await service
      .transferirAdministracionSede(
        SEDE,
        { nuevoAdminId: ADMIN_ANTERIOR },
        { id: SOLICITANTE } as never,
      )
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: { codigo: 'TRANSFERENCIA_AL_MISMO_ADMIN' },
    });
  });
});
