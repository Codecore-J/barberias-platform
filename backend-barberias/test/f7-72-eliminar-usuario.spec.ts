import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { TiempoService } from '../src/shared/time/tiempo.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { UsuariosPlataformaService } from '../src/iam/application/usuarios-plataforma.service.js';
import { PlataformaUsuariosController } from '../src/iam/infrastructure/plataforma-usuarios.controller.js';

/**
 * F7 / T-72 · eliminación real de una cuenta.
 *
 * El borrado no es un cambio de estado: destruye la fila de `usuarios` y antes
 * deja el respaldo de T-71, desvincula pagos y cajas con el nombre congelado,
 * cancela las reservas futuras y limpia la auditoría. Todo en una transacción.
 *
 * En rojo falla porque el servicio no tiene `eliminarUsuario` y el controlador
 * no declara `DELETE :id`.
 */
const USUARIO = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SEDE = '33333333-3333-4333-8333-333333333333';
const SEDE_B = '44444444-4444-4444-8444-444444444444';

const cuenta = {
  id: USUARIO,
  nombreCompleto: 'Ana Pérez',
  correo: 'ana@demo.com',
  telefono: '8095550199',
  cedula: '00100000000',
  passwordHash: 'hash-bcrypt',
  estadoCuenta: 'ACTIVO',
  tokenVersion: 3,
  correoVerificado: true,
  telefonoVerificado: false,
  creadoAt: new Date('2026-01-10T12:00:00.000Z'),
};

interface TxFalso {
  usuario: {
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  usuarioRol: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  barberia: { findMany: ReturnType<typeof vi.fn> };
  propuestaHorario: { count: ReturnType<typeof vi.fn> };
  solicitudAntecedente: { count: ReturnType<typeof vi.fn> };
  pago: { updateMany: ReturnType<typeof vi.fn> };
  cierreCaja: { updateMany: ReturnType<typeof vi.fn> };
  reserva: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  respaldoEliminacion: { create: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
}

function txFalso(): TxFalso {
  return {
    usuario: {
      findUnique: vi.fn(async () => cuenta),
      delete: vi.fn(async () => cuenta),
      count: vi.fn(async () => 0),
    },
    usuarioRol: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 2),
    },
    barberia: { findMany: vi.fn(async () => []) },
    propuestaHorario: { count: vi.fn(async () => 0) },
    solicitudAntecedente: { count: vi.fn(async () => 0) },
    pago: { updateMany: vi.fn(async () => ({ count: 0 })) },
    cierreCaja: { updateMany: vi.fn(async () => ({ count: 0 })) },
    reserva: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    respaldoEliminacion: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'respaldo-1',
        ...data,
      })),
    },
    $executeRaw: vi.fn(async () => 1),
  };
}

function preparar(tx: TxFalso = txFalso()) {
  const prisma = {
    $transaction: vi.fn(async (cb: (cliente: TxFalso) => unknown) => cb(tx)),
    usuario: { count: vi.fn(async () => 0) },
  };
  const auditoria = { registrarEvento: vi.fn(async () => ({ id: 'aud-1' })) };
  const tiempo = new TiempoService(() => new Date('2026-11-27T16:00:00.000Z'));

  return {
    service: new UsuariosPlataformaService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
      tiempo,
    ),
    prisma,
    tx,
    auditoria,
  };
}

const CONFIRMAR = { confirmacion: cuenta.correo };

describe('T-72 · eliminar usuario de la plataforma', () => {
  it('declara DELETE /plataforma/usuarios/:id', () => {
    const proto = PlataformaUsuariosController.prototype as unknown as Record<string, unknown>;
    const rutas = Object.getOwnPropertyNames(proto)
      .map((nombre) => proto[nombre])
      .filter((candidato): candidato is (...args: never[]) => unknown => typeof candidato === 'function')
      .map((candidato) => ({
        ruta: Reflect.getMetadata(PATH_METADATA, candidato) as string | undefined,
        metodo: Reflect.getMetadata(METHOD_METADATA, candidato) as number | undefined,
      }));

    expect(rutas).toEqual(
      expect.arrayContaining([{ ruta: ':id', metodo: RequestMethod.DELETE }]),
    );
  });

  it('con la confirmación correcta elimina, respalda y libera el correo', async () => {
    const { service, tx, auditoria } = preparar();
    // Primero `registradoPor`, después `anuladoPor`; el resumen suma ambos.
    tx.pago.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    // Primero `abiertoPor`, después `cerradoPor`.
    tx.cierreCaja.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const resultado = await service.eliminarUsuario(USUARIO, {
      id: ADMIN,
      correo: 'admin@demo.com',
    } as never, CONFIRMAR);

    expect(tx.respaldoEliminacion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ usuarioId: USUARIO, eliminadoPor: ADMIN }),
    });
    const snapshot = tx.respaldoEliminacion.create.mock.calls[0][0].data.snapshot as Record<
      string,
      unknown
    >;
    expect(snapshot).not.toHaveProperty('passwordHash');
    expect(snapshot.correo).toBe(cuenta.correo);
    expect(snapshot.nombreCompleto).toBe(cuenta.nombreCompleto);

    expect(tx.pago.updateMany).toHaveBeenCalledWith({
      where: { registradoPor: USUARIO },
      data: { registradoPor: null, usuarioNombreSnapshot: cuenta.nombreCompleto },
    });
    expect(tx.cierreCaja.updateMany).toHaveBeenCalledWith({
      where: { cerradoPor: USUARIO },
      data: { cerradoPor: null, usuarioNombreSnapshot: cuenta.nombreCompleto },
    });
    expect(tx.usuario.delete).toHaveBeenCalledWith({ where: { id: USUARIO } });
    expect(tx.usuario.count).toHaveBeenCalledWith({ where: { correo: cuenta.correo } });
    expect(resultado).toMatchObject({
      id: USUARIO,
      correo: cuenta.correo,
      correoLiberado: true,
      pagosDesvinculados: 1,
      cajasDesvinculadas: 1,
    });
    expect(auditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: ADMIN,
        accion: 'USUARIO_ELIMINADO',
        entidad: 'usuarios',
        entidadId: USUARIO,
        contexto: expect.objectContaining({ correo: cuenta.correo }),
      }),
      tx,
    );
  });

  it('cancela solo las reservas futuras y desvincula la auditoría con el correo', async () => {
    const { service, tx } = preparar();
    tx.reserva.findMany.mockResolvedValue([
      {
        id: 'reserva-futura',
        fechaCita: new Date('2026-11-28T00:00:00.000Z'),
        horaInicio: new Date('1970-01-01T10:00:00.000Z'),
        barberia: { zonaHoraria: 'America/Santo_Domingo' },
      },
      {
        id: 'reserva-pasada',
        fechaCita: new Date('2026-11-20T00:00:00.000Z'),
        horaInicio: new Date('1970-01-01T10:00:00.000Z'),
        barberia: { zonaHoraria: 'America/Santo_Domingo' },
      },
    ]);

    await service.eliminarUsuario(USUARIO, { id: ADMIN } as never, CONFIRMAR);

    expect(tx.reserva.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['reserva-futura'] } },
      data: expect.objectContaining({
        estado: 'CANCELADA',
        canceladoPorId: ADMIN,
      }),
    });
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('un correo distinto responde 422 CONFIRMACION_INCORRECTA y no borra', async () => {
    const { service, tx } = preparar();

    const error = await service
      .eliminarUsuario(USUARIO, { id: ADMIN } as never, { confirmacion: 'otro@demo.com' })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 422, response: { codigo: 'CONFIRMACION_INCORRECTA' } });
    expect(tx.usuario.delete).not.toHaveBeenCalled();
  });

  it('eliminarse a sí mismo responde 409 AUTOBORRADO_NO_PERMITIDO', async () => {
    const { service, prisma } = preparar();

    const error = await service
      .eliminarUsuario(ADMIN, { id: ADMIN } as never, CONFIRMAR)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, response: { codigo: 'AUTOBORRADO_NO_PERMITIDO' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('el último ADMINISTRADOR global activo responde 409 ULTIMO_ADMINISTRADOR', async () => {
    const { service, tx } = preparar();
    tx.usuarioRol.findMany.mockResolvedValue([
      { id: 'rol-1', estado: 'ACTIVO', rol: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' }, barberia: null },
    ]);
    tx.usuarioRol.count.mockResolvedValue(1);

    const error = await service
      .eliminarUsuario(USUARIO, { id: ADMIN } as never, CONFIRMAR)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, response: { codigo: 'ULTIMO_ADMINISTRADOR' } });
    expect(tx.usuario.delete).not.toHaveBeenCalled();
  });

  it('un ADMIN_BARBERIA activo responde 409 USUARIO_ES_ADMIN_SEDE con las sedes', async () => {
    const { service, tx } = preparar();
    tx.usuarioRol.findMany.mockResolvedValue([
      {
        id: 'rol-2',
        estado: 'ACTIVO',
        rol: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
        barberia: { id: SEDE, nombre: 'Sede Centro' },
      },
    ]);

    const error = await service
      .eliminarUsuario(USUARIO, { id: ADMIN } as never, CONFIRMAR)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: {
        codigo: 'USUARIO_ES_ADMIN_SEDE',
        sedes: [{ id: SEDE, nombre: 'Sede Centro' }],
      },
    });
    expect(tx.usuario.delete).not.toHaveBeenCalled();
  });

  it('un responsable de sede responde 409 USUARIO_ES_RESPONSABLE_SEDE con las sedes', async () => {
    const { service, tx } = preparar();
    tx.barberia.findMany.mockResolvedValue([
      { id: SEDE_B, nombre: 'Sede Norte' },
    ]);

    const error = await service
      .eliminarUsuario(USUARIO, { id: ADMIN } as never, CONFIRMAR)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: {
        codigo: 'USUARIO_ES_RESPONSABLE_SEDE',
        sedes: [{ id: SEDE_B, nombre: 'Sede Norte' }],
      },
    });
    expect(tx.usuario.delete).not.toHaveBeenCalled();
  });

  it('con propuestas de horario creadas responde 409 y no borra', async () => {
    const { service, tx } = preparar();
    tx.propuestaHorario.count.mockResolvedValue(2);

    const error = await service
      .eliminarUsuario(USUARIO, { id: ADMIN } as never, CONFIRMAR)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: { codigo: 'USUARIO_CON_PROPUESTAS_HORARIO', total: 2 },
    });
    expect(tx.usuario.delete).not.toHaveBeenCalled();
  });

  it('con solicitudes de antecedente resueltas responde 409 y no borra', async () => {
    const { service, tx } = preparar();
    tx.solicitudAntecedente.count.mockResolvedValue(4);

    const error = await service
      .eliminarUsuario(USUARIO, { id: ADMIN } as never, CONFIRMAR)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: { codigo: 'USUARIO_CON_SOLICITUDES_ANTECEDENTES', total: 4 },
    });
    expect(tx.usuario.delete).not.toHaveBeenCalled();
  });

  it('un usuario inexistente responde 404', async () => {
    const { service, tx } = preparar();
    tx.usuario.findUnique.mockResolvedValue(null);

    const error = await service
      .eliminarUsuario(USUARIO, { id: ADMIN } as never, CONFIRMAR)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 404 });
    expect(tx.usuario.delete).not.toHaveBeenCalled();
  });
});
