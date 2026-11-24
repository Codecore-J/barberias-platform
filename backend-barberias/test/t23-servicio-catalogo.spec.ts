import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ServiciosBarberoService } from '../src/catalogo/application/servicios-barbero.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { CreateServicioBarberoDto } from '../src/catalogo/application/dto/create-servicio-barbero.dto.js';
import { UpdateServicioBarberoDto } from '../src/catalogo/application/dto/update-servicio-barbero.dto.js';

/**
 * T-23 · servicio del catálogo híbrido con contrato cerrado.
 *
 * Lo que fija esta prueba:
 *  1. La categoría es OBLIGATORIA y tiene que existir en el catálogo GLOBAL. Si
 *     el id no está o pertenece a una sede (fila heredada), la respuesta es 422
 *     (`CATEGORIA_INVALIDA`), no 404: la petición es válida, el estado del
 *     catálogo es lo que impide publicar.
 *  2. `duracionMinutos` va de 5 a 480 minutos, entero.
 *  3. `precio` es mayor o igual a cero, con dos decimales como máximo.
 *  4. `descripcion` es OPCIONAL (hasta 500), se recorta y el vacío se guarda
 *     como NULL.
 *
 * Se escribe ANTES de tocar producción: en rojo, esta prueba falla por la
 * descripción (no existe en el modelo ni en el DTO), por el 422 de categoría
 * (hoy es 404) y por la migración.
 */
const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

function modeloServicioBarbero(): string {
  return ESQUEMA.match(/model ServicioBarbero \{[\s\S]*?\n\}/)?.[0] ?? '';
}

function sqlDeDescripcion(): string {
  const carpeta = readdirSync(MIGRACIONES).find((nombre) =>
    nombre.includes('descripcion_servicio_barbero'),
  );
  if (!carpeta) return '';
  try {
    return readFileSync(join(MIGRACIONES, carpeta, 'migration.sql'), 'utf8');
  } catch {
    return '';
  }
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const meta = (metatype: unknown): ArgumentMetadata => ({
  type: 'body',
  metatype: metatype as ArgumentMetadata['metatype'],
  data: '',
});

const SEDE = '11111111-1111-4111-8111-111111111111';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const CATEGORIA = '33333333-3333-4333-8333-333333333333';
const SERVICIO = '77777777-7777-4777-8777-777777777777';

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

describe('T-23 · servicio del catálogo híbrido', () => {
  describe('modelo y migración', () => {
    it('`ServicioBarbero.descripcion` es opcional y admite hasta 500 caracteres', () => {
      const modelo = modeloServicioBarbero();
      expect(modelo).not.toBe('');
      expect(modelo).toMatch(/descripcion\s+String\?\s+@db\.VarChar\(500\)/);
    });

    it('la migración AÑADE la columna sin recrear `servicios_barbero`', () => {
      const sql = sqlDeDescripcion();
      expect(sql).not.toBe('');
      expect(sql).toMatch(
        /ALTER TABLE\s+"?servicios_barbero"?\s+ADD COLUMN\s+(IF NOT EXISTS\s+)?"descripcion"/i,
      );
      expect(sql).toMatch(/VARCHAR\(500\)/i);
      expect(sql).not.toMatch(/DROP TABLE/i);
    });
  });

  describe('contrato del DTO', () => {
    const base = {
      nombre: 'Corte degradado',
      precio: 25,
      duracionMinutos: 30,
      categoriaId: CATEGORIA,
    };

    it('la categoría es obligatoria (400 sin `categoriaId`)', async () => {
      await expect(
        pipe.transform({ ...base, categoriaId: undefined }, meta(CreateServicioBarberoDto)),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('la categoría tiene que ser un UUID', async () => {
      await expect(
        pipe.transform({ ...base, categoriaId: 'corte' }, meta(CreateServicioBarberoDto)),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('acepta un precio de cero y rechaza uno negativo', async () => {
      const gratis = await pipe.transform({ ...base, precio: 0 }, meta(CreateServicioBarberoDto));
      expect(gratis.precio).toBe(0);

      await expect(
        pipe.transform({ ...base, precio: -0.01 }, meta(CreateServicioBarberoDto)),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('acepta duración de 5 y de 480, y rechaza 4, 481 y fracciones', async () => {
      for (const duracion of [5, 480]) {
        const dto = await pipe.transform(
          { ...base, duracionMinutos: duracion },
          meta(CreateServicioBarberoDto),
        );
        expect(dto.duracionMinutos).toBe(duracion);
      }

      for (const duracion of [4, 481, 30.5]) {
        await expect(
          pipe.transform({ ...base, duracionMinutos: duracion }, meta(CreateServicioBarberoDto)),
        ).rejects.toMatchObject({ status: 400 });
      }
    });

    it('la descripción es opcional al crear y al editar', async () => {
      const sinDescripcion = await pipe.transform(base, meta(CreateServicioBarberoDto));
      expect(sinDescripcion.descripcion).toBeUndefined();

      const conDescripcion = await pipe.transform(
        { ...base, descripcion: 'Tijera y máquina' },
        meta(CreateServicioBarberoDto),
      );
      expect(conDescripcion.descripcion).toBe('Tijera y máquina');

      const edicion = await pipe.transform(
        { descripcion: 'Texto nuevo' },
        meta(UpdateServicioBarberoDto),
      );
      expect(edicion.descripcion).toBe('Texto nuevo');
    });

    it('rechaza una descripción de más de 500 caracteres', async () => {
      await expect(
        pipe.transform(
          { ...base, descripcion: 'x'.repeat(501) },
          meta(CreateServicioBarberoDto),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('sigue rechazando propiedades que el contrato no declara', async () => {
      await expect(
        pipe.transform({ ...base, inventado: true }, meta(CreateServicioBarberoDto)),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('ServiciosBarberoService', () => {
    const dto = {
      nombre: '  Corte  degradado ',
      precio: 25.5,
      duracionMinutos: 30,
      categoriaId: CATEGORIA,
      descripcion: '  Tijera y máquina  ',
    };

    function preparar(prisma: ReturnType<typeof prismaFalso>) {
      prisma.usuarioRol.findFirst.mockResolvedValue({
        usuario: { nombreCompleto: 'Carlos', estadoCuenta: 'ACTIVO' },
      });
      return new ServiciosBarberoService(prisma as unknown as PrismaService);
    }

    it('publica el servicio con la descripción recortada', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.categoriaServicio.findFirst.mockResolvedValue({
        id: CATEGORIA,
        nombre: 'Corte',
        barberiaId: null,
        activa: true,
      });
      prisma.servicioBarbero.findFirst.mockResolvedValue(null);
      prisma.servicioBarbero.create.mockResolvedValue({ id: SERVICIO });

      await service.crear(SEDE, BARBERO, dto);

      expect(prisma.servicioBarbero.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            descripcion: 'Tijera y máquina',
            precio: 25.5,
            duracionMinutos: 30,
            categoriaId: CATEGORIA,
          }),
        }),
      );
    });

    it('guarda la descripción como NULL cuando no se envía o viene vacía', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.categoriaServicio.findFirst.mockResolvedValue({
        id: CATEGORIA,
        nombre: 'Corte',
        barberiaId: null,
        activa: true,
      });
      prisma.servicioBarbero.findFirst.mockResolvedValue(null);
      prisma.servicioBarbero.create.mockResolvedValue({ id: SERVICIO });

      const { descripcion: _omitida, ...sinDescripcion } = dto;
      await service.crear(SEDE, BARBERO, sinDescripcion as never);
      await service.crear(SEDE, BARBERO, { ...dto, descripcion: '   ' });

      for (const llamada of prisma.servicioBarbero.create.mock.calls) {
        expect(llamada[0].data.descripcion).toBeNull();
      }
    });

    it('una categoría que no existe responde 422 CATEGORIA_INVALIDA', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.categoriaServicio.findFirst.mockResolvedValue(null);

      const error = await service.crear(SEDE, BARBERO, dto).catch((e: unknown) => e);

      expect(error).toMatchObject({
        status: 422,
        response: { statusCode: 422, codigo: 'CATEGORIA_INVALIDA' },
      });
      expect(prisma.servicioBarbero.create).not.toHaveBeenCalled();
    });

    it('una categoría que no es global (hereda sede) también responde 422', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.categoriaServicio.findFirst
        .mockResolvedValueOnce(null) // no está en el catálogo global
        .mockResolvedValueOnce({
          id: CATEGORIA,
          nombre: 'Corte',
          barberiaId: SEDE, // fila heredada de una sede
          activa: true,
        });

      const error = await service.crear(SEDE, BARBERO, dto).catch((e: unknown) => e);

      expect(error).toMatchObject({
        status: 422,
        response: { statusCode: 422, codigo: 'CATEGORIA_INVALIDA' },
      });
      expect(prisma.servicioBarbero.create).not.toHaveBeenCalled();
    });

    it('la edición guarda la descripción y permite vaciarla', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.servicioBarbero.findFirst.mockResolvedValue({
        id: SERVICIO,
        categoriaId: CATEGORIA,
        nombrePersonalizado: 'Corte',
        precio: 20,
        duracionMinutos: 30,
        activo: true,
      });
      prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO });

      await service.actualizar(SEDE, BARBERO, SERVICIO, { descripcion: '  Nuevo texto ' });
      await service.actualizar(SEDE, BARBERO, SERVICIO, { descripcion: '   ' });

      expect(prisma.servicioBarbero.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: { descripcion: 'Nuevo texto' } }),
      );
      expect(prisma.servicioBarbero.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: { descripcion: null } }),
      );
    });

    it('la vitrina entrega la descripción del servicio', async () => {
      const prisma = prismaFalso();
      const service = preparar(prisma);
      prisma.categoriaServicio.findMany.mockResolvedValue([
        {
          id: CATEGORIA,
          nombre: 'Corte',
          descripcion: null,
          servicios: [
            {
              id: SERVICIO,
              nombrePersonalizado: 'Corte degradado',
              descripcion: 'Tijera y máquina',
              precio: 25,
              duracionMinutos: 30,
              barbero: { id: BARBERO, nombreCompleto: 'Carlos' },
            },
          ],
        },
      ]);

      const [categoria] = await service.catalogoAnidado(SEDE);

      expect(categoria.servicios[0]).toMatchObject({
        descripcion: 'Tijera y máquina',
      });
    });
  });
});
