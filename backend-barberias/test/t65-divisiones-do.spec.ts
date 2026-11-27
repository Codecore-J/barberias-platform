import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROVINCIAS_DO,
  sembrarDivisionesDO,
} from '../prisma/seed-divisiones-do.js';

/**
 * F6 / T-65 · catálogo de divisiones administrativas de República Dominicana.
 *
 * Lo que fija esta prueba:
 *  1. El seed declara las **32 provincias** del país, sin repetir ninguna, y
 *     cada una con al menos su municipio cabecera.
 *  2. Correrlo dos veces **no duplica**: el seed hace `upsert` por
 *     (país, nivel, nombre), que es la misma clave del índice único de la tabla.
 *     El doble de Prisma de esta prueba reproduce esa clave, así que un `create`
 *     a secas fallaría aquí aunque la base lo tolerara.
 *  3. Los municipios quedan colgados de su provincia (`padre_id`), no sueltos.
 *  4. La migración crea la tabla y el índice único de forma idempotente, y no
 *     borra ni reescribe nada.
 */

const RAIZ = process.cwd();
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

function sqlDeDivisiones(): string {
  if (!existsSync(MIGRACIONES)) return '';
  return readdirSync(MIGRACIONES)
    .filter((carpeta) => /divisiones/i.test(carpeta))
    .map((carpeta) => {
      const archivo = join(MIGRACIONES, carpeta, 'migration.sql');
      return existsSync(archivo) ? readFileSync(archivo, 'utf8') : '';
    })
    .join('\n');
}

function sinComentarios(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((linea) => linea.replace(/--.*$/, ''))
    .join('\n');
}

/** Doble de Prisma que respeta la clave única (país, nivel, nombre). */
function prismaFalso() {
  const filas = new Map<string, any>();
  let secuencia = 0;

  const clave = (d: any) => `${d.paisCodigo}|${d.nivel}|${d.nombre}`;

  return {
    filas,
    divisionAdministrativa: {
      async upsert({ where, create, update }: any) {
        const compuesta = where.paisCodigo_nivel_nombre;
        const k = clave(compuesta);
        const existente = filas.get(k);
        if (existente) {
          Object.assign(existente, update ?? {});
          return existente;
        }
        const fila = { id: `div-${++secuencia}`, ...create };
        filas.set(k, fila);
        return fila;
      },
    },
  };
}

describe('T-65 · catálogo de divisiones de República Dominicana', () => {
  it('declara las 32 provincias, sin repetir', () => {
    const nombres = PROVINCIAS_DO.map((p) => p.nombre);

    expect(nombres.length).toBe(32);
    expect(new Set(nombres).size).toBe(32);
  });

  it('cada provincia trae al menos su municipio cabecera', () => {
    const sinMunicipios = PROVINCIAS_DO.filter(
      (p) => !Array.isArray(p.municipios) || p.municipios.length === 0,
    ).map((p) => p.nombre);

    expect(
      sinMunicipios.length === 0
        ? ''
        : `provincias sin municipios:\n${sinMunicipios.join('\n')}`,
    ).toBe('');
  });

  it('el seed siembra provincias y municipios y colgándolos de su provincia', async () => {
    const prisma = prismaFalso();

    const resultado = await sembrarDivisionesDO(prisma as any);

    expect(resultado.provincias).toBe(32);
    expect(resultado.municipios).toBeGreaterThanOrEqual(32);

    const municipios = [...prisma.filas.values()].filter((f) => f.nivel === 2);
    expect(municipios.length).toBe(resultado.municipios);
    // `padre_id` apunta a una provincia sembrada, no queda suelto.
    const idsProvincia = new Set(
      [...prisma.filas.values()].filter((f) => f.nivel === 1).map((f) => f.id),
    );
    expect(municipios.every((m) => idsProvincia.has(m.padreId))).toBe(true);
    expect(municipios.every((m) => m.paisCodigo === 'DO')).toBe(true);
  });

  it('correrlo dos veces no duplica filas', async () => {
    const prisma = prismaFalso();

    const primera = await sembrarDivisionesDO(prisma as any);
    const totalPrimera = prisma.filas.size;
    const segunda = await sembrarDivisionesDO(prisma as any);

    expect(prisma.filas.size).toBe(totalPrimera);
    expect(segunda.provincias).toBe(primera.provincias);
    expect(segunda.municipios).toBe(primera.municipios);
  });

  it('la migración crea la tabla y su índice único, y solo añade', () => {
    const sql = sinComentarios(sqlDeDivisiones()).replace(/"/g, '').toUpperCase();
    expect(sql.length > 0 ? '' : 'no se encontró migración de divisiones').toBe('');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS DIVISIONES_ADMINISTRATIVAS');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS UK_DIVISIONES_PAIS_NIVEL_NOMBRE\s+ON DIVISIONES_ADMINISTRATIVAS\s*\(\s*PAIS_CODIGO\s*,\s*NIVEL\s*,\s*NOMBRE\s*\)/,
    );
    expect(sql).toContain('REFERENCES DIVISIONES_ADMINISTRATIVAS(ID)');

    const prohibidos = [
      [/\bDROP\s+/, 'DROP'],
      [/\bTRUNCATE\b/, 'TRUNCATE'],
      [/\bDELETE\s+FROM\b/, 'DELETE FROM'],
    ].filter(([patron]) => (patron as RegExp).test(sql));
    expect(prohibidos.map(([, nombre]) => nombre)).toEqual([]);
  });
});
