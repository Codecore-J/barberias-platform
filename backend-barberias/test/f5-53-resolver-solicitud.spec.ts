import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { TiempoService } from '../src/shared/time/tiempo.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { SolicitudAntecedenteService } from '../src/antecedente/application/solicitud-antecedente.service.js';
import { SolicitudAntecedenteGlobalController } from '../src/antecedente/infrastructure/solicitud-antecedente.controller.js';
import { DecisionSolicitudAntecedente } from '../src/antecedente/application/dto/solicitud-antecedente.dto.js';

/**
 * T-53 · aprobar o denegar.
 *
 * Aprobar CREA la fila de `antecedentes` (categoria GENERAL, contenido
 * motivo + evidencia, compartido false) y marca la solicitud APROBADA en la
 * misma transacción; denegar exige motivo (422 MOTIVO_REQUERIDO). Las dos
 * decisiones dejan evento en `auditoria`.
 *
 * En rojo falla porque la resolución y sus rutas no existen.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const ADMIN_GLOBAL = '33333333-3333-4333-8333-333333333333';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const CLIENTE = '66666666-6666-4666-8666-666666666666';
const SOLICITUD = '99999999-9999-4999-8999-999999999999';

const pendiente = {
  id: SOLICITUD,
  barberiaId: SEDE,
  solicitanteId: BARBERO,
  clienteId: CLIENTE,
  motivo: 'Llegó en estado inconveniente',
  evidenciaTexto: 'Testigo: recepción',
  estado: 'PENDIENTE',
  resueltoPor: null,
  resueltoAt: null,
  motivoDenegacion: null,
};

function txFalso() {
  return {
    usuarioRol: {
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
    },
    antecedente: { create: vi.fn(async () => ({ id: 'ant-1' })) },
    solicitudAntecedente: {
      update: vi.fn(async () => ({ id: SOLICITUD, estado: 'APROBADA' })),
    },
  };
}

function preparar(solicitud: unknown, tx = txFalso()) {
  const prisma = {
    solicitudAntecedente: { findFirst: vi.fn(async () => solicitud) },
    $transaction: vi.fn(async (cb: (cliente: typeof tx) => unknown) => cb(tx)),
  };
  const auditoria = { registrarEvento: vi.fn(async () => ({ id: 'aud-1' })) };
  const tiempo = { ahora: () => new Date('2026-11-25T12:00:00.000Z') };

  return {
    service: new SolicitudAntecedenteService(
      prisma as unknown as PrismaService,
      tiempo as unknown as TiempoService,
      auditoria as unknown as AuditoriaService,
    ),
    prisma,
    tx,
    auditoria,
  };
}

describe('T-53 · resolver la solicitud de antecedente', () => {
  it('un id inexistente responde 404 y no abre transacción', async () => {
    const { service, prisma } = preparar(null);

    const error = await service
      .resolver(ADMIN_GLOBAL, SOLICITUD, { decision: DecisionSolicitudAntecedente.APROBAR })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('una solicitud ya resuelta responde 409 SOLICITUD_YA_RESUELTA', async () => {
    const { service } = preparar({ ...pendiente, estado: 'APROBADA' });

    const error = await service
      .resolver(ADMIN_GLOBAL, SOLICITUD, { decision: DecisionSolicitudAntecedente.APROBAR })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: { codigo: 'SOLICITUD_YA_RESUELTA' },
    });
  });

  it('denegar sin motivo responde 422 MOTIVO_REQUERIDO y no escribe nada', async () => {
    const { service, prisma, tx } = preparar(pendiente);

    const error = await service
      .resolver(ADMIN_GLOBAL, SOLICITUD, {
        decision: DecisionSolicitudAntecedente.DENEGAR,
        motivo: '   ',
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 422,
      response: { codigo: 'MOTIVO_REQUERIDO' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.solicitudAntecedente.update).not.toHaveBeenCalled();
  });

  it('aprobar crea el antecedente GENERAL con motivo y evidencia en la misma transacción', async () => {
    const { service, prisma, tx, auditoria } = preparar(pendiente);

    await service.resolver(ADMIN_GLOBAL, SOLICITUD, {
      decision: DecisionSolicitudAntecedente.APROBAR,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.antecedente.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        usuarioId: CLIENTE,
        barberiaOrigenId: SEDE,
        categoria: 'GENERAL',
        contenido: 'Llegó en estado inconveniente\n\nTestigo: recepción',
        origen: 'BARBERO',
        estadoValidacion: 'APROBADO',
        compartido: false,
      }),
    });
    expect(tx.solicitudAntecedente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOLICITUD },
        data: expect.objectContaining({
          estado: 'APROBADA',
          resueltoPor: ADMIN_GLOBAL,
        }),
      }),
    );
    expect(auditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'ANTECEDENTE_APROBADO',
        entidad: 'solicitud_antecedente',
        entidadId: SOLICITUD,
        barberiaId: SEDE,
        usuarioId: ADMIN_GLOBAL,
      }),
      tx,
    );
  });

  it('si el solicitante es ADMIN_BARBERIA, el antecedente nace con origen ADMIN', async () => {
    const { service, tx } = preparar({ ...pendiente, solicitanteId: 'admin-sede' });
    tx.usuarioRol.findFirst.mockResolvedValue({ id: 'rol-admin-sede' });

    await service.resolver(ADMIN_GLOBAL, SOLICITUD, {
      decision: DecisionSolicitudAntecedente.APROBAR,
    });

    expect(tx.antecedente.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ origen: 'ADMIN' }),
    });
  });

  it('denegar guarda el motivo y audita ANTECEDENTE_DENEGADO', async () => {
    const { service, tx, auditoria } = preparar(pendiente);

    await service.resolver(ADMIN_GLOBAL, SOLICITUD, {
      decision: DecisionSolicitudAntecedente.DENEGAR,
      motivo: '  El reporte no describe un hecho verificable.  ',
    });

    expect(tx.antecedente.create).not.toHaveBeenCalled();
    expect(tx.solicitudAntecedente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'DENEGADA',
          motivoDenegacion: 'El reporte no describe un hecho verificable.',
          resueltoPor: ADMIN_GLOBAL,
        }),
      }),
    );
    expect(auditoria.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'ANTECEDENTE_DENEGADO',
        entidad: 'solicitud_antecedente',
        entidadId: SOLICITUD,
        barberiaId: SEDE,
      }),
      tx,
    );
  });

  it('declara GET /antecedentes/solicitudes y PATCH /antecedentes/solicitudes/:id', () => {
    const proto = SolicitudAntecedenteGlobalController.prototype as unknown as Record<
      string,
      unknown
    >;
    const rutas = Object.getOwnPropertyNames(proto)
      .map((nombre) => proto[nombre])
      .filter((candidato) => typeof candidato === 'function')
      .map((candidato) => ({
        ruta: Reflect.getMetadata(PATH_METADATA, candidato) as string | undefined,
        metodo: Reflect.getMetadata(METHOD_METADATA, candidato) as number | undefined,
      }));

    expect(rutas).toEqual(
      expect.arrayContaining([
        { ruta: '/', metodo: RequestMethod.GET },
        { ruta: ':id', metodo: RequestMethod.PATCH },
      ]),
    );
  });
});
