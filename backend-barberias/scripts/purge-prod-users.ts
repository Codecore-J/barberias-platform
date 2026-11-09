// scripts/purge-prod-users.ts
/**
 * Solo con autorización explícita y DATABASE_URL apuntando a la BD de
 * producción. Elimina cuentas de prueba de la BD sin tocar el admin que se
 * creó con scripts/seed-qa-admin.ts.
 *
 * Este entorno permite ejecutar scripts de mantenimiento contra la base de
 * datos. Para este caso concreto, existe un mecanismo de simulación: al
 * ejecutar sin bandera el script solo imprime las cuentas que eliminaría, por
 * lo que no se borra nada de forma destructiva.
 *
 * Uso:
 *   # simulación (recomendado antes de cualquier acción real)
 *   DATABASE_URL="postgresql://..." npx tsx scripts/purge-prod-users.ts
 *   # acción real (imprime reporte de borrados y luego elimina las filas)
 *   npx tsx scripts/purge-prod-users.ts --aplicar
 */

import { Pool } from 'pg';
import { promises as fs } from 'node:fs';

const DATABASE_URL_FILE = process.env.DATABASE_URL_FILE || '.env';
const APLICAR = process.argv.includes('--aplicar');

const CORREOS_PRUEBA = [
  'admin.a.cta@test.com',
  'admin.b.cta@test.com',
  'suelto.cta@test.com',
  'vinculado.cta@test.com',
  'barbero.a.cta@test.com',
  'admin.a.roles@test.com',
  'barbero.a.roles@test.com',
  'ajeno.roles@test.com',
  'cliente.roles@test.com',
  'admin.a.e106@test.com',
  'admin.b.e106@test.com',
  'cliente.a.e106@test.com',
  'barbero.a.e106@test.com',
  'global.e106@test.com',
  'admin.a.h19@test.com',
  'admin.b.h19@test.com',
  'cliente.h19@test.com',
  'global.h19@test.com',
  'barbero.a.h19@test.com',
  'barbero.b.h19@test.com',
  'admin.a@test.com',
  'admin.b@test.com',
  'suelto@test.com',
  'vinculado@test.com',
  'barbero.a@test.com',
  'barbero.b@test.com',
  'cliente.a@test.com',
  'cliente.b@test.com',
  'admin.sede@test.com',
  'admin.sede.b@test.com',
  'admin.global@test.com',
  'global@test.com',
  'admin.pago@a.com',
  'admin.pago.b@a.com',
  'duenio.antecedente.1@a.com',
  'duenio.antecedente.2@a.com',
  'duenio.antecedente.3@a.com',
  'admin.barberia.a@a.com',
  'admin.barberia.b@a.com',
  'barbero.a@a.com',
  'barbero.b@a.com',
  'vinculado.a@v.com',
  'vinculado.b@v.com',
  'admin.barberia@c.com',
  'admin.barberia.d@c.com',
  'duenio.e309@test.com',
  'admin.sede.e309@test.com',
  'barbero.a.e309@test.com',
  'barbero.b.e309@test.com',
  'cliente.e309@test.com',
  'duenio.h76@test.com',
  'admin.sede.h76@test.com',
  'barbero.h76@test.com',
  'cliente.h76@test.com',
  'admin.ajeno.h76@test.com',
  'duenio.b.h76@test.com',
  'admin.sede.r1@test.com',
  'admin.sede.r2@test.com',
  'admin.sede.r3@test.com',
  'admin.sede.r4@test.com',
  'admin.sede.r5@test.com',
  'admin.sede.r6@test.com',
  'admin.sede.m1@test.com',
  'admin.sede.m2@test.com',
  'admin.sede.m3@test.com',
  'admin.sede.m4@test.com',
  'admin.sede.m5@test.com',
  'admin.sede.m6@test.com',
  'admin.sede.m7@test.com',
  'admin.sede.m8@test.com',
  'admin.sede.m9@test.com',
  'admin.sede.m10@test.com',
  'admin.sede.a.r@test.com',
  'admin.sede.b.r@test.com',
  'admin.sede.c.r@test.com',
  'admin.sede.d.r@test.com',
  'admin.sede.e.r@test.com',
  'admin.sede.f.r@test.com',
  'admin.sede.g.r@test.com',
  'admin.sede.h.r@test.com',
  'admin.sede.i.r@test.com',
  'admin.sede.j.r@test.com',
  'admin.sede.k.r@test.com',
  'admin.sede.l.r@test.com',
  'admin.sede.m.r@test.com',
  'admin.sede.n.r@test.com',
  'admin.sede.o.r@test.com',
  'admin.sede.p.r@test.com',
  'admin.sede.q.r@test.com',
  'admin.sede.r.r@test.com'
];

function cargarDatabaseUrl(): Promise<string> {
  if (process.env.DATABASE_URL) return Promise.resolve(process.env.DATABASE_URL);
  return fs
    .readFile(DATABASE_URL_FILE, 'utf8')
    .then((txt) => {
      const m = txt.match(/^\s*DATABASE_URL\s*=\s*['"]([^'"]+)['"]/m);
      if (!m) throw new Error(`No se encontró DATABASE_URL en ${DATABASE_URL_FILE}`);
      return m[1];
    })
    .catch((e) => {
      console.error(`❌ No se pudo leer ${DATABASE_URL_FILE}: ${e.message}`);
      process.exit(1);
    });
}

function parseUrl(databaseUrl: string): { host: string; port: number; database: string; user: string; password: string } {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\/*/, ''),
    user: url.username,
    password: url.password,
  };
}

function corchetes(valores: readonly string[]): string {
  return `{'${valores.join("','")}'}`;
}

async function main(): Promise<void> {
  const databaseUrl = await cargarDatabaseUrl();
  const { host, port, database, user, password } = parseUrl(databaseUrl);
  const pool = new Pool({ host, port, database, user, password, ssl: { rejectUnauthorized: false }, max: 5 });

  try {
    // Fase 1 · Listado previo para verificarlo sobre el contenido de la base.
    const res = await pool.query(
      `SELECT id, correo, telefono, estado_cuenta
       FROM "public".usuarios
       WHERE correo = ANY($1)
         AND telefono = ANY($2)
       ORDER BY correo`,
      [corchetes(CORREOS_PRUEBA), corchetes(['8888888888', '9999999999', '0000000000'])],
    );

    const rows = res.rows as { id: string; correo: string; telefono: string; estadoCuenta: string }[];
    const ids = rows.map((u) => u.id);
    console.log(`cuentas candidate: ${rows.length}`);
    for (const u of rows) {
      console.log(` - ${u.telefono} ${u.correo} ${u.estadoCuenta} ${u.id}`);
    }

    // Fase 2 · Borrado de las cuentas seleccionadas.
    if (APLICAR && ids.length) {
      // Usar la transacción explícita para que el borrado sea atómico y de
      // ser un error se reviertan las filas.
      await pool.query('BEGIN');
      try {
        const r = await pool.query(
          `DELETE FROM "public".usuarios
           WHERE id = ANY($1)
           RETURNING id`,
          [ids.map((i) => `'${i}'`)],
        );
        console.log(`eliminadas: ${r.rowCount}`);
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
    }

    // Fase 3 · Estado final del admin global.
    const countRes = await pool.query(
      `SELECT count(*)::int AS n FROM "public".usuarios WHERE correo = 'admin.cremaq.production@test.com'`,
    );
    console.log(`admin.cremaq.production@test.com restante: ${(countRes.rows[0] as any).n}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
