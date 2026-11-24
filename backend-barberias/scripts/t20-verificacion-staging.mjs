#!/usr/bin/env node
/**
 * T-20 · segunda pasada de la migración `categorias_globales` por STAGING.
 *
 * El rol de aplicación no es dueño de las tablas de `public` (ni puede crear
 * esquemas), así que la prueba se hace sobre tablas TEMPORALES: se crean copias
 * de `barberias`, `usuarios`, `categorias_servicio` y `servicios_barbero` en su
 * forma PREVIA a la migración dentro de `pg_temp` y se ejecuta el SQL de la
 * migración con `pg_temp` primero en el `search_path`. Todo va dentro de una
 * transacción que se revierte y, además, las temporales mueren con la sesión.
 *
 * Uso: node scripts/t20-verificacion-staging.mjs <archivo-env>
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
    process.env[m[1]] = valor;
  }
}

const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x), 2);

// Ids fijos del catálogo de prueba, para poder afirmar quién sobrevive.
const C = {
  cortesVieja: 'a0000000-0000-4000-8000-000000000001', // 0 servicios, más antigua
  cortesUsada: 'a0000000-0000-4000-8000-000000000002', // 2 servicios, más nueva
  barbaInactiva: 'a0000000-0000-4000-8000-000000000003', // inactiva, más antigua
  barbaActiva: 'a0000000-0000-4000-8000-000000000004', // activa, más nueva
  tinteInactiva: 'a0000000-0000-4000-8000-000000000005', // inactiva pero CON servicio
  tinteActiva: 'a0000000-0000-4000-8000-000000000006', // activa, sin servicios
};

const sentencias = fs
  .readFileSync(
    path.join(RAIZ, 'prisma', 'migrations', '20261123170000_categorias_globales', 'migration.sql'),
    'utf8',
  )
  .split(/;\s*(?:\r?\n|\s*$)/)
  .map((s) => s.trim())
  .filter((s) => s && s.replace(/^--[^\n]*\n/gm, '').trim());

async function main() {
  const [archivoEnv] = process.argv.slice(2);
  if (!archivoEnv) {
    console.error('Falta el archivo de entorno.');
    process.exit(1);
  }
  cargarEnv(archivoEnv);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const antes = await prisma.$queryRawUnsafe(`
    SELECT (SELECT count(*) FROM categorias_servicio) AS categorias,
           (SELECT count(*) FROM servicios_barbero) AS servicios_barbero,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='categorias_servicio' AND column_name='orden') AS tiene_orden,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='servicios_barbero' AND column_name='barberia_id') AS sb_tiene_sede
  `);
  console.log('# staging ANTES:', json(antes));

  const fallos = [];
  let dentro = null;

  try {
    await prisma.$transaction(
      async (tx) => {
        const q = (sql) => tx.$executeRawUnsafe(sql);

        await q(`SET LOCAL search_path TO pg_temp, public`);

        // Copias mínimas de las tablas que la migración referencia.
        await q(`CREATE TEMP TABLE "barberias" AS SELECT id, nombre, creado_at FROM public."barberias"`);
        await q(`ALTER TABLE "barberias" ADD PRIMARY KEY (id)`);
        await q(`CREATE TEMP TABLE "usuarios" AS SELECT id, creado_at FROM public."usuarios"`);
        await q(`ALTER TABLE "usuarios" ADD PRIMARY KEY (id)`);
        await q(`
          CREATE TEMP TABLE "categorias_servicio" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "barberia_id" UUID NOT NULL,
            "nombre" VARCHAR(100) NOT NULL,
            "descripcion" TEXT,
            "activa" BOOLEAN NOT NULL DEFAULT true,
            "creado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "actualizado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "categorias_servicio_pkey" PRIMARY KEY ("id")
          )`);
        await q(
          `CREATE UNIQUE INDEX "uk_categoria_sede_nombre" ON "categorias_servicio" ("barberia_id", "nombre")`,
        );
        await q(`
          ALTER TABLE "categorias_servicio" ADD CONSTRAINT "categorias_servicio_barberia_id_fkey"
          FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await q(`
          CREATE TEMP TABLE "servicios_barbero" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "categoria_id" UUID NOT NULL,
            "barbero_id" UUID NOT NULL,
            "nombre_personalizado" VARCHAR(100) NOT NULL,
            "precio" DECIMAL(10,2) NOT NULL,
            "duracion_minutos" INTEGER NOT NULL,
            "activo" BOOLEAN NOT NULL DEFAULT true,
            "creado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "actualizado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "servicios_barbero_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "servicios_barbero_precio_check" CHECK ("precio" >= 0),
            CONSTRAINT "servicios_barbero_duracion_check" CHECK ("duracion_minutos" > 0)
          )`);
        await q(
          `CREATE UNIQUE INDEX "uk_servicio_barbero_categoria_nombre" ON "servicios_barbero" ("barbero_id", "categoria_id", "nombre_personalizado")`,
        );
        await q(`
          ALTER TABLE "servicios_barbero" ADD CONSTRAINT "servicios_barbero_categoria_id_fkey"
          FOREIGN KEY ("categoria_id") REFERENCES "categorias_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE`);
        await q(`
          ALTER TABLE "servicios_barbero" ADD CONSTRAINT "servicios_barbero_barbero_id_fkey"
          FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE`);

        const sedes = await tx.$queryRawUnsafe(
          `SELECT id::text FROM public."barberias" ORDER BY creado_at, id LIMIT 2`,
        );
        if (sedes.length < 2) throw new Error('Staging necesita 2 sedes para la prueba.');
        const barbero = await tx.$queryRawUnsafe(
          `SELECT id::text FROM public."usuarios" ORDER BY creado_at, id LIMIT 1`,
        );
        if (!barbero.length) throw new Error('Staging necesita un usuario para el barbero.');
        const [sedeA, sedeB] = sedes.map((s) => s.id);
        const barberoId = barbero[0].id;

        const categoria = (id, sede, nombre, activa, creado) =>
          tx.$executeRawUnsafe(
            `INSERT INTO "categorias_servicio" ("id","barberia_id","nombre","activa","creado_at")
             VALUES ($1::uuid,$2::uuid,$3,$4,$5::timestamptz)`,
            id,
            sede,
            nombre,
            activa,
            creado,
          );
        const servicio = (categoriaId, nombre) =>
          tx.$executeRawUnsafe(
            `INSERT INTO "servicios_barbero" ("categoria_id","barbero_id","nombre_personalizado","precio","duracion_minutos")
             VALUES ($1::uuid,$2::uuid,$3,25.00,30)`,
            categoriaId,
            barberoId,
            nombre,
          );

        await categoria(C.cortesVieja, sedeA, 'Cortes club', true, '2025-01-01T00:00:00Z');
        await categoria(C.cortesUsada, sedeB, 'Cortes club', true, '2026-01-01T00:00:00Z');
        await categoria(C.barbaInactiva, sedeA, 'Barba', false, '2025-01-01T00:00:00Z');
        await categoria(C.barbaActiva, sedeB, 'Barba', true, '2026-01-01T00:00:00Z');
        await categoria(C.tinteInactiva, sedeA, 'Tinte', false, '2024-01-01T00:00:00Z');
        await categoria(C.tinteActiva, sedeB, 'Tinte', true, '2025-06-01T00:00:00Z');
        await servicio(C.cortesUsada, 'Corte clásico');
        await servicio(C.cortesUsada, 'Corte + barba');
        await servicio(C.tinteInactiva, 'Tinte completo');

        const previo = await tx.$queryRawUnsafe(
          `SELECT (SELECT count(*) FROM "categorias_servicio") AS categorias,
                  (SELECT count(*) FROM "servicios_barbero") AS servicios`,
        );
        console.log('# fixture previo (una fila por sede):', json(previo));

        // --- La migración real ---
        for (const [i, sentencia] of sentencias.entries()) {
          try {
            await tx.$executeRawUnsafe(sentencia);
          } catch (e) {
            throw new Error(`sentencia ${i + 1} falló: ${e.message}\n--- ${sentencia.slice(0, 240)}`);
          }
        }

        const despues = await tx.$queryRawUnsafe(`
          SELECT (SELECT count(*) FROM "categorias_servicio") AS categorias,
                 (SELECT count(*) FROM "categorias_servicio" WHERE barberia_id IS NULL) AS globales,
                 (SELECT count(*) FROM "categorias_servicio" WHERE barberia_id IS NOT NULL) AS con_sede,
                 (SELECT count(DISTINCT orden) FROM "categorias_servicio") AS ordenes,
                 (SELECT count(*) FROM "servicios_barbero") AS servicios,
                 (SELECT count(*) FROM "servicios_barbero" WHERE barberia_id IS NOT NULL) AS sb_con_sede,
                 (SELECT count(*) FROM "servicios_barbero" sb
                    LEFT JOIN "categorias_servicio" c ON c.id = sb.categoria_id
                    WHERE c.id IS NULL) AS sb_huerfanos,
                 (SELECT count(*) FROM pg_indexes WHERE schemaname LIKE 'pg_temp%' AND indexname='uk_categoria_global_nombre') AS indice_global,
                 (SELECT count(*) FROM pg_indexes WHERE schemaname LIKE 'pg_temp%' AND indexname='idx_servicios_barbero_sede') AS indice_sede
        `);
        const filas = await tx.$queryRawUnsafe(
          `SELECT id::text, nombre, orden, activa FROM "categorias_servicio" ORDER BY orden`,
        );
        const servicios = await tx.$queryRawUnsafe(
          `SELECT nombre_personalizado, categoria_id::text, barberia_id::text FROM "servicios_barbero" ORDER BY nombre_personalizado`,
        );
        dentro = { despues, filas, servicios };
        throw new Error('__ROLLBACK_INTENCIONAL__');
      },
      { timeout: 120000, maxWait: 20000 },
    );
  } catch (e) {
    if (!/__ROLLBACK_INTENCIONAL__/.test(e.message)) {
      console.error('[staging] ERROR:', e.message);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  console.log('# DESPUÉS de la migración (dentro de la transacción, revertida):');
  console.log(json(dentro?.despues));
  for (const f of dentro?.filas ?? []) console.log(`  - ${f.orden} · ${f.nombre} (${f.id}) activa=${f.activa}`);
  for (const s of dentro?.servicios ?? []) {
    console.log(`  * ${s.nombre_personalizado} -> categoría ${s.categoria_id} · sede ${s.barberia_id}`);
  }

  const comprobar = (nombre, condicion) => {
    if (!condicion) fallos.push(nombre);
  };
  const sobrevive = (id) => (dentro?.filas ?? []).some((f) => f.id === id);
  const muere = (id) => !sobrevive(id);
  const d = dentro?.despues?.[0] ?? {};

  comprobar('Queda una fila por nombre (3)', Number(d.categorias) === 3);
  comprobar(
    'Sobrevive la de MÁS servicios y no la más antigua (Cortes club)',
    sobrevive(C.cortesUsada) && muere(C.cortesVieja),
  );
  comprobar(
    'Empate a cero servicios: sobrevive la activa (Barba)',
    sobrevive(C.barbaActiva) && muere(C.barbaInactiva),
  );
  comprobar(
    'Los servicios pesan más que «activa» y la antigüedad (Tinte)',
    sobrevive(C.tinteInactiva) && muere(C.tinteActiva),
  );
  comprobar('Todas las supervivientes quedan globales', Number(d.globales) === 3 && Number(d.con_sede) === 0);
  comprobar('Ningún servicio se pierde', Number(d.servicios) === 3);
  comprobar('Cada servicio conserva su sede', Number(d.sb_con_sede) === 3);
  comprobar('Sin vínculos rotos', Number(d.sb_huerfanos) === 0);
  comprobar('Índice único global creado', Number(d.indice_global) === 1);
  comprobar('Índice de sede del servicio creado', Number(d.indice_sede) === 1);
  comprobar('orden 0..2 sin huecos', Number(d.ordenes) === 3);

  const despuesRollback = await prisma.$queryRawUnsafe(`
    SELECT (SELECT count(*) FROM categorias_servicio) AS categorias,
           (SELECT count(*) FROM servicios_barbero) AS servicios_barbero,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='categorias_servicio' AND column_name='orden') AS tiene_orden,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='servicios_barbero' AND column_name='barberia_id') AS sb_tiene_sede
  `);
  console.log('# staging DESPUÉS del ROLLBACK:', json(despuesRollback));

  const r = despuesRollback[0];
  if (
    Number(r.categorias) !== Number(antes[0].categorias) ||
    Number(r.servicios_barbero) !== Number(antes[0].servicios_barbero) ||
    r.tiene_orden !== antes[0].tiene_orden ||
    r.sb_tiene_sede !== antes[0].sb_tiene_sede
  ) {
    fallos.push('Staging no quedó como estaba tras el ROLLBACK');
  }

  await prisma.$disconnect();

  if (fallos.length) {
    console.error('\n[staging] FALLÓ:');
    for (const f of fallos) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log('\n[staging] OK · la migración pasó y la base quedó intacta (ROLLBACK).');
}

main().catch((e) => {
  console.error('[staging] ERROR:', e.message);
  process.exit(1);
});
