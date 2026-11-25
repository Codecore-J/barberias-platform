import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ServiciosBarberoService } from '../src/catalogo/application/servicios-barbero.service.js';
import { ServiciosBarberoController } from '../src/catalogo/infrastructure/servicios-barbero.controller.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import type { CloudinaryService } from '../src/shared/cloudinary/cloudinary.service.js';

/**
 * T-24 · imagen del servicio.
 *
 * Lo que fija esta prueba:
 *  1. `servicios_barbero.imagen_url` existe y la migración añade la columna de
 *     forma idempotente (la columna puede venir de otra migración: no se crea
 *     dos veces ni se recrea la tabla).
 *  2. La ruta es `PATCH /shops/:shopId/mis-servicios/:id/imagen`, solo BARBERO.
 *  3. Se aceptan jpg, png y webp de hasta 2 MB; cualquier otro tipo o tamaño
 *     responde 400 (no se sube nada).
 *  4. Sin `CLOUDINARY_URL` la respuesta es 503 con mensaje claro: no falla en
 *     silencio ni guarda una URL inventada.
 *  5. Reemplazar la imagen BORRA la anterior de Cloudinary antes de subir la
 *     nueva, y sin imagen previa no se borra nada.
 *
 * Se escribe antes de tocar producción: en rojo falla porque no hay columna,
 * ni migración, ni ruta, ni servicio de Cloudinary.
 */
const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

const MB = 1024 * 1024;
const TAMANO_MAXIMO = 2 * MB;

function modeloServicioBarbero(): string {
  return ESQUEMA.match(/model ServicioBarbero \{[\s\S]*?\n\}/)?.[0] ?? '';
}

function sqlDeImagen(): string {
  const carpetas = readdirSync(MIGRACIONES).filter((nombre) => nombre.includes('imagen'));
  return carpetas
    .map((carpeta) => {
      try {
        return readFileSync(join(MIGRACIONES, carpeta, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

const SEDE = '11111111-1111-4111-8111-111111111111';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const SERVICIO = '77777777-7777-4777-8777-777777777777';
const URL_ANTERIOR =
  'https://res.cloudinary.com/demo/image/upload/v1700000000/servicios/sede/antes.webp';

function archivo(mimetype = 'image/png', bytes = 1024) {
  return { mimetype, size: bytes, buffer: Buffer.alloc(bytes, 1), originalname: 'foto.png' };
}

function prismaFalso() {
  return {
    categoriaServicio: { findFirst: vi.fn(), findMany: vi.fn() },
    usuarioRol: { findFirst: vi.fn() },
    servicioBarbero: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

function cloudinaryFalso(configurado = true) {
  return {
    configurado: vi.fn(() => configurado),
    subir: vi.fn(async () => ({
      url: 'https://res.cloudinary.com/demo/image/upload/v1700000001/servicios/sede/nueva.webp',
      publicId: 'servicios/sede/nueva',
    })),
    borrar: vi.fn(async () => undefined),
  };
}

function preparar(
  prisma: ReturnType<typeof prismaFalso>,
  cloudinary: ReturnType<typeof cloudinaryFalso>,
) {
  prisma.usuarioRol.findFirst.mockResolvedValue({
    usuario: { nombreCompleto: 'Carlos', estadoCuenta: 'ACTIVO' },
  });
  return new ServiciosBarberoService(
    prisma as unknown as PrismaService,
    cloudinary as unknown as CloudinaryService,
  );
}

afterEach(() => {
  delete process.env.CLOUDINARY_URL;
});

describe('T-24 · imagen del servicio', () => {
  describe('modelo y migración', () => {
    it('`ServicioBarbero.imagenUrl` es opcional y guarda 500 caracteres', () => {
      const modelo = modeloServicioBarbero();
      expect(modelo).not.toBe('');
      expect(modelo).toMatch(
        /imagenUrl\s+String\?\s+@map\("imagen_url"\)\s+@db\.VarChar\(500\)/,
      );
    });

    it('la migración añade `imagen_url` sin recrear `servicios_barbero`', () => {
      const sql = sqlDeImagen();
      expect(sql).not.toBe('');
      expect(sql).toMatch(
        /ALTER TABLE\s+"?servicios_barbero"?\s+ADD COLUMN\s+(IF NOT EXISTS\s+)?"imagen_url"/i,
      );
      expect(sql).toMatch(/VARCHAR\(500\)/i);
      // Idempotente: si la columna ya existe, no falla ni la recrea.
      expect(sql).toMatch(/IF NOT EXISTS/i);
      expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/i);
    });
  });

  describe('ruta del controlador', () => {
    it('existe PATCH mis-servicios/:id/imagen', () => {
      const proto = ServiciosBarberoController.prototype as unknown as Record<string, unknown>;
      const ruta = Object.getOwnPropertyNames(proto).find((nombre) => {
        const metodo = proto[nombre];
        if (typeof metodo !== 'function') return false;
        return (
          Reflect.getMetadata(PATH_METADATA, metodo) === 'mis-servicios/:id/imagen' &&
          Reflect.getMetadata(METHOD_METADATA, metodo) === RequestMethod.PATCH
        );
      });

      expect(ruta).toBeDefined();
    });
  });

  describe('validación del archivo', () => {
    it('acepta jpg, png y webp', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      for (const mimetype of ['image/jpeg', 'image/png', 'image/webp']) {
        const prisma = prismaFalso();
        const cloudinary = cloudinaryFalso();
        const service = preparar(prisma, cloudinary);
        prisma.servicioBarbero.findFirst.mockResolvedValue({ id: SERVICIO, imagenUrl: null });
        prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

        await service.actualizarImagen(SEDE, BARBERO, SERVICIO, archivo(mimetype));

        expect(cloudinary.subir).toHaveBeenCalledTimes(1);
      }
    });

    it('rechaza un tipo que no es jpg, png ni webp (400)', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      for (const mimetype of ['image/gif', 'application/pdf', 'text/plain']) {
        const prisma = prismaFalso();
        const cloudinary = cloudinaryFalso();
        const service = preparar(prisma, cloudinary);
        prisma.servicioBarbero.findFirst.mockResolvedValue({ id: SERVICIO, imagenUrl: null });

        const error = await service
          .actualizarImagen(SEDE, BARBERO, SERVICIO, archivo(mimetype))
          .catch((e: unknown) => e);

        expect(error).toMatchObject({
          status: 400,
          response: { statusCode: 400, codigo: 'IMAGEN_TIPO_INVALIDO' },
        });
        expect(cloudinary.subir).not.toHaveBeenCalled();
        expect(prisma.servicioBarbero.update).not.toHaveBeenCalled();
      }
    });

    it('rechaza más de 2 MB (400)', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      const prisma = prismaFalso();
      const cloudinary = cloudinaryFalso();
      const service = preparar(prisma, cloudinary);
      prisma.servicioBarbero.findFirst.mockResolvedValue({ id: SERVICIO, imagenUrl: null });

      const error = await service
        .actualizarImagen(SEDE, BARBERO, SERVICIO, archivo('image/png', TAMANO_MAXIMO + 1))
        .catch((e: unknown) => e);

      expect(error).toMatchObject({
        status: 400,
        response: { statusCode: 400, codigo: 'IMAGEN_DEMASIADO_GRANDE' },
      });
      expect(cloudinary.subir).not.toHaveBeenCalled();
      expect(prisma.servicioBarbero.update).not.toHaveBeenCalled();
    });

    it('rechaza una petición sin archivo (400)', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      const prisma = prismaFalso();
      const cloudinary = cloudinaryFalso();
      const service = preparar(prisma, cloudinary);

      const error = await service
        .actualizarImagen(SEDE, BARBERO, SERVICIO, undefined as never)
        .catch((e: unknown) => e);

      expect(error).toMatchObject({
        status: 400,
        response: { statusCode: 400, codigo: 'IMAGEN_REQUERIDA' },
      });
      expect(cloudinary.subir).not.toHaveBeenCalled();
    });
  });

  describe('Cloudinary no configurado', () => {
    it('responde 503 con mensaje claro y no guarda nada', async () => {
      delete process.env.CLOUDINARY_URL;
      const prisma = prismaFalso();
      const cloudinary = cloudinaryFalso(false);
      const service = preparar(prisma, cloudinary);
      prisma.servicioBarbero.findFirst.mockResolvedValue({ id: SERVICIO, imagenUrl: null });

      const error = await service
        .actualizarImagen(SEDE, BARBERO, SERVICIO, archivo())
        .catch((e: unknown) => e);

      expect(error).toMatchObject({
        status: 503,
        response: { statusCode: 503, codigo: 'IMAGEN_NO_CONFIGURADA' },
      });
      expect((error as { response: { mensaje: string } }).response.mensaje).toMatch(
        /CLOUDINARY_URL/,
      );
      expect(cloudinary.subir).not.toHaveBeenCalled();
      expect(prisma.servicioBarbero.update).not.toHaveBeenCalled();
    });
  });

  describe('subida y reemplazo', () => {
    it('sube la imagen y guarda la URL en el servicio', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      const prisma = prismaFalso();
      const cloudinary = cloudinaryFalso();
      const service = preparar(prisma, cloudinary);
      prisma.servicioBarbero.findFirst.mockResolvedValue({ id: SERVICIO, imagenUrl: null });
      prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

      await service.actualizarImagen(SEDE, BARBERO, SERVICIO, archivo());

      expect(prisma.servicioBarbero.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SERVICIO, barberoId: BARBERO, barberiaId: SEDE },
        }),
      );
      expect(cloudinary.subir).toHaveBeenCalledTimes(1);
      expect(prisma.servicioBarbero.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SERVICIO },
          data: {
            imagenUrl:
              'https://res.cloudinary.com/demo/image/upload/v1700000001/servicios/sede/nueva.webp',
            // 24 nov: el `public_id` también se persiste, en su columna.
            imagenPublicId: 'servicios/sede/nueva',
          },
        }),
      );
    });

    it('borra la imagen anterior ANTES de subir la nueva', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      const prisma = prismaFalso();
      const cloudinary = cloudinaryFalso();
      const service = preparar(prisma, cloudinary);
      prisma.servicioBarbero.findFirst.mockResolvedValue({
        id: SERVICIO,
        imagenUrl: URL_ANTERIOR,
      });
      prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

      await service.actualizarImagen(SEDE, BARBERO, SERVICIO, archivo());

      expect(cloudinary.borrar).toHaveBeenCalledWith('servicios/sede/antes');
      expect(cloudinary.borrar.mock.invocationCallOrder[0]).toBeLessThan(
        cloudinary.subir.mock.invocationCallOrder[0],
      );
    });

    it('sin imagen previa no borra nada en Cloudinary', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      const prisma = prismaFalso();
      const cloudinary = cloudinaryFalso();
      const service = preparar(prisma, cloudinary);
      prisma.servicioBarbero.findFirst.mockResolvedValue({ id: SERVICIO, imagenUrl: null });
      prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

      await service.actualizarImagen(SEDE, BARBERO, SERVICIO, archivo());

      expect(cloudinary.borrar).not.toHaveBeenCalled();
    });

    it('un servicio de otro barbero responde 404 y no sube nada', async () => {
      process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
      const prisma = prismaFalso();
      const cloudinary = cloudinaryFalso();
      const service = preparar(prisma, cloudinary);
      prisma.servicioBarbero.findFirst.mockResolvedValue(null);

      const error = await service
        .actualizarImagen(SEDE, BARBERO, SERVICIO, archivo())
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ status: 404 });
      expect(cloudinary.subir).not.toHaveBeenCalled();
      expect(prisma.servicioBarbero.update).not.toHaveBeenCalled();
    });
  });

  describe('CloudinaryService', () => {
    it('deriva el public_id de una URL de Cloudinary y descarta otras URLs', async () => {
      const { CloudinaryService: Servicio } = (await import(
        '../src/shared/cloudinary/cloudinary.service.js'
      )) as typeof import('../src/shared/cloudinary/cloudinary.service.js');

      expect(Servicio.publicIdDe(URL_ANTERIOR)).toBe('servicios/sede/antes');
      expect(
        Servicio.publicIdDe(
          'https://res.cloudinary.com/demo/image/upload/servicios/sede/corte.png',
        ),
      ).toBe('servicios/sede/corte');
      expect(Servicio.publicIdDe('https://cdn.ejemplo.com/foto.png')).toBeNull();
      expect(Servicio.publicIdDe(null)).toBeNull();
    });
  });
});
