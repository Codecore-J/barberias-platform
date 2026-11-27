import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F6 / T-60 · modelo de ubicación de la sede.
 *
 * Lo que fija esta prueba:
 *  1. `barberias` gana seis columnas: `latitud`, `longitud`, `pais_codigo`,
 *     `division_nivel1`, `division_nivel2` y `direccion_completa`, y el modelo
 *     Prisma las declara con el nombre y el tipo exactos de la base.
 *  2. TODAS son NULLABLES. Las sedes que ya existen se crearon sin coordenadas
 *     y no se tocan: un `NOT NULL` rompería la migración en cuanto haya una
 *     fila previa.
 *  3. La migración es idempotente (`ADD COLUMN IF NOT EXISTS`): la misma base
 *     recibe la columna desde otra migración o desde un ensayo previo y no debe
 *     reventar con «column already exists» (H50).
 *  4. La migración no borra ni reescribe nada: ni `DROP`, ni `TRUNCATE`, ni
 *     `DELETE`, ni `UPDATE`, ni `NOT NULL` sobre las filas existentes.
 *
 * Se escribe ANTES de tocar la base: en rojo falla porque las columnas no
 * existen ni en `schema.prisma` ni en ninguna migración.
 */

const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

/** Columnas tal y como deben quedar en la base y en el modelo. */
const COLUMNAS = [
  { campo: 'latitud', tipo: 'Decimal?', columna: 'latitud', sql: /DECIMAL\(10,\s*7\)/ },
  { campo: 'longitud', tipo: 'Decimal?', columna: 'longitud', sql: /DECIMAL\(10,\s*7\)/ },
  { campo: 'paisCodigo', tipo: 'String?', columna: 'pais_codigo', sql: /VARCHAR\(2\)/ },
  { campo: 'divisionNivel1', tipo: 'String?', columna: 'division_nivel1', sql: /VARCHAR\(100\)/ },
  { campo: 'divisionNivel2', tipo: 'String?', columna: 'division_nivel2', sql: /VARCHAR\(100\)/ },
  { campo: 'direccionCompleta', tipo: 'String?', columna: 'direccion_completa', sql: /VARCHAR\(300\)/ },
] as const;

function modeloBarberia(): string {
  return ESQUEMA.match(/model Barberia \{[\s\S]*?\n\}/)?.[0] ?? '';
}

/**
 * SQL de la migración de ubicación de la sede. Se busca por nombre de carpeta
 * (`f601`/`ubicacion`) para no depender de una marca de tiempo concreta.
 */
function sqlDeUbicacion(): string {
  if (!existsSync(MIGRACIONES)) return '';
  return readdirSync(MIGRACIONES)
    .filter((carpeta) => /f601|ubicacion/i.test(carpeta))
    .map((carpeta) => {
      const archivo = join(MIGRACIONES, carpeta, 'migration.sql');
      return existsSync(archivo) ? readFileSync(archivo, 'utf8') : '';
    })
    .join('\n');
}

/**
 * SQL sin comentarios. Los comentarios documentan el cambio y citan los verbos
 * prohibidos («no hay DROP ni TRUNCATE»), así que auditar el texto crudo daría
 * falsos positivos sobre la propia documentación de la migración.
 */
function sinComentarios(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((linea) => linea.replace(/--.*$/, ''))
    .join('\n');
}

/** Normaliza comillas, espacios y mayúsculas para comparar SQL sin ruido. */
function sqlNormalizado(sql: string): string {
  return sinComentarios(sql)
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

describe('T-60 · el modelo de la sede declara la ubicación', () => {
  it('las seis columnas existen en `model Barberia`', () => {
    const modelo = modeloBarberia();
    expect(
      modelo.length > 0 ? '' : 'no se encontró «model Barberia» en prisma/schema.prisma',
    ).toBe('');

    const ausentes = COLUMNAS.filter(({ campo, tipo, columna }) => {
      const declaracion = new RegExp(
        `^\\s*${campo}\\s+${tipo.replace('?', '\\?')}([^\\n]*)$`,
        'm',
      ).exec(modelo);
      if (!declaracion) return true;

      // El nombre de la columna es el del campo salvo que un `@map` diga otra
      // cosa: `latitud`/`longitud` ya coinciden, `paisCodigo` necesita mapear a
      // `pais_codigo`. Lo que se exige es la COLUMNA, no la anotación.
      const map = /@map\("([^"]+)"\)/.exec(declaracion[1]);
      return map ? map[1] !== columna : campo !== columna;
    }).map(({ campo, columna }) => `${campo} (columna ${columna})`);

    expect(
      ausentes.length === 0 ? '' : `columnas ausentes en el modelo:\n${ausentes.join('\n')}`,
    ).toBe('');
  });

  it('ninguna columna nueva es obligatoria', () => {
    const modelo = modeloBarberia();
    // Un `String` o `Decimal` sin `?` sería NOT NULL: las sedes existentes no
    // tienen coordenadas y la migración no puede rellenarlas.
    const obligatorias = COLUMNAS.filter(({ campo }) => {
      const declaracion = new RegExp(`^\\s*${campo}\\s+(\\S+?)[\\s@]`, 'm');
      const encontrada = declaracion.exec(modelo);
      if (!encontrada) return false;
      return !encontrada[1].endsWith('?');
    }).map(({ campo }) => campo);

    expect(
      obligatorias.length === 0
        ? ''
        : `columnas nuevas obligatorias (deben ser nullables):\n${obligatorias.join('\n')}`,
    ).toBe('');
  });
});

describe('T-60 · la migración añade la ubicación sin tocar datos', () => {
  it('existe una migración que añade las seis columnas con IF NOT EXISTS', () => {
    const sql = sqlNormalizado(sqlDeUbicacion());
    expect(
      sql.length > 0 ? '' : 'no se encontró ninguna migración f601/ubicacion',
    ).toBe('');

    const ausentes = COLUMNAS.filter(({ columna, sql: tipoSql }) => {
      const añadida = new RegExp(
        `ADD COLUMN IF NOT EXISTS ${columna.toUpperCase()} (${tipoSql.source})`,
      );
      return !añadida.test(sql);
    }).map(({ columna }) => columna);

    expect(
      ausentes.length === 0
        ? ''
        : `columnas que la migración no añade de forma idempotente:\n${ausentes.join('\n')}`,
    ).toBe('');
  });

  it('no borra, no trunca y no reescribe filas existentes', () => {
    const sql = sqlNormalizado(sqlDeUbicacion());
    const prohibidos: Array<[RegExp, string]> = [
      [/\bDROP\s+/, 'DROP'],
      [/\bTRUNCATE\b/, 'TRUNCATE'],
      [/\bDELETE\s+FROM\b/, 'DELETE FROM'],
      [/\bUPDATE\s+[A-Z_]+\s+SET\b/, 'UPDATE ... SET'],
      [/ALTER COLUMN [A-Z_]+ SET NOT NULL/, 'SET NOT NULL'],
    ];

    const encontrados = prohibidos
      .filter(([patron]) => patron.test(sql))
      .map(([, nombre]) => nombre);

    expect(
      encontrados.length === 0
        ? ''
        : `operaciones destructivas en la migración de ubicación:\n${encontrados.join('\n')}`,
    ).toBe('');
  });

  it('las columnas nacen sin valor: no se inventan coordenadas para las sedes existentes', () => {
    const sql = sqlNormalizado(sqlDeUbicacion());
    // `DEFAULT` en coordenadas crearía sedes «ubicadas» en un punto inventado.
    const conDefault = COLUMNAS.filter(({ columna }) => {
      const patron = new RegExp(`ADD COLUMN IF NOT EXISTS ${columna.toUpperCase()} [^,;]*DEFAULT`);
      return patron.test(sql);
    }).map(({ columna }) => columna);

    expect(
      conDefault.length === 0
        ? ''
        : `columnas con DEFAULT (no deben tenerlo):\n${conDefault.join('\n')}`,
    ).toBe('');
  });
});
