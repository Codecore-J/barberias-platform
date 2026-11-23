#!/usr/bin/env node
/**
 * T-22 · auditoría de SOLO LECTURA de la migración `descripcion_servicio`.
 *
 * Ejecuta la migración dentro de una transacción y la revierte con un error
 * intencional: no persiste nada, pero permite comprobar que la columna queda con
 * el tipo y la nulabilidad esperados y que ninguna fila de `servicios` se pierde.
 *
 * Uso: node scripts/t22-auditoria-produccion.mjs <archivo-env>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cargarEnv(archivo) {
  const ruta = path.isAbsolute(archivo) ? archivo : path.join(RAIZ, archivo);
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
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

const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x), 2);

async function main() {
  cargarEnv(process.argv[2] ?? '.env');
  const url = new URL(process.env.DATABASE_URL);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    console.log(`# objetivo: host=${url.hostname} db=${url.pathname.slice(1)}`);

    const antes = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM servicios) AS servicios,
        (SELECT count(*) FROM information_schema.columns
         WHERE table_name='servicios' AND column_name='descripcion') AS tiene_columna
    `);
    console.log('## antes', json(antes));

    const sql = fs.readFileSync(
      path.join(RAIZ, 'prisma', 'migrations', '20261123190000_descripcion_servicio', 'migration.sql'),
      'utf8',
    );
    const sentencias = sql
      .split(/;\s*(?:\r?\n|\s*$)/)
      .map((s) => s.trim())
      .filter((s) => s && s.replace(/^--[^\n]*\n/gm, '').trim() !== '');

    let despues = null;
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const [i, sentencia] of sentencias.entries()) {
            try {
              await tx.$executeRawUnsafe(sentencia);
            } catch (e) {
              throw new Error(`sentencia ${i + 1} falló: ${e.message}`);
            }
          }
          despues = await tx.$queryRawUnsafe(`
            SELECT
              c.data_type,
              c.character_maximum_length,
              c.is_nullable,
              (SELECT count(*) FROM servicios) AS servicios,
              (SELECT count(*) FROM servicios WHERE descripcion IS NOT NULL) AS con_descripcion
            FROM information_schema.columns c
            WHERE c.table_name='servicios' AND c.column_name='descripcion'
          `);
          throw new Error('__ROLLBACK_INTENCIONAL__');
        },
        { timeout: 60000, maxWait: 20000 },
      );
    } catch (e) {
      if (!/__ROLLBACK_INTENCIONAL__/.test(e.message)) throw e;
    }

    console.log('## después (dentro de la transacción revertida)', json(despues));

    const rollback = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM servicios) AS servicios,
        (SELECT count(*) FROM information_schema.columns
         WHERE table_name='servicios' AND column_name='descripcion') AS columna_residual
    `);
    console.log('## tras el ROLLBACK', json(rollback));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[auditoría T-22] ERROR:', e.message);
  process.exit(1);
});
