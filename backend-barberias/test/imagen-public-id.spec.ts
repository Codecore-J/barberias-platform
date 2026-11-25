import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ServiciosBarberoService } from '../src/catalogo/application/servicios-barbero.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import type { CloudinaryService } from '../src/shared/cloudinary/cloudinary.service.js';

/**
 * `public_id` propio del servicio.
 *
 * Hasta ahora el `public_id` se derivaba de la URL guardada. Eso funciona, pero
 * impide borrar con exactitud una imagen cuyo formato de URL cambie (transforma-
 * ciones, carpetas, entrega con nombre distinto) y obliga a confiar en un parseo.
 * Desde ahora se guarda en su columna y el borrado lo usa directamente; el
 * parseo queda solo como respaldo para las filas anteriores a la migración.
 *
 * En rojo falla porque no existe `imagen_public_id` ni su migración.
 */
const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

const SEDE = '11111111-1111-4111-8111-111111111111';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const SERVICIO = '77777777-7777-4777-8777-777777777777';
const URL_ANTERIOR =
  'https://res.cloudinary.com/demo/image/upload/v1700000000/servicios/sede/antes.webp';

function modelo(): string {
  return ESQUEMA.match(/model ServicioBarbero \{[\s\S]*?\n\}/)?.[0] ?? '';
}

function sqlDePublicId(): string {
  return readdirSync(MIGRACIONES)
    .filter((nombre) => nombre.includes('public_id'))
    .map((carpeta) => {
      try {
        return readFileSync(join(MIGRACIONES, carpeta, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

function prismaFalso() {
  return {
    categoriaServicio: { findFirst: vi.fn(), findMany: vi.fn() },
    usuarioRol: { findFirst: vi.fn() },
    servicioBarbero: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  };
}

function cloudinaryFalso() {
  return {
    configurado: vi.fn(() => true),
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

const archivo = () => ({
  mimetype: 'image/png',
  size: 1024,
  buffer: Buffer.alloc(1024, 1),
  originalname: 'foto.png',
});

afterEach(() => {
  delete process.env.CLOUDINARY_URL;
});

describe('imagen del servicio · public_id en su columna', () => {
  it('el modelo declara `imagen_public_id` opcional de 255', () => {
    const bloque = modelo();
    expect(bloque).not.toBe('');
    expect(bloque).toMatch(
      /imagenPublicId\s+String\?\s+@map\("imagen_public_id"\)\s+@db\.VarChar\(255\)/,
    );
  });

  it('la migración añade la columna de forma idempotente y sin recrear la tabla', () => {
    const sql = sqlDePublicId();
    expect(sql).not.toBe('');
    expect(sql).toMatch(
      /ALTER TABLE\s+"?servicios_barbero"?\s+ADD COLUMN\s+(IF NOT EXISTS\s+)?"imagen_public_id"/i,
    );
    expect(sql).toMatch(/IF NOT EXISTS/i);
    expect(sql).toMatch(/VARCHAR\(255\)/i);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/i);
  });

  it('guarda el public_id que devuelve Cloudinary junto a la URL', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
    const prisma = prismaFalso();
    const cloudinary = cloudinaryFalso();
    const service = preparar(prisma, cloudinary);
    prisma.servicioBarbero.findFirst.mockResolvedValue({
      id: SERVICIO,
      imagenUrl: null,
      imagenPublicId: null,
    });
    prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

    await service.actualizarImagen(SEDE, BARBERO, SERVICIO, archivo());

    expect(prisma.servicioBarbero.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ imagenPublicId: true }),
      }),
    );
    expect(prisma.servicioBarbero.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          imagenUrl: 'https://res.cloudinary.com/demo/image/upload/v1700000001/servicios/sede/nueva.webp',
          imagenPublicId: 'servicios/sede/nueva',
        },
      }),
    );
  });

  it('borra con el public_id guardado, sin volver a parsear la URL', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
    const prisma = prismaFalso();
    const cloudinary = cloudinaryFalso();
    const service = preparar(prisma, cloudinary);
    prisma.servicioBarbero.findFirst.mockResolvedValue({
      id: SERVICIO,
      imagenUrl: URL_ANTERIOR,
      imagenPublicId: 'servicios/sede/guardado',
    });
    prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

    await service.actualizarImagen(SEDE, BARBERO, SERVICIO, archivo());

    expect(cloudinary.borrar).toHaveBeenCalledWith('servicios/sede/guardado');
  });

  it('una fila anterior a la migración sigue borrando por la URL', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://clave:secreto@demo';
    const prisma = prismaFalso();
    const cloudinary = cloudinaryFalso();
    const service = preparar(prisma, cloudinary);
    prisma.servicioBarbero.findFirst.mockResolvedValue({
      id: SERVICIO,
      imagenUrl: URL_ANTERIOR,
      imagenPublicId: null,
    });
    prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

    await service.actualizarImagen(SEDE, BARBERO, SERVICIO, archivo());

    expect(cloudinary.borrar).toHaveBeenCalledWith('servicios/sede/antes');
  });
});
