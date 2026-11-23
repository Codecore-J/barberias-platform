#!/usr/bin/env node
/**
 * T-20 · auditoría de SOLO LECTURA de la migración `categorias_globales`.
 *
 * Uso:
 *   node scripts/t20-auditoria-produccion.mjs <archivo-env> identidad
 *   node scripts/t20-auditoria-produccion.mjs <archivo-env> analisis
 *   node scripts/t20-auditoria-produccion.mjs <archivo-env> dry-run
 *
 * `dry-run` ejecuta la migración dentro de una transacción y la revierte con un
 * error intencional (ROLLBACK): no persiste nada, pero permite medir el estado
 * posterior. Después comprueba que la base quedó exactamente como estaba.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cargarEnv(archivo) {
  const ruta = path.isAbsolute(archivo) ? archivo : path.join(RAIZ, archivo);
  if (!fs.existsSync(ruta)) throw new Error(`No existe ${archivo}`);
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

const n = (v) => Number(v);
const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x), 2);

async function main() {
  const [archivoEnv, modo] = process.argv.slice(2);
  if (!archivoEnv || !modo) {
    console.error('Faltan argumentos: <archivo-env> <identidad|analisis|dry-run>');
    process.exit(1);
  }
  cargarEnv(archivoEnv);
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el entorno.');

  const url = new URL(process.env.DATABASE_URL);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    console.log(`# objetivo: host=${url.hostname} db=${url.pathname.slice(1)}`);

    const meta = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM categorias_servicio) AS categorias,
        (SELECT count(*) FROM servicios_barbero) AS servicios_barbero,
        (SELECT count(*) FROM servicios) AS servicios,
        (SELECT count(*) FROM barberias) AS barberias,
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='categorias_servicio' AND column_name='orden') AS tiene_orden,
        (SELECT is_nullable FROM information_schema.columns
         WHERE table_name='categorias_servicio' AND column_name='barberia_id') AS barberia_id_nullable,
        (SELECT max(migration_name) FROM _prisma_migrations
         WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL) AS ultima_migracion
    `);
    console.log('# identidad:', json(meta));

    if (modo === 'identidad') return;

    // 1) Todas las categorías con su sede y cuántos servicios cuelgan de ellas.
    const filas = await prisma.$queryRawUnsafe(`
      SELECT c.id::text, c.nombre, c.activa, c.barberia_id::text, b.nombre AS sede, c.creado_at,
             (SELECT count(*) FROM servicios_barbero sb WHERE sb.categoria_id = c.id) AS servicios
      FROM categorias_servicio c
      LEFT JOIN barberias b ON b.id = c.barberia_id
      ORDER BY lower(btrim(c.nombre)), c.activa DESC, c.creado_at, c.id
    `);
    console.log('\n## A. categorías actuales (', filas.length, ')');
    for (const f of filas) {
      console.log(
        `- ${f.nombre} | sede=${f.sede ?? 'GLOBAL(NULL)'} | activa=${f.activa} | creada=${f.creado_at?.toISOString?.() ?? f.creado_at} | servicios=${n(f.servicios)} | id=${f.id}`,
      );
    }

    // 2) Mapa de fusión tal cual lo calcula la migración.
    const mapa = await prisma.$queryRawUnsafe(`
      WITH d AS (
        SELECT id,
               first_value(id) OVER (
                 PARTITION BY lower(btrim(nombre))
                 ORDER BY servicios DESC, activa DESC, creado_at ASC, id ASC
               ) AS destino
        FROM (
          SELECT c.id, c.nombre, c.activa, c.creado_at,
                 (SELECT count(*) FROM servicios_barbero sb WHERE sb.categoria_id = c.id) AS servicios
          FROM categorias_servicio c
          WHERE c.nombre IS NOT NULL AND btrim(c.nombre) <> ''
        ) AS candidatas
      )
      SELECT c.id::text AS borrada_id, c.nombre AS borrada_nombre,
             b.nombre AS borrada_sede, c.activa AS borrada_activa,
             d.destino::text AS destino_id,
             cd.nombre AS destino_nombre, bd.nombre AS destino_sede,
             cd.activa AS destino_activa,
             (SELECT string_agg(sb.nombre_personalizado || ' (' || sb.precio || ')', ', ')
              FROM servicios_barbero sb WHERE sb.categoria_id = c.id) AS servicios_reasignados
      FROM d
      JOIN categorias_servicio c ON c.id = d.id
      LEFT JOIN barberias b ON b.id = c.barberia_id
      LEFT JOIN categorias_servicio cd ON cd.id = d.destino
      LEFT JOIN barberias bd ON bd.id = cd.barberia_id
      WHERE d.id <> d.destino
      ORDER BY lower(btrim(c.nombre)), c.activa DESC, c.creado_at, c.id
    `);
    console.log('\n## B. filas que la migración BORRA (', mapa.length, ')');
    for (const m of mapa) {
      console.log(
        `- «${m.borrada_nombre}» | sede=${m.borrada_sede ?? 'GLOBAL(NULL)'} | activa=${m.borrada_activa} -> destino «${m.destino_nombre}» (sede=${m.destino_sede ?? 'GLOBAL'} , activa=${m.destino_activa}) | servicios=${m.servicios_reasignados ?? '—'}`,
      );
    }

    const supervivientes = await prisma.$queryRawUnsafe(`
      WITH d AS (
        SELECT id, first_value(id) OVER (
          PARTITION BY lower(btrim(nombre))
          ORDER BY servicios DESC, activa DESC, creado_at ASC, id ASC
        ) AS destino
        FROM (
          SELECT c.id, c.nombre, c.activa, c.creado_at,
                 (SELECT count(*) FROM servicios_barbero sb WHERE sb.categoria_id = c.id) AS servicios
          FROM categorias_servicio c
          WHERE c.nombre IS NOT NULL AND btrim(c.nombre) <> ''
        ) AS candidatas
      )
      SELECT c.nombre, b.nombre AS sede, c.activa, c.id::text,
             (SELECT count(*) FROM servicios_barbero sb WHERE sb.categoria_id = c.id) AS servicios
      FROM categorias_servicio c
      JOIN d ON d.id = d.destino AND d.id = c.id
      LEFT JOIN barberias b ON b.id = c.barberia_id
      ORDER BY lower(btrim(c.nombre))
    `);
    console.log('\n## C. supervivientes (', supervivientes.length, ')');
    for (const s of supervivientes) {
      console.log(`- «${s.nombre}» | sede original=${s.sede ?? 'GLOBAL'} | activa=${s.activa} | servicios=${n(s.servicios)}`);
    }

    // 3) Comprobaciones de integridad antes de tocar nada.
    const control = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM categorias_servicio WHERE nombre IS NULL OR btrim(nombre) = '') AS sin_nombre,
        (SELECT count(*) FROM servicios_barbero WHERE categoria_id IS NULL) AS sb_sin_categoria,
        (SELECT count(*) FROM servicios_barbero sb
          LEFT JOIN categorias_servicio c ON c.id = sb.categoria_id
          WHERE c.id IS NULL) AS sb_huerfanos,
        (SELECT count(*) FROM servicios_barbero sb
          JOIN categorias_servicio c ON c.id = sb.categoria_id
          WHERE c.barberia_id IS NULL) AS sb_categoria_sin_sede,
        (SELECT count(*) FROM servicios_barbero WHERE activo) AS sb_activos,
        (SELECT count(*) FROM categorias_servicio WHERE NOT activa) AS categorias_inactivas
    `);
    console.log('\n## D. control previo');
    console.log(json(control));

    const colisiones = await prisma.$queryRawUnsafe(`
      SELECT lower(btrim(regexp_replace(nombre, '\\s+', ' ', 'g'))) AS normalizado,
             count(*) AS filas, string_agg(nombre, ' | ') AS nombres
      FROM categorias_servicio
      WHERE nombre IS NOT NULL AND btrim(nombre) <> ''
      GROUP BY 1 HAVING count(*) > 1
      ORDER BY 1
    `);
    console.log('\n## E. nombres que siguen colisionando con la normalización del índice (', colisiones.length, ')');
    for (const c of colisiones) console.log(`- ${c.normalizado}: ${n(c.filas)} -> ${c.nombres}`);

    const spaced = await prisma.$queryRawUnsafe(`
      SELECT nombre, lower(btrim(nombre)) AS laxa,
             lower(btrim(regexp_replace(nombre, '\\s+', ' ', 'g'))) AS estricta
      FROM categorias_servicio
      WHERE nombre <> btrim(regexp_replace(nombre, '\\s+', ' ', 'g'))
         OR nombre LIKE '%  %' OR btrim(nombre) <> nombre
      ORDER BY nombre
    `);
    console.log('\n## F. nombres con espacios raros (', spaced.length, ')');
    for (const s of spaced) console.log(`- «${s.nombre}» | laxa=«${s.laxa}» | estricta=«${s.estricta}»`);

    if (modo === 'analisis') return;

    // 4) Dry-run: la migración real, dentro de una transacción que se revierte.
    const sql = fs.readFileSync(
      path.join(RAIZ, 'prisma', 'migrations', '20261123170000_categorias_globales', 'migration.sql'),
      'utf8',
    );
    const sentencias = sql
      .split(/;\s*(?:\r?\n|\s*$)/)
      .map((s) => s.trim())
      .filter((s) => s && !/^--/.test(s.replace(/^--[^\n]*\n/gm, '').trim()) && s.replace(/^--[^\n]*\n/gm, '').trim());

    const medidas = {};
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const [i, sentencia] of sentencias.entries()) {
            try {
              await tx.$executeRawUnsafe(sentencia);
            } catch (e) {
              throw new Error(`sentencia ${i + 1} falló: ${e.message}\n--- ${sentencia.slice(0, 200)}`);
            }
          }
          medidas.despues = await tx.$queryRawUnsafe(`
            SELECT
              (SELECT count(*) FROM categorias_servicio) AS categorias,
              (SELECT count(*) FROM categorias_servicio WHERE barberia_id IS NULL) AS globales,
              (SELECT count(*) FROM categorias_servicio WHERE barberia_id IS NOT NULL) AS con_sede,
              (SELECT count(DISTINCT orden) FROM categorias_servicio) AS ordenes_distintos,
              (SELECT min(orden) FROM categorias_servicio) AS orden_min,
              (SELECT max(orden) FROM categorias_servicio) AS orden_max,
              (SELECT count(*) FROM servicios_barbero) AS servicios_barbero,
              (SELECT count(*) FROM servicios_barbero WHERE barberia_id IS NOT NULL) AS sb_con_sede,
              (SELECT count(*) FROM servicios_barbero sb
                 LEFT JOIN categorias_servicio c ON c.id = sb.categoria_id
                 WHERE c.id IS NULL) AS sb_apuntando_a_borrada,
              (SELECT count(*) FROM servicios_barbero sb
                 JOIN categorias_servicio c ON c.id = sb.categoria_id
                 WHERE c.barberia_id IS NOT NULL) AS sb_categoria_con_sede,
              (SELECT count(*) FROM pg_indexes WHERE indexname='uk_categoria_global_nombre') AS indice_global,
              (SELECT count(*) FROM pg_indexes WHERE indexname='idx_servicios_barbero_sede') AS indice_sede,
              (SELECT count(*) FROM pg_constraint WHERE conname='servicios_barbero_barberia_id_fkey') AS fk_sede
          `);
          medidas.categorias = await tx.$queryRawUnsafe(
            `SELECT nombre, orden, activa FROM categorias_servicio ORDER BY orden, nombre`,
          );
          medidas.servicios = await tx.$queryRawUnsafe(`
            SELECT sb.nombre_personalizado, c.nombre AS categoria, b.nombre AS sede, sb.activo
            FROM servicios_barbero sb
            JOIN categorias_servicio c ON c.id = sb.categoria_id
            LEFT JOIN barberias b ON b.id = sb.barberia_id
          `);
          medidas.huerfanos = await tx.$queryRawUnsafe(`
            SELECT count(*) AS vinculos_rotos FROM servicios_barbero sb
            LEFT JOIN categorias_servicio c ON c.id = sb.categoria_id WHERE c.id IS NULL
          `);
          throw new Error('__ROLLBACK_INTENCIONAL__');
        },
        { timeout: 60000, maxWait: 20000 },
      );
    } catch (e) {
      if (!/__ROLLBACK_INTENCIONAL__/.test(e.message)) throw e;
    }

    console.log('\n## G. estado DESPUÉS de la migración (medido dentro de la transacción, revertida)');
    console.log(json(medidas.despues));
    console.log('categorías resultantes (orden):');
    for (const c of medidas.categorias ?? []) console.log(`- ${c.orden} · ${c.nombre}${c.activa ? '' : ' (inactiva)'}`);
    console.log('servicios de barbero resultantes:');
    for (const s of medidas.servicios ?? []) console.log(`- ${s.nombre_personalizado} | ${s.categoria} | ${s.sede} | activo=${s.activo}`);
    console.log('vínculos rotos:', json(medidas.huerfanos));

    const verificación = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM categorias_servicio) AS categorias,
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='categorias_servicio' AND column_name='orden') AS tiene_orden,
        (SELECT count(*) FROM information_schema.columns
         WHERE table_name='servicios_barbero' AND column_name='barberia_id') AS columna_sede_en_servicios,
        (SELECT count(*) FROM information_schema.tables
         WHERE table_name='_tmp_categoria_global') AS tabla_temporal_residual,
        (SELECT count(*) FROM pg_indexes WHERE indexname='uk_categoria_global_nombre') AS indice_global_residual,
        (SELECT count(*) FROM servicios_barbero) AS servicios_barbero
    `);
    console.log('\n## H. producción después del ROLLBACK');
    console.log(json(verificación));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[auditoría] ERROR:', e.message);
  process.exit(1);
});
