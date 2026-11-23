import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CategoriasService } from '../src/catalogo/application/categorias.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * T-20 · las categorías pasan a ser GLOBALES.
 *
 * Lo que fija esta prueba:
 *  1. El modelo deja `barberia_id` nulo (NULL = categoría global), añade `orden` y
 *     cambia la unicidad de «por sede» a «por nombre normalizado»: dos sedes no
 *     pueden seguir teniendo su propio «Corte».
 *  2. La migración existe y es segura: copia las 33 filas por sede a una fila por
 *     nombre, reapunta `servicios_barbero.categoria_id` ANTES de borrar las
 *     repetidas y añade `orden`.
 *  3. El servicio ya no acota la consulta a la sede: lista y crea categorías
 *     globales (el `shopId` de la ruta solo autoriza el vínculo).
 */
const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

function modeloCategoria(): string {
  const bloque = ESQUEMA.match(/model CategoriaServicio \{[\s\S]*?\n\}/);
  return bloque?.[0] ?? '';
}

function sqlDeCategoriasGlobales(): string {
  const carpeta = readdirSync(MIGRACIONES).find((nombre) =>
    nombre.includes('categorias_globales'),
  );
  if (!carpeta) return '';
  const ruta = join(MIGRACIONES, carpeta, 'migration.sql');
  return existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
}

describe('T-20 · categorías globales', () => {
  const SEDE = '11111111-1111-4111-8111-111111111111';
  const CATEGORIA = '33333333-3333-4333-8333-333333333333';

  describe('modelo y migración', () => {
    it('`barberia_id` es opcional: NULL significa categoría global', () => {
      const modelo = modeloCategoria();
      expect(modelo).not.toBe('');
      expect(modelo).toMatch(/barberiaId\s+String\?/);
      expect(modelo).toMatch(/barberia\s+Barberia\?/);
    });

    it('añade `orden` para que el administrador global ordene el catálogo', () => {
      const modelo = modeloCategoria();
      expect(modelo).toMatch(/orden\s+Int\s+@default\(0\)/);
    });

    it('la unicidad del nombre deja de ser por sede y pasa a ser global', () => {
      const modelo = modeloCategoria();
      expect(modelo).not.toMatch(/@@unique\(\[barberiaId, nombre\]/);
      expect(modelo).toMatch(/@@unique\(\[nombre\]/);
    });

    it('existe la migración y relaja la columna en vez de recrear la tabla', () => {
      const sql = sqlDeCategoriasGlobales();
      expect(sql).not.toBe('');
      expect(sql).toMatch(/ALTER COLUMN "barberia_id" DROP NOT NULL/i);
      expect(sql).toMatch(/ADD COLUMN "orden"/i);
    });

    it('copia los datos sin duplicar nombres y reapunta los servicios antes de borrar', () => {
      const sql = sqlDeCategoriasGlobales();
      // Normaliza con lower(btrim(...)) igual que la unicidad nueva.
      expect(sql).toMatch(/lower\(btrim\(/i);
      // La fila que sobrevive es la primera activa (o la primera) por nombre.
      expect(sql).toMatch(/DISTINCT ON|ROW_NUMBER\(\) OVER/i);
      // Los servicios pasan a la categoría superviviente ANTES del DELETE.
      const posUpdate = sql.search(/UPDATE\s+"?servicios_barbero"?/i);
      const posDelete = sql.search(/DELETE FROM\s+"?categorias_servicio"?/i);
      expect(posUpdate).toBeGreaterThan(-1);
      expect(posDelete).toBeGreaterThan(posUpdate);
      // Y queda la huella de que no se toca ninguna fila sin nombre.
      expect(sql).toMatch(/IS NOT NULL/i);
    });
  });

  describe('CategoriasService sin tenant', () => {
    const prisma = {
      categoriaServicio: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };

    let service: CategoriasService;

    beforeEach(() => {
      vi.clearAllMocks();
      service = new CategoriasService(prisma as unknown as PrismaService);
    });

    it('lista las categorías globales, no las de la sede de la ruta', async () => {
      prisma.categoriaServicio.findMany.mockResolvedValue([]);

      await service.listar(SEDE);

      expect(prisma.categoriaServicio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { barberiaId: null } }),
      );
    });

    it('crea una categoría global (barberiaId nulo) con su orden', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(null);
      prisma.categoriaServicio.create.mockResolvedValue({ id: CATEGORIA });

      await service.crear(SEDE, { nombre: '  Corte   clásico ' });

      expect(prisma.categoriaServicio.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barberiaId: null,
          nombre: 'Corte clásico',
        }),
      });
      const datos = prisma.categoriaServicio.create.mock.calls[0][0].data;
      expect(datos).toHaveProperty('orden');
    });

    it('el duplicado se comprueba en el catálogo global, no en una sede', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(null);
      prisma.categoriaServicio.create.mockResolvedValue({ id: CATEGORIA });

      await service.crear(SEDE, { nombre: 'Corte' });

      const where = prisma.categoriaServicio.findFirst.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('barberiaId');
      expect(where.nombre).toEqual({ equals: 'Corte', mode: 'insensitive' });
    });
  });
});
