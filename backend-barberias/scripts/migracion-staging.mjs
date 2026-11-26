#!/usr/bin/env node
/**
 * F6 · ensayo de una migración en STAGING con auditoría dentro de una
 * transacción que SIEMPRE termina en ROLLBACK.
 *
 * Antes de tocar la base: aplica el SQL de la migración, audita el resultado
 * (columnas, tipos, nulabilidad, filas y que ninguna fila haya cambiado) y
 * revierte. Si algo no cuadra, el proceso termina sin haber cambiado nada.
 *
 * Uso: node scripts/migracion-staging.mjs <archivo-env-de-staging> <carpeta-migración>
 *      node scripts/migracion-staging.mjs .env.staging-owner 20261126150000_f604_logo_public_id_sede
 *
 * Nunca imprime la cadena de conexión ni el host: solo si el destino pasó la
 * comprobación de seguridad.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO_ENV = process.argv[2];
const CARPETA = process.argv[3];

/**
 * Columnas que cada migración debe dejar en `barberias`, con su tipo y tamaño
 * esperados. Añadir una migración aquí es parte de ensayarla.
 */
const MIGRACIONES = {
  '20261126140000_f601_ubicacion_sede': [
    { columna: 'latitud', tipo: 'numeric', precision: '10', escala: '7' },
    { columna: 'longitud', tipo: 'numeric', precision: '10', escala: '7' },
    { columna: 'pais_codigo', tipo: 'character varying', largo: 2 },
    { columna: 'division_nivel1', tipo: 'character varying', largo: 100 },
    { columna: 'division_nivel2', tipo: 'character varying', largo: 100 },
    { columna: 'direccion_completa', tipo: 'character varying', largo: 300 },
  ],
  '20261126150000_f604_logo_public_id_sede': [
    { columna: 'logo_public_id', tipo: 'character varying', largo: 255 },
  ],
};

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

/**
 * Puerta de seguridad: este ensayo SOLO corre contra staging. El archivo de
 * entorno lo dice en el nombre y el host no puede parecer producción.
 */
function exigirStaging() {
  if (!/staging/i.test(path.basename(ARCHIVO_ENV))) {
    throw new Error(
      `El archivo de entorno debe ser de staging (recibido: ${path.basename(ARCHIVO_ENV)}).`,
    );
  }
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/.*@([^/]+)\/.*/, '$1');
  if (!host) throw new Error('DATABASE_URL no está definida en ese archivo.');
  if (/prod|production/i.test(host)) {
    throw new Error('El host del entorno parece producción: aborto por seguridad.');
  }
}

async function columnas(prisma, nombres) {
  return prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'barberias'
        AND column_name = ANY($1::text[])
      ORDER BY column_name`,
    nombres,
  );
}

/** Antes de migrar solo se puede contar lo que ya existe: `sedes`. */
async function contarSedes(prisma) {
  const [fila] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS sedes FROM barberias',
  );
  return fila;
}

async function main() {
  if (!ARCHIVO_ENV || !CARPETA) {
    throw new Error(
      'Uso: node scripts/migracion-staging.mjs <archivo-env-de-staging> <carpeta-migración>',
    );
  }

  const esperadas = MIGRACIONES[CARPETA];
  if (!esperadas) {
    throw new Error(
      `La migración ${CARPETA} no está registrada en MIGRACIONES: añade sus columnas esperadas antes de ensayarla.`,
    );
  }

  cargarEnv(ARCHIVO_ENV);
  exigirStaging();

  const prisma = new PrismaClient();

  try {
    console.log(`Ensayo de ${CARPETA} contra staging (env: ${path.basename(ARCHIVO_ENV)}).`);

    const antes = await contarSedes(prisma);
    const columnasAntes = await columnas(
      prisma,
      esperadas.map((c) => c.columna),
    );
    console.log('ANTES ·', JSON.stringify({ ...antes, columnas_nuevas: columnasAntes.length }));

    try {
      await prisma.$transaction(
        async (tx) => {
          const sql = fs.readFileSync(
            path.join(RAIZ, 'prisma', 'migrations', CARPETA, 'migration.sql'),
            'utf8',
          );
          await tx.$executeRawUnsafe(sql);

          const despuesColumnas = await columnas(
            tx,
            esperadas.map((c) => c.columna),
          );
          const despues = await contarSedes(tx);

          console.log('AUDITORÍA dentro de la transacción:');
          console.log('  columnas:', JSON.stringify(despuesColumnas));
          console.log('  sedes:', JSON.stringify(despues));

          const problemas = [];
          for (const esperada of esperadas) {
            const real = despuesColumnas.find((c) => c.column_name === esperada.columna);
            if (!real) {
              problemas.push(`${esperada.columna}: no existe`);
              continue;
            }
            if (real.data_type !== esperada.tipo) {
              problemas.push(`${esperada.columna}: tipo ${real.data_type} ≠ ${esperada.tipo}`);
            }
            if (esperada.largo !== undefined && real.character_maximum_length !== esperada.largo) {
              problemas.push(
                `${esperada.columna}: largo ${real.character_maximum_length} ≠ ${esperada.largo}`,
              );
            }
            if (esperada.precision && String(real.numeric_precision) !== esperada.precision) {
              problemas.push(
                `${esperada.columna}: precisión ${real.numeric_precision} ≠ ${esperada.precision}`,
              );
            }
            if (esperada.escala && String(real.numeric_scale) !== esperada.escala) {
              problemas.push(
                `${esperada.columna}: escala ${real.numeric_scale} ≠ ${esperada.escala}`,
              );
            }
            if (real.is_nullable !== 'YES') {
              problemas.push(`${esperada.columna}: debería ser NULLABLE`);
            }
          }
          if (despues.sedes !== antes.sedes) {
            problemas.push(`se perdieron o crearon sedes: ${antes.sedes} → ${despues.sedes}`);
          }
          if (problemas.length > 0) {
            throw new Error(`Auditoría fallida: ${problemas.join('; ')}`);
          }

          // La auditoría pasó: se revierte a propósito, aún no es el momento de
          // dejar el cambio aplicado.
          throw new Error('ROLLBACK_DE_AUDITORIA');
        },
        { timeout: 120_000 },
      );
    } catch (error) {
      if (error.message !== 'ROLLBACK_DE_AUDITORIA') throw error;
    }

    const columnasDespues = await columnas(
      prisma,
      esperadas.map((c) => c.columna),
    );
    const despues = await contarSedes(prisma);
    console.log(
      'DESPUÉS DEL ROLLBACK ·',
      JSON.stringify({ ...despues, columnas_nuevas: columnasDespues.length }),
    );

    if (columnasDespues.length !== columnasAntes.length) {
      throw new Error('El ROLLBACK no dejó la base como estaba: revisa la transacción.');
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
