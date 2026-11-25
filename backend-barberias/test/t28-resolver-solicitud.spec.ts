import { describe, expect, it, vi } from 'vitest';
import { SolicitudesServicioService } from '../src/catalogo/application/solicitudes-servicio.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * T-28 · aprobar o rechazar la solicitud.
 *
 * Aprobar un alta CREA el servicio de la sede (`Servicio`) y habilita al barbero
 * solicitante en `ServicioBarbero` con su precio, en la misma transacción.
 * Aprobar una desactivación apaga el servicio publicado. Rechazar exige motivo
 * (422 `MOTIVO_RECHAZO_REQUERIDO`) y deja el estado en `RECHAZADA`.
 *
 * En rojo falla porque el servicio no existe.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const CATEGORIA = '55555555-5555-4555-8555-555555555555';
const SERVICIO = '77777777-7777-4777-8777-777777777777';
const SOLICITUD = '99999999-9999-4999-8999-999999999999';

const pendienteAlta = {
  id: SOLICITUD,
  barberiaId: SEDE,
  barberoId: BARBERO,
  tipo: 'ALTA',
  estado: 'PENDIENTE',
  categoriaId: CATEGORIA,
  nombrePersonalizado: 'Corte degradado',
  descripcion: 'Con máquina',
  precio: 500,
  duracionMinutos: 45,
  servicioId: null,
};

const pendienteBaja = {
  ...pendienteAlta,
  tipo: 'DESACTIVACION',
  categoriaId: null,
  nombrePersonalizado: null,
  precio: null,
  duracionMinutos: null,
  servicioId: SERVICIO,
};

function txFalso() {
  return {
    solicitudServicioBarbero: { update: vi.fn(async () => ({ id: SOLICITUD })) },
    servicio: { create: vi.fn(async () => ({ id: 'servicio-nuevo' })) },
    servicioBarbero: {
      create: vi.fn(async () => ({ id: 'servicio-barbero-nuevo' })),
      update: vi.fn(async () => ({ id: SERVICIO })),
    },
    categoriaServicio: { findFirst: vi.fn(async () => ({ id: CATEGORIA, activa: true })) },
  };
}

function preparar(solicitud: unknown, tx = txFalso()) {
  const prisma = {
    ...tx,
    // La lectura de la solicitud no pasa por la transacción: va directa.
    solicitudServicioBarbero: { findFirst: vi.fn(async () => solicitud), update: vi.fn() },
    $transaction: vi.fn(async (cb: (cliente: typeof tx) => unknown) => cb(tx)),
  };
  const service = new SolicitudesServicioService(prisma as unknown as PrismaService, {
    configurado: () => true,
    subir: async () => ({ url: 'https://res.cloudinary.com/demo/foto.png', publicId: 'demo' }),
    borrar: async () => undefined,
  } as never);
  return { service, prisma, tx };
}

describe('T-28 · resolver la solicitud del barbero', () => {
  it('un id ajeno a la sede responde 404 y no toca nada', async () => {
    const { service, prisma } = preparar(null);

    const error = await service
      .resolver(SEDE, ADMIN, SOLICITUD, { aprobar: true })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('una solicitud ya resuelta responde 409 SOLICITUD_YA_RESUELTA', async () => {
    const { service } = preparar({ ...pendienteAlta, estado: 'APROBADA' });

    const error = await service
      .resolver(SEDE, ADMIN, SOLICITUD, { aprobar: true })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: { codigo: 'SOLICITUD_YA_RESUELTA' },
    });
  });

  it('rechazar sin motivo responde 422 MOTIVO_RECHAZO_REQUERIDO', async () => {
    const { service, tx } = preparar(pendienteAlta);

    const error = await service
      .resolver(SEDE, ADMIN, SOLICITUD, { aprobar: false, motivoRechazo: '   ' })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 422,
      response: { codigo: 'MOTIVO_RECHAZO_REQUERIDO' },
    });
    expect(tx.solicitudServicioBarbero.update).not.toHaveBeenCalled();
  });

  it('aprobar un ALTA crea el servicio de la sede y el del barbero en la misma transacción', async () => {
    const { service, prisma, tx } = preparar(pendienteAlta);

    await service.resolver(SEDE, ADMIN, SOLICITUD, { aprobar: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.servicio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barberiaId: SEDE,
          nombre: 'Corte degradado',
          descripcion: 'Con máquina',
          precio: 500,
          duracionEstimada: 45,
        }),
      }),
    );
    expect(tx.servicioBarbero.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barberoId: BARBERO,
          barberiaId: SEDE,
          categoriaId: CATEGORIA,
          nombrePersonalizado: 'Corte degradado',
          precio: 500,
          duracionMinutos: 45,
        }),
      }),
    );
    expect(tx.solicitudServicioBarbero.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOLICITUD },
        data: expect.objectContaining({ estado: 'APROBADA', resueltoPor: ADMIN }),
      }),
    );
  });

  it('aprobar una DESACTIVACION apaga el servicio publicado', async () => {
    const { service, tx } = preparar(pendienteBaja);

    await service.resolver(SEDE, ADMIN, SOLICITUD, { aprobar: true });

    expect(tx.servicioBarbero.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SERVICIO }, data: { activo: false } }),
    );
    expect(tx.servicio.create).not.toHaveBeenCalled();
  });

  it('rechazar guarda RECHAZADA con el motivo recortado', async () => {
    const { service, tx } = preparar(pendienteAlta);

    await service.resolver(SEDE, ADMIN, SOLICITUD, {
      aprobar: false,
      motivoRechazo: '  El precio no corresponde  ',
    });

    expect(tx.solicitudServicioBarbero.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOLICITUD },
        data: expect.objectContaining({
          estado: 'RECHAZADA',
          motivoRechazo: 'El precio no corresponde',
          resueltoPor: ADMIN,
        }),
      }),
    );
    expect(tx.servicio.create).not.toHaveBeenCalled();
    expect(tx.servicioBarbero.create).not.toHaveBeenCalled();
  });
});
