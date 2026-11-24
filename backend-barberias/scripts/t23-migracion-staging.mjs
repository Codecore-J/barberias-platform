#!/usr/bin/env node
/**
 * T-23 / T-24 · ensayo de migración en STAGING con auditoría dentro de ROLLBACK.
 *
 * Antes de tocar la base, aplica el SQL de las dos migraciones dentro de una
 * transacción, audita el resultado (columna, tipo, filas y valores) y revierte:
 * si algo no cuadra, el proceso termina sin haber cambiado nada.
 *
 * Uso: node scripts/t23-migracion-staging.mjs [archivo-env]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO_ENV = process.argv[2] ?? '.env';

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

const MIGRACIONES = [
  ['T-23', '20261124100000_descripcion_servicio_barbero'],
  ['T-24', '20261124110000_imagen_servicio_barbero'],
];

async function columnas(prisma, nombres) {
  return prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, character_maximum_length, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'servicios_barbero'
        AND column_name = ANY($1::text[])
      ORDER BY column_name`,
    nombres,
  );
}

async function contarFilas(prisma) {
  const [fila] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS filas FROM servicios_barbero',
  );
  return fila;
}

// Solo después del ALTER: antes las columnas no existen y la consulta falla.
async function retratoNuevas(prisma) {
  const [fila] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS filas,
            COUNT(descripcion)::int AS con_descripcion,
            COUNT(imagen_url)::int AS con_imagen
       FROM servicios_barbero`,
  );
  return fila;
}

async function main() {
  cargarEnv(ARCHIVO_ENV);

  const host = (process.env.DATABASE_URL ?? '').replace(/.*@([^/]+)\/.*/, '$1');
  if (!host || host.includes('neon.tech') === false) {
    throw new Error(`Este ensayo es solo para staging (Neon). Host detectado: ${host || 'ninguno'}`);
  }
  if (/prod|production/i.test(host)) {
    throw new Error(`El host «${host}» parece producción: aborto por seguridad.`);
  }

  const prisma = new PrismaClient();

  try {
    console.log(`Ensayo en ${host} (env: ${ARCHIVO_ENV})`);
    const antes = await contarFilas(prisma);
    const columnasAntes = await columnas(prisma, ['descripcion', 'imagen_url']);
    console.log('ANTES · filas:', antes, '· columnas nuevas:', columnasAntes.length);

    try {
      await prisma.$transaction(
        async (tx) => {
          for (const [, carpeta] of MIGRACIONES) {
            const sql = fs.readFileSync(
              path.join(RAIZ, 'prisma', 'migrations', carpeta, 'migration.sql'),
              'utf8',
            );
            await tx.$executeRawUnsafe(sql);
          }

          const despuesColumnas = await columnas(tx, ['descripcion', 'imagen_url']);
          const despues = await retratoNuevas(tx);

          console.log('AUDITORÍA dentro de la transacción:');
          console.log('  columnas:', JSON.stringify(despuesColumnas));
          console.log('  filas:', JSON.stringify(despues));

          const descripcion = despuesColumnas.find((c) => c.column_name === 'descripcion');
          const imagen = despuesColumnas.find((c) => c.column_name === 'imagen_url');
          const problemas = [];
          if (descripcion?.character_maximum_length !== 500) {
            problemas.push('descripcion no es VARCHAR(500)');
          }
          if (imagen?.character_maximum_length !== 500) {
            problemas.push('imagen_url no es VARCHAR(500)');
          }
          if (despues.filas !== antes.filas) {
            problemas.push(`se perdieron/crearon filas: ${antes.filas} → ${despues.filas}`);
          }
          if (despues.con_descripcion !== 0 || despues.con_imagen !== 0) {
            problemas.push('las columnas nuevas no nacieron vacías');
          }
          if (problemas.length > 0) {
            throw new Error(`Auditoría fallida: ${problemas.join('; ')}`);
          }

          // No hay nada más que probar: se revierte a propósito.
          throw new Error('ROLLBACK_DE_AUDITORIA');
        },
        { timeout: 120_000 },
      );
    } catch (error) {
      if (error.message !== 'ROLLBACK_DE_AUDITORIA') throw error;
    }

    const columnasDespues = await columnas(prisma, ['descripcion', 'imagen_url']);
    const despues = await contarFilas(prisma);
    console.log('DESPUÉS DEL ROLLBACK · columnas nuevas:', columnasDespues.length, '· filas:', despues);
    if (columnasDespues.length !== 0) {
      throw new Error('El ROLLBACK no revirtió las columnas: revisa la transacción.');
    }
    console.log('Ensayo OK: auditoría pasada y base intacta.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('ENSAYO FALLÓ:', error.message);
  process.exitCode = 1;
});
