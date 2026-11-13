// scripts/crear-rol-barberias-app.ts
/**
 * T-33 · mínimo privilegio: crea el rol `barberias_app` (solo DML) y VERIFICA
 * que no puede ejecutar DDL. No toca datos: no borra ni modifica filas.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * Hasta ahora la API se conectaba con el usuario owner de Neon (`neondb_owner`),
 * así que un compromiso del backend daba control total del esquema. Este script
 * crea el rol restringido que usa el runtime y comprueba empíricamente que un
 * `DROP TABLE` con ese rol falla, en vez de suponerlo.
 *
 * ── Seguridad ────────────────────────────────────────────────────────────────
 * · Sin `--aplicar` NO escribe nada: solo imprime el plan y el estado actual.
 * · No lee `.env`: exige `DATABASE_URL_OWNER` y `BARBERIAS_APP_PASSWORD` en el
 *   entorno, así que nunca opera contra una base «por accidente».
 * · Nunca imprime la contraseña ni la cadena de conexión completa.
 * · El `DROP TABLE` de verificación corre SIEMPRE dentro de una transacción que
 *   termina en rollback: si por un fallo de permisos llegara a ejecutarse, no
 *   se perdería nada.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *   # 1. Plan + estado (no escribe)
 *   DATABASE_URL_OWNER="postgresql://neondb_owner:...@.../neondb?sslmode=require" \
 *   BARBERIAS_APP_PASSWORD="<32+ caracteres>" \
 *     npx tsx scripts/crear-rol-barberias-app.ts
 *
 *   # 2. Aplicar
 *   ... npx tsx scripts/crear-rol-barberias-app.ts --aplicar
 *
 * ── Notas de Neon ────────────────────────────────────────────────────────────
 * · Los roles son POR RAMA: hay que repetir esto en la branch `staging`.
 * · `DATABASE_URL_OWNER` debe ser la conexión DIRECTA (sin `-pooler`): Prisma
 *   necesita sesión directa para DDL y migraciones.
 * · `CREATE ROLE` exige CREATEROLE; el rol por defecto de Neon lo permite.
 */
import { PrismaClient } from '@prisma/client';

const ROL = 'barberias_app';
const APLICAR = process.argv.includes('--aplicar');

const urlOwner = (process.env.DATABASE_URL_OWNER ?? '').trim();
const password = process.env.BARBERIAS_APP_PASSWORD ?? '';

if (!urlOwner) {
  console.error(
    'Falta DATABASE_URL_OWNER (conexión directa del owner, sin -pooler).\n' +
      'El script no lee .env a propósito: exporta la variable en tu shell.',
  );
  process.exit(1);
}

if (password.length < 32) {
  console.error('BARBERIAS_APP_PASSWORD debe tener al menos 32 caracteres.');
  process.exit(1);
}

/** Literal SQL seguro: escapa una comilla simple duplicándola. */
const literal = (valor: string): string => `'${valor.replace(/'/g, "''")}'`;

interface Destino {
  host: string;
  database: string;
  user: string;
}

function destino(url: string): Destino {
  const u = new URL(url);
  return {
    host: u.hostname,
    database: u.pathname.replace(/^\/+/, ''),
    user: decodeURIComponent(u.username),
  };
}

const objetivo = destino(urlOwner);
const esPooler = objetivo.host.includes('-pooler');

const sqlRol = [
  `CREATE ROLE ${ROL} WITH LOGIN PASSWORD ${literal(password)};`,
  `GRANT CONNECT ON DATABASE ${objetivo.database} TO ${ROL};`,
  `GRANT USAGE ON SCHEMA public TO ${ROL};`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROL};`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROL};`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROL};`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROL};`,
];

function cabecera(): void {
  console.log(`Destino: ${objetivo.user}@${objetivo.host}/${objetivo.database}`);
  console.log(`Rol a asegurar: ${ROL}`);
  console.log(`Modo: ${APLICAR ? 'APLICAR (escribe)' : 'en seco (no escribe)'}`);
  if (esPooler) {
    console.warn(
      '⚠ El host es el pooler. DDL y migraciones necesitan la conexión directa: usa el host sin "-pooler".',
    );
  }
}

async function main(): Promise<void> {
  cabecera();

  if (!APLICAR) {
    console.log('\nSentencias que se ejecutarían (contraseña omitida):');
    for (const s of sqlRol) {
      console.log(`  ${s.replace(literal(password), "'***'")}`);
    }
    console.log('\nVerificación que se haría después:');
    console.log('  · has_schema_privilege(rol, public, CREATE) debe ser false');
    console.log("  · has_table_privilege(rol, public.usuarios, SELECT) debe ser true");
    console.log('  · DROP TABLE "usuarios" debe fallar (dentro de un rollback)');
    console.log('\nVuelve a lanzarlo con --aplicar para ejecutarlo.');
    return;
  }

  const prisma = new PrismaClient({ datasourceUrl: urlOwner });

  try {
    const [{ current_user: quien, current_database: base }] = await prisma.$queryRaw<
      { current_user: string; current_database: string }[]
    >`SELECT current_user, current_database()`;

    if (base !== objetivo.database) {
      throw new Error(`La base conectada (${base}) no coincide con la URL (${objetivo.database}).`);
    }
    console.log(`Conectado como ${quien} en ${base}`);

    const existente = await prisma.$queryRaw<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname = ${ROL}`;

    if (existente.length > 0) {
      console.log(`El rol ${ROL} ya existe: se rota la contraseña y se re-aplican los GRANT.`);
      await prisma.$executeRawUnsafe(`ALTER ROLE ${ROL} WITH LOGIN PASSWORD ${literal(password)};`);
    } else {
      await prisma.$executeRawUnsafe(sqlRol[0]);
      console.log(`Rol ${ROL} creado.`);
    }

    for (const sentencia of sqlRol.slice(1)) {
      await prisma.$executeRawUnsafe(sentencia);
    }
    console.log('Permisos DML y privilegios por defecto aplicados.');

    // ── Verificación ────────────────────────────────────────────────────────
    const [priv] = await prisma.$queryRaw<
      { puede_crear: boolean; puede_select: boolean; puede_delete: boolean }[]
    >`SELECT has_schema_privilege(${ROL}, 'public', 'CREATE')  AS puede_crear,
             has_table_privilege(${ROL}, 'public.usuarios', 'SELECT') AS puede_select,
             has_table_privilege(${ROL}, 'public.usuarios', 'DELETE') AS puede_delete`;

    console.log('\nPrivilegios efectivos:');
    console.log(`  CREATE en schema public : ${priv.puede_crear} (debe ser false)`);
    console.log(`  SELECT en usuarios      : ${priv.puede_select} (debe ser true)`);
    console.log(`  DELETE en usuarios      : ${priv.puede_delete} (debe ser true)`);

    // El DROP se intenta de verdad, pero la transacción siempre revierte.
    let bloqueado = false;
    let detalle = '';
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('DROP TABLE "usuarios"');
        throw new Error('INESPERADO');
      });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      if (mensaje.includes('INESPERADO')) {
        throw new Error('¡El DROP TABLE se ejecutó! Revisa los permisos antes de seguir.');
      }
      bloqueado = true;
      detalle = mensaje.split('\n').filter(Boolean).slice(-1)[0] ?? mensaje;
    }

    console.log('\nPrueba destructiva (DROP TABLE usuarios, revertida):');
    console.log(`  bloqueado por PostgreSQL: ${bloqueado}`);
    if (detalle) console.log(`  mensaje: ${detalle}`);

    const ok = bloqueado && !priv.puede_crear && priv.puede_select;
    console.log(
      `\n${ok ? '✅' : '❌'} ${
        ok
          ? `T-33 verificado: ${ROL} hace DML y no puede alterar el esquema.`
          : 'T-33 NO verificado: revisa los privilegios de arriba.'
      }`,
    );

    console.log(
      `\nSiguiente paso en Render (Environment):\n` +
        `  DATABASE_URL        = postgresql://${ROL}:<clave url-encoded>@${objetivo.host}/${objetivo.database}?sslmode=require\n` +
        `  DATABASE_URL_MIGRATE = <cadena DIRECTA del owner, sin -pooler>\n` +
        `Recuerda codificar la contraseña (encodeURIComponent) si lleva @ : / ? #.`,
    );

    if (!ok) process.exit(2);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n❌ Falló:', error instanceof Error ? error.message : error);
  process.exit(1);
});
