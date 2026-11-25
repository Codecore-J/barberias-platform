import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { SolicitudesServicioService } from '../src/catalogo/application/solicitudes-servicio.service.js';
import { SolicitudesServicioController } from '../src/catalogo/infrastructure/solicitudes-servicio.controller.js';
import { CloudinaryService } from '../src/shared/cloudinary/cloudinary.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * T-28 · foto de una solicitud de ALTA mientras está PENDIENTE.
 *
 * La tabla `solicitudes_servicio_barbero` ya tiene `imagen_url` e
 * `imagen_public_id`, y al aprobar se copian al servicio publicado. Faltaba la
 * ruta para adjuntar esa foto ANTES de la aprobación: sin ella, la sede decidía
 * sin ver el resultado y el barbero tenía que esperar a publicar.
 *
 * En rojo falla porque el servicio no sabe subir imágenes de una solicitud ni
 * el controlador declara la ruta.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const SOLICITUD = '99999999-9999-4999-8999-999999999999';

const ARCHIVO = {
  buffer: Buffer.from('imagen-de-prueba'),
  mimetype: 'image/png',
  size: 1024,
  originalname: 'foto.png',
};

function prismaFalso() {
  return {
    usuarioRol: { findFirst: vi.fn() },
    categoriaServicio: { findFirst: vi.fn() },
    servicioBarbero: { findFirst: vi.fn() },
    solicitudServicioBarbero: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

function cloudinaryFalso() {
  return {
    configurado: vi.fn(() => true),
    subir: vi.fn(async () => ({
      url: 'https://res.cloudinary.com/demo/image/upload/v1/solicitudes/foto.png',
      publicId: 'solicitudes/foto',
    })),
    borrar: vi.fn(async () => undefined),
  };
}

function preparar(
  prisma: ReturnType<typeof prismaFalso>,
  cloudinary: ReturnType<typeof cloudinaryFalso> = cloudinaryFalso(),
) {
  return new SolicitudesServicioService(
    prisma as unknown as PrismaService,
    cloudinary as unknown as CloudinaryService,
  );
}

describe('T-28 · foto de la solicitud pendiente', () => {
  it('sube la foto de una solicitud ALTA del propio barbero y guarda URL y public_id', async () => {
    const prisma = prismaFalso();
    const cloudinary = cloudinaryFalso();
    const service = preparar(prisma, cloudinary);

    prisma.solicitudServicioBarbero.findFirst.mockResolvedValue({
      id: SOLICITUD,
      estado: 'PENDIENTE',
      tipo: 'ALTA',
      imagenUrl: null,
      imagenPublicId: null,
    });
    prisma.solicitudServicioBarbero.update.mockResolvedValue({
      id: SOLICITUD,
      imagenUrl: 'https://res.cloudinary.com/demo/image/upload/v1/solicitudes/foto.png',
      imagenPublicId: 'solicitudes/foto',
    });

    const resultado = await service.actualizarImagen(SEDE, BARBERO, SOLICITUD, ARCHIVO);

    expect(prisma.solicitudServicioBarbero.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SOLICITUD,
          barberiaId: SEDE,
          barberoId: BARBERO,
          tipo: 'ALTA',
        }),
      }),
    );
    expect(cloudinary.subir).toHaveBeenCalledWith(ARCHIVO.buffer, `solicitudes/${SEDE}`);
    expect(prisma.solicitudServicioBarbero.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOLICITUD },
        data: {
          imagenUrl: 'https://res.cloudinary.com/demo/image/upload/v1/solicitudes/foto.png',
          imagenPublicId: 'solicitudes/foto',
        },
      }),
    );
    expect(resultado).toMatchObject({ id: SOLICITUD, imagenPublicId: 'solicitudes/foto' });
  });

  it('reemplaza la foto anterior: borra el public_id que ya tenía la solicitud', async () => {
    const prisma = prismaFalso();
    const cloudinary = cloudinaryFalso();
    const service = preparar(prisma, cloudinary);

    prisma.solicitudServicioBarbero.findFirst.mockResolvedValue({
      id: SOLICITUD,
      estado: 'PENDIENTE',
      tipo: 'ALTA',
      imagenUrl: 'https://res.cloudinary.com/demo/image/upload/v1/solicitudes/vieja.png',
      imagenPublicId: 'solicitudes/vieja',
    });
    prisma.solicitudServicioBarbero.update.mockResolvedValue({ id: SOLICITUD });

    await service.actualizarImagen(SEDE, BARBERO, SOLICITUD, ARCHIVO);

    expect(cloudinary.borrar).toHaveBeenCalledWith('solicitudes/vieja');
  });

  it('no toca una solicitud ya resuelta (409): la foto se cambia en el servicio publicado', async () => {
    const prisma = prismaFalso();
    const cloudinary = cloudinaryFalso();
    const service = preparar(prisma, cloudinary);

    prisma.solicitudServicioBarbero.findFirst.mockResolvedValue({
      id: SOLICITUD,
      estado: 'APROBADA',
      tipo: 'ALTA',
      imagenUrl: null,
      imagenPublicId: null,
    });

    const error = await service
      .actualizarImagen(SEDE, BARBERO, SOLICITUD, ARCHIVO)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409 });
    expect(cloudinary.subir).not.toHaveBeenCalled();
    expect(prisma.solicitudServicioBarbero.update).not.toHaveBeenCalled();
  });

  it('404 si la solicitud no es de ese barbero en esa sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.solicitudServicioBarbero.findFirst.mockResolvedValue(null);

    const error = await service
      .actualizarImagen(SEDE, BARBERO, SOLICITUD, ARCHIVO)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 404 });
  });

  it('rechaza tipos que no son imagen y archivos de más de 2 MB', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);

    const tipo = await service
      .actualizarImagen(SEDE, BARBERO, SOLICITUD, { ...ARCHIVO, mimetype: 'application/pdf' })
      .catch((e: unknown) => e);
    const tamano = await service
      .actualizarImagen(SEDE, BARBERO, SOLICITUD, { ...ARCHIVO, size: 3 * 1024 * 1024 })
      .catch((e: unknown) => e);

    expect(tipo).toMatchObject({ status: 400 });
    expect(tamano).toMatchObject({ status: 400 });
    expect(prisma.solicitudServicioBarbero.findFirst).not.toHaveBeenCalled();
  });

  it('503 explícito si falta CLOUDINARY_URL', async () => {
    const prisma = prismaFalso();
    const cloudinary = cloudinaryFalso();
    cloudinary.configurado.mockReturnValue(false);
    const service = preparar(prisma, cloudinary);

    prisma.solicitudServicioBarbero.findFirst.mockResolvedValue({
      id: SOLICITUD,
      estado: 'PENDIENTE',
      tipo: 'ALTA',
      imagenUrl: null,
      imagenPublicId: null,
    });

    const error = await service
      .actualizarImagen(SEDE, BARBERO, SOLICITUD, ARCHIVO)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 503 });
    expect(cloudinary.subir).not.toHaveBeenCalled();
  });

  it('el controlador declara PATCH :id/imagen junto a las rutas de la bandeja', () => {
    const proto = SolicitudesServicioController.prototype as unknown as Record<string, unknown>;
    const rutas = Object.getOwnPropertyNames(proto)
      .map((nombre) => proto[nombre])
      .filter((candidato) => typeof candidato === 'function')
      .map((candidato) => ({
        ruta: Reflect.getMetadata(PATH_METADATA, candidato) as string | undefined,
        metodo: Reflect.getMetadata(METHOD_METADATA, candidato) as number | undefined,
      }));

    expect(rutas).toEqual(
      expect.arrayContaining([{ ruta: ':id/imagen', metodo: RequestMethod.PATCH }]),
    );
  });
});
