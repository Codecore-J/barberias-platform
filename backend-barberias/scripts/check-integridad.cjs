#!/usr/bin/env node
/**
 * Sprint de estabilización · guardia de integridad (H37 / H49 / H50).
 *
 * Comprueba DOS cosas que las herramientas habituales no cubren:
 *
 *  1. `prisma migrate diff` NO modela los `CHECK`: el esquema puede estar
 *     desincronizado de la base sin que Prisma diga nada. Aquí se comparan los
 *     CHECK declarados en `prisma/migrations/**` con los que tiene la base
 *     (contra `pg_constraint`), en las dos direcciones.
 *  2. El ledger `_prisma_migrations` puede tener filas de migraciones que no
 *     existen en el repo (H50: una base creada desde cero NO reproducía `dev`).
 *     Se comparan las migraciones aplicadas con los directorios de
 *     `prisma/migrations`, en las dos direcciones.
 *
 * Uso: `npm run check:integridad` (requiere DATABASE_URL apuntando a la base ya
 * migrada; en el CI corre justo después de `prisma migrate deploy`).
 *
 * Sale con 1 y un informe legible si hay cualquier diferencia. No escribe nada.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const DIR_MIGRACIONES = path.join(RAIZ, 'prisma', 'migrations');

/** Carga `.env` sin dependencias: solo para uso local. */
function cargarEnvLocal() {
  if (process.env.DATABASE_URL) return;
  const ruta = path.join(RAIZ, '.env');
  if (!fs.existsSync(ruta)) return;
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let valor = m[2].trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}

/** Migraciones en disco (nombre de directorio = nombre en el ledger). */
function migracionesEnDisco() {
  return fs
    .readdirSync(DIR_MIGRACIONES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Nombres de CHECK declarados en las migraciones del repo. */
function checksDeclarados() {
  const nombres = new Set();
  for (const migracion of migracionesEnDisco()) {
    const directorio = path.join(DIR_MIGRACIONES, migracion);
    for (const archivo of fs.readdirSync(directorio)) {
      if (!archivo.endsWith('.sql')) continue;
      const sql = fs.readFileSync(path.join(directorio, archivo), 'utf8');
      // Tanto `ALTER TABLE ... ADD CONSTRAINT "x_check"` como los declarados
      // dentro de un `CREATE TABLE` siguen el mismo patrón.
      for (const m of sql.matchAll(/CONSTRAINT\s+"([a-zA-Z0-9_]+_check)"/g)) {
        nombres.add(m[1]);
      }
    }
  }
  return [...nombres].sort();
}

/**
 * Esquema contra el que comparar, resuelto desde la propia URL (`?schema=`,
 * por defecto `public`). No se usa `current_schema()` a propósito: con un pooler
 * tipo PgBouncer (Neon) el `search_path` de la sesión puede venir heredado de
 * otro cliente —lo comprobamos durante el sprint—, así que un nombre sin
 * calificar es una lotería. El CLI de Prisma sí califica; nuestro script debe
 * hacer lo mismo.
 */
function esquemaDeLaUrl(url) {
  let esquema = 'public';
  try {
    esquema = new URL(url).searchParams.get('schema') ?? 'public';
  } catch {
    // Una URL no parseable la rechaza antes la propia conexión.
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(esquema)) {
    console.error(`[check:integridad] El parámetro ?schema= no es un nombre válido: «${esquema}».`);
    process.exit(1);
  }

  return esquema;
}

/** Diferencia simétrica de dos conjuntos, como informe legible. */
function diferencias(a, b) {
  const conjuntoB = new Set(b);
  const conjuntoA = new Set(a);
  return {
    soloEnA: a.filter((x) => !conjuntoB.has(x)),
    soloEnB: b.filter((x) => !conjuntoA.has(x)),
  };
}

async function main() {
  cargarEnvLocal();

  if (!process.env.DATABASE_URL) {
    console.error('[check:integridad] Falta DATABASE_URL: no se puede comparar contra la base.');
    process.exit(1);
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const esquema = esquemaDeLaUrl(process.env.DATABASE_URL);
    const esperadas = migracionesEnDisco();
    const [ledger, checksDb] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT migration_name FROM "${esquema}"."_prisma_migrations"
         WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL
         ORDER BY migration_name`,
      ),
      prisma.$queryRawUnsafe(
        `SELECT c.conname AS nombre
         FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE c.contype = 'c' AND n.nspname = $1
         ORDER BY c.conname`,
        esquema,
      ),
    ]);

    const aplicadas = ledger.map((f) => f.migration_name).sort();
    const declarados = checksDeclarados();
    const enBase = checksDb.map((f) => f.nombre).sort();

    const migraciones = diferencias(esperadas, aplicadas);
    const checks = diferencias(declarados, enBase);
    const problemas = [];

    if (migraciones.soloEnA.length || migraciones.soloEnB.length) {
      problemas.push(
        [
          'Migraciones desincronizadas con el ledger:',
          ...migraciones.soloEnA.map((m) => `  · en el repo pero NO aplicada:  ${m}`),
          ...migraciones.soloEnB.map((m) => `  · aplicada pero NO está en el repo (fantasma): ${m}`),
        ].join('\n'),
      );
    }

    if (checks.soloEnA.length || checks.soloEnB.length) {
      problemas.push(
        [
          'CHECK desincronizados entre las migraciones y la base:',
          ...checks.soloEnA.map((c) => `  · declarado en el repo, ausente en la base: ${c}`),
          ...checks.soloEnB.map((c) => `  · existe en la base, sin declarar en el repo: ${c}`),
        ].join('\n'),
      );
    }

    if (problemas.length > 0) {
      console.error('[check:integridad] FALLO\n' + problemas.join('\n\n'));
      process.exit(1);
    }

    console.log(
      `[check:integridad] OK — ${esperadas.length} migraciones y ${declarados.length} CHECK coinciden con el esquema «${esquema}».`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`[check:integridad] Error inesperado: ${e.message}`);
  process.exit(1);
});
