/**
 * Limpieza profunda · deja la base en el baseline de producción.
 *
 * OBJETIVO
 *   · Un único usuario: la cuenta maestra (`admin@demo.com` por defecto), con
 *     su rol ACTIVO de ADMINISTRADOR global y su vínculo ACTIVO de
 *     ADMIN_BARBERIA con la sede oficial.
 *   · Una única sede: `Imperial Barbers Demo` por defecto, ACTIVA y con la
 *     cuenta maestra como responsable.
 *   · Cero datos de prueba: se vacían las tablas transaccionales e históricas
 *     y se borra el catálogo, los horarios y los vínculos de todo lo que no
 *     pertenece al baseline.
 *
 * USO (desde `backend-barberias`)
 *
 *   # SIMULACIÓN (por defecto): informa el alcance y no escribe nada
 *   npx tsx prisma/limpieza-profunda.ts --env-file=.env
 *
 *   # BORRA DE VERDAD (escribe antes un respaldo JSON)
 *   npx tsx prisma/limpieza-profunda.ts --env-file=.env --aplicar
 *
 *   # Local: mismo script con la base de `.env.test`
 *   npx tsx prisma/limpieza-profunda.ts --env-file=.env.test --aplicar
 *
 * Variables opcionales:
 *   LIMPIEZA_ADMIN_CORREO   correo de la cuenta maestra (default admin@demo.com)
 *   LIMPIEZA_SEDE_NOMBRE    nombre de la sede oficial (default Imperial Barbers Demo)
 *   LIMPIEZA_SEDE_ID        id de la sede oficial (tiene prioridad sobre el nombre)
 *   LIMPIEZA_RESPALDO       ruta del respaldo JSON (default ../.respaldo-limpieza-*.json)
 *
 * POR QUÉ ESTE ORDEN
 *   PostgreSQL impone RESTRICT en seis aristas que un borrado ingenuo rompe:
 *     pagos → reservas y barberias
 *     reservas → usuarios (cliente_id)
 *     propuestas_horario → usuarios (creado_por)
 *     barberias → usuarios (responsable_id)
 *     participante_servicios → servicios y servicios_barbero
 *     servicios_barbero → categorias_servicio
 *   Por eso se borra de hoja a raíz: historial transaccional, catálogo de las
 *   sedes que se van, sedes y, al final, usuarios. Todo en UNA transacción: o
 *   queda el baseline completo, o no se toca nada.
 *
 * El catálogo y la configuración de la sede que SE CONSERVA no se tocan: la
 * sede queda operativa. Lo que se vacía de forma global es el historial
 * (reservas, pagos, caja, notificaciones, auditoría, etc.), que era datos de
 * prueba en su totalidad.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

/** Lee `--clave=valor` de la línea de comandos. */
const argumento = (nombre: string): string | undefined => {
  const prefijo = `--${nombre}=`;
  const encontrado = process.argv.find((a) => a.startsWith(prefijo));
  return encontrado ? encontrado.slice(prefijo.length) : undefined;
};

// `tsx` precarga `.env` al ejecutar un archivo y `process.loadEnvFile` no pisa
// variables ya definidas: por eso el archivo se lee de forma explícita. Se
// extrae SOLO `DATABASE_URL` (la prosa con backticks de `.env` se ignora), de
// modo que `--env-file` siempre decide contra qué base se ejecuta.
const archivoEnv = argumento('env-file') ?? '.env';
if (archivoEnv) {
  if (!existsSync(archivoEnv)) abortar(`No existe el archivo de entorno ${archivoEnv}.`);
  const linea = readFileSync(archivoEnv, 'utf8').match(
    /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/m,
  );
  if (!linea) abortar(`No se encontró DATABASE_URL en ${archivoEnv}.`);
  process.env.DATABASE_URL = linea[1].trim().replace(/^['"]|['"]$/g, '');
}

const prisma = new PrismaClient();

const APLICAR = process.argv.includes('--aplicar');

const ADMIN_CORREO = process.env.LIMPIEZA_ADMIN_CORREO?.trim() || 'admin@demo.com';
const SEDE_NOMBRE = process.env.LIMPIEZA_SEDE_NOMBRE?.trim() || 'Imperial Barbers Demo';
const SEDE_ID = process.env.LIMPIEZA_SEDE_ID?.trim() || undefined;

/** Tablas que se respaldan y se cuentan. Nombres físicos de PostgreSQL. */
const TABLAS = [
  'usuarios',
  'roles',
  'permisos',
  'rol_permisos',
  'usuario_roles',
  'barberias',
  'cliente_barberias',
  'servicios',
  'categorias_servicio',
  'servicios_barbero',
  'combos',
  'combo_items',
  'horarios',
  'excepciones_horario',
  'horarios_barbero',
  'excepciones_horario_barbero',
  'horarios_base_barbero',
  'bloqueos_agenda',
  'reservas',
  'participantes_reserva',
  'participante_servicios',
  'propuestas_horario',
  'pagos',
  'cierres_caja',
  'antecedentes',
  'notificaciones',
  'auditoria',
  'reportes',
  'configuracion_barberia',
  'solicitudes_cambio_barberia',
  'tokens_recuperacion',
  'lista_esperas',
  '_ListaEsperaToServicio',
  'otp_confirmaciones',
] as const;

type Conteos = Record<string, number>;

function abortar(mensaje: string): never {
  console.error(`\n❌ ${mensaje}`);
  process.exit(1);
}

function describirDestino(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) abortar('Falta DATABASE_URL: pásala con --env-file=<ruta> o en el entorno.');
  try {
    const url = new URL(raw);
    // Solo host y base: nunca credenciales.
    return `${url.hostname}${url.pathname}`;
  } catch {
    abortar('DATABASE_URL no es una URL válida.');
  }
}

async function contarTablas(): Promise<Conteos> {
  const conteos: Conteos = {};
  for (const tabla of TABLAS) {
    try {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${tabla}"`,
      );
      conteos[tabla] = n;
    } catch {
      // Tabla inexistente en una base con migraciones parciales: se omite.
      conteos[tabla] = -1;
    }
  }
  return conteos;
}

function imprimirConteos(conteos: Conteos, titulo: string): void {
  const relevantes = Object.entries(conteos).filter(([, n]) => n > 0);
  console.log(`\n${titulo}`);
  if (relevantes.length === 0) {
    console.log('  (todas las tablas vacías)');
    return;
  }
  const ancho = Math.max(...relevantes.map(([t]) => t.length));
  for (const [tabla, n] of relevantes) console.log(`  ${tabla.padEnd(ancho)}  ${n}`);
}

interface Baseline {
  admin: { id: string; correo: string; nombreCompleto: string };
  sede: { id: string; nombre: string; telefono: string };
  idsUsuarios: string[];
  idsSedes: string[];
}

async function resolverBaseline(): Promise<Baseline> {
  const admin = await prisma.usuario.findUnique({
    where: { correo: ADMIN_CORREO },
    select: {
      id: true,
      correo: true,
      nombreCompleto: true,
      estadoCuenta: true,
      usuarioRoles: {
        select: { estado: true, barberiaId: true, rol: { select: { nombre: true } } },
      },
    },
  });
  if (!admin) abortar(`No existe la cuenta maestra ${ADMIN_CORREO}.`);

  const adminGlobal = admin.usuarioRoles.some(
    (r) => r.rol.nombre === 'ADMINISTRADOR' && r.barberiaId === null && r.estado === 'ACTIVO',
  );
  if (admin.estadoCuenta !== 'ACTIVO' || !adminGlobal) {
    abortar(
      `La cuenta ${ADMIN_CORREO} no es un ADMINISTRADOR global ACTIVO ` +
        `(estado=${admin.estadoCuenta}). No se puede usar como cuenta maestra.`,
    );
  }

  const sedes = await prisma.barberia.findMany({
    where: SEDE_ID ? { id: SEDE_ID } : { nombre: SEDE_NOMBRE },
    select: { id: true, nombre: true, telefono: true, estado: true, responsableId: true },
  });
  if (sedes.length === 0) {
    abortar(
      `No existe la sede ${SEDE_ID ?? `"${SEDE_NOMBRE}"`}. ` +
        'Define LIMPIEZA_SEDE_NOMBRE o LIMPIEZA_SEDE_ID con la sede oficial.',
    );
  }
  if (sedes.length > 1) {
    abortar(
      `Hay ${sedes.length} sedes con el nombre "${SEDE_NOMBRE}": ` +
        sedes.map((s) => s.id).join(', ') +
        '. Usa LIMPIEZA_SEDE_ID para desambiguar.',
    );
  }
  const sede = sedes[0];
  if (sede.estado !== 'ACTIVO') abortar(`La sede oficial ${sede.nombre} está ${sede.estado}.`);
  if (sede.responsableId !== admin.id) {
    abortar(
      `La sede ${sede.nombre} no tiene a ${ADMIN_CORREO} como responsable. ` +
        'El baseline exige que la sede oficial esté vinculada a la cuenta maestra.',
    );
  }
  const vinculoSede = admin.usuarioRoles.some(
    (r) => r.rol.nombre === 'ADMIN_BARBERIA' && r.barberiaId === sede.id && r.estado === 'ACTIVO',
  );
  if (!vinculoSede) {
    abortar(
      `${ADMIN_CORREO} no tiene un vínculo ADMIN_BARBERIA ACTIVO con ${sede.nombre}. ` +
        'Corrige el vínculo antes de purgar; el script no inventa permisos.',
    );
  }

  const usuarios = await prisma.usuario.findMany({
    where: { id: { not: admin.id } },
    select: { id: true },
  });
  const otrasSedes = await prisma.barberia.findMany({
    where: { id: { not: sede.id } },
    select: { id: true },
  });

  return {
    admin: { id: admin.id, correo: admin.correo, nombreCompleto: admin.nombreCompleto },
    sede: { id: sede.id, nombre: sede.nombre, telefono: sede.telefono },
    idsUsuarios: usuarios.map((u) => u.id),
    idsSedes: otrasSedes.map((s) => s.id),
  };
}

/** Volcado completo de las tablas en juego, antes de tocar nada. */
async function escribirRespaldo(baseline: Baseline): Promise<string> {
  const destino =
    process.env.LIMPIEZA_RESPALDO?.trim() ||
    resolve(
      process.cwd(),
      '..',
      `.respaldo-limpieza-profunda-${Date.now()}.json`,
    );
  const volcado: { generadoAt: string; destino: string; baseline: Record<string, unknown>; tablas: Record<string, unknown> } = {
    generadoAt: new Date().toISOString(),
    destino: describirDestino(),
    baseline: {
      admin: baseline.admin.correo,
      sede: baseline.sede.nombre,
      usuariosAEliminar: baseline.idsUsuarios.length,
      sedesAEliminar: baseline.idsSedes.length,
    },
    tablas: {},
  };
  for (const tabla of TABLAS) {
    try {
      volcado.tablas[tabla] = await prisma.$queryRawUnsafe(`SELECT * FROM "${tabla}"`);
    } catch {
      volcado.tablas[tabla] = { error: 'tabla inexistente' };
    }
  }
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify(volcado, null, 2), 'utf8');
  return destino;
}

interface Auditoria {
  usuarios: number;
  sedes: number;
  sedesActivas: number;
  adminsGlobalesActivos: number;
  vinculosAdminSede: number;
  huerfanos: number;
  sedesSinAdmin: number;
  usuariosActivosSinRol: number;
}

async function auditar(): Promise<Auditoria> {
  const [fila] = await prisma.$queryRawUnsafe<Auditoria[]>(`
    SELECT
      (SELECT count(*)::int FROM usuarios) AS "usuarios",
      (SELECT count(*)::int FROM barberias) AS "sedes",
      (SELECT count(*)::int FROM barberias WHERE estado = 'ACTIVO') AS "sedesActivas",
      (SELECT count(*)::int FROM usuario_roles ur
         JOIN roles r ON r.id = ur.rol_id
        WHERE r.nombre = 'ADMINISTRADOR' AND ur.estado = 'ACTIVO'
          AND ur.barberia_id IS NULL) AS "adminsGlobalesActivos",
      (SELECT count(*)::int FROM usuario_roles ur
         JOIN roles r ON r.id = ur.rol_id
        WHERE r.nombre = 'ADMIN_BARBERIA' AND ur.estado = 'ACTIVO') AS "vinculosAdminSede",
      (SELECT count(*)::int FROM usuario_roles ur
         JOIN roles r ON r.id = ur.rol_id
        WHERE ur.barberia_id IS NULL AND r.ambito = 'BARBERIA') AS "huerfanos",
      (SELECT count(*)::int FROM barberias b
        WHERE b.estado = 'ACTIVO' AND NOT EXISTS (
          SELECT 1 FROM usuario_roles ur
            JOIN roles r ON r.id = ur.rol_id
           WHERE ur.barberia_id = b.id AND ur.estado = 'ACTIVO'
             AND r.nombre = 'ADMIN_BARBERIA')) AS "sedesSinAdmin",
      (SELECT count(*)::int FROM usuarios u
        WHERE u.estado_cuenta = 'ACTIVO' AND NOT EXISTS (
          SELECT 1 FROM usuario_roles ur WHERE ur.usuario_id = u.id)) AS "usuariosActivosSinRol"
  `);
  return fila;
}

async function main(): Promise<void> {
  const destino = describirDestino();
  console.log('🧹 Limpieza profunda · baseline de producción');
  console.log(`Destino: ${destino}`);
  console.log(`Modo: ${APLICAR ? 'APLICAR (borra de verdad)' : 'SIMULACIÓN (usa --aplicar para borrar)'}`);

  const baseline = await resolverBaseline();
  console.log(`\nCuenta maestra: ${baseline.admin.correo} (${baseline.admin.id})`);
  console.log(`Sede oficial:   ${baseline.sede.nombre} (${baseline.sede.id})`);

  const antes = await contarTablas();
  imprimirConteos(antes, 'Estado actual:');

  console.log(
    `\nA eliminar: ${baseline.idsUsuarios.length} usuario(s) y ` +
      `${baseline.idsSedes.length} sede(s).`,
  );
  const nombresSedes = await prisma.barberia.findMany({
    where: { id: { in: baseline.idsSedes } },
    select: { nombre: true, estado: true },
    orderBy: { nombre: 'asc' },
  });
  for (const s of nombresSedes) console.log(`  · sede  ${s.estado}  ${s.nombre}`);

  if (baseline.idsUsuarios.length === 0 && baseline.idsSedes.length === 0) {
    console.log('\nYa está en el baseline: nada que purgar.');
  } else if (!APLICAR) {
    console.log('\nNo se ha borrado nada. Vuelve a ejecutarlo con --aplicar.');
    await prisma.$disconnect();
    return;
  } else {
    const respaldo = await escribirRespaldo(baseline);
    console.log(`\n💾 Respaldo escrito: ${respaldo}`);

    const { idsUsuarios, idsSedes } = baseline;

    await prisma.$transaction(
      async (tx) => {
        console.log('\nBorrando historial transaccional...');
        const paso = async (nombre: string, borrado: Promise<{ count: number }>) => {
          const { count } = await borrado;
          if (count > 0) console.log(`  · ${nombre}: ${count}`);
          return count;
        };

        // 1 · Historial global. Es el orden que exigen las FK RESTRICT.
        await paso('participante_servicios', tx.participanteServicio.deleteMany({}));
        await paso('participantes_reserva', tx.participanteReserva.deleteMany({}));
        await paso('pagos', tx.pago.deleteMany({}));
        await paso('propuestas_horario', tx.propuestaHorario.deleteMany({}));
        await paso('reservas', tx.reserva.deleteMany({}));
        await paso('cierres_caja', tx.cierreCaja.deleteMany({}));
        await paso('lista_esperas', tx.listaEspera.deleteMany({}));
        await paso('notificaciones', tx.notificacion.deleteMany({}));
        await paso('tokens_recuperacion', tx.tokenRecuperacion.deleteMany({}));
        await paso('otp_confirmaciones', tx.otpConfirmacion.deleteMany({}));
        await paso('auditoria', tx.auditoria.deleteMany({}));
        await paso('antecedentes', tx.antecedente.deleteMany({}));
        await paso('reportes', tx.reporte.deleteMany({}));
        await paso('bloqueos_agenda', tx.bloqueosAgenda.deleteMany({}));
        await paso('solicitudes_cambio_barberia', tx.solicitudCambioBarberia.deleteMany({}));
        await paso('cliente_barberias', tx.clienteBarberia.deleteMany({}));

        // 2 · Catálogo y horarios de lo que se va (la sede oficial conserva los suyos).
        console.log('Borrando catálogo y horarios de las sedes/usuarios salientes...');
        await paso(
          'servicios_barbero',
          tx.servicioBarbero.deleteMany({
            where: {
              OR: [
                ...(idsUsuarios.length > 0 ? [{ barberoId: { in: idsUsuarios } }] : []),
                ...(idsSedes.length > 0 ? [{ categoria: { barberiaId: { in: idsSedes } } }] : []),
              ],
            },
          }),
        );
        await paso(
          'excepciones_horario_barbero',
          tx.excepcionHorarioBarbero.deleteMany({
            where: {
              OR: [
                ...(idsUsuarios.length > 0 ? [{ barberoId: { in: idsUsuarios } }] : []),
                ...(idsSedes.length > 0 ? [{ barberiaId: { in: idsSedes } }] : []),
              ],
            },
          }),
        );
        await paso(
          'horarios_barbero',
          tx.horarioBarbero.deleteMany({
            where: {
              OR: [
                ...(idsUsuarios.length > 0 ? [{ barberoId: { in: idsUsuarios } }] : []),
                ...(idsSedes.length > 0 ? [{ barberiaId: { in: idsSedes } }] : []),
              ],
            },
          }),
        );
        await paso(
          'horarios_base_barbero',
          idsUsuarios.length > 0
            ? tx.horarioBaseBarbero.deleteMany({ where: { barberoId: { in: idsUsuarios } } })
            : Promise.resolve({ count: 0 }),
        );
        await paso(
          'excepciones_horario',
          idsSedes.length > 0
            ? tx.excepcionHorario.deleteMany({ where: { barberiaId: { in: idsSedes } } })
            : Promise.resolve({ count: 0 }),
        );
        await paso(
          'horarios',
          idsSedes.length > 0
            ? tx.horario.deleteMany({ where: { barberiaId: { in: idsSedes } } })
            : Promise.resolve({ count: 0 }),
        );
        await paso(
          'combo_items',
          idsSedes.length > 0
            ? tx.comboItem.deleteMany({ where: { combo: { barberiaId: { in: idsSedes } } } })
            : Promise.resolve({ count: 0 }),
        );
        await paso(
          'combos',
          idsSedes.length > 0
            ? tx.combo.deleteMany({ where: { barberiaId: { in: idsSedes } } })
            : Promise.resolve({ count: 0 }),
        );
        await paso(
          'servicios',
          idsSedes.length > 0
            ? tx.servicio.deleteMany({ where: { barberiaId: { in: idsSedes } } })
            : Promise.resolve({ count: 0 }),
        );
        await paso(
          'categorias_servicio',
          idsSedes.length > 0
            ? tx.categoriaServicio.deleteMany({ where: { barberiaId: { in: idsSedes } } })
            : Promise.resolve({ count: 0 }),
        );
        await paso(
          'configuracion_barberia',
          idsSedes.length > 0
            ? tx.configuracionBarberia.deleteMany({ where: { barberiaId: { in: idsSedes } } })
            : Promise.resolve({ count: 0 }),
        );

        // 3 · Vínculos. Los de las sedes salientes también caen por CASCADE,
        // pero se borran explícitamente para que el conteo sea visible.
        await paso(
          'usuario_roles',
          tx.usuarioRol.deleteMany({
            where: {
              OR: [
                ...(idsUsuarios.length > 0 ? [{ usuarioId: { in: idsUsuarios } }] : []),
                ...(idsSedes.length > 0 ? [{ barberiaId: { in: idsSedes } }] : []),
              ],
            },
          }),
        );

        // 4 · Sedes antes que usuarios: `barberias.responsable_id` es RESTRICT.
        if (idsSedes.length > 0) {
          const sedes = await tx.barberia.deleteMany({ where: { id: { in: idsSedes } } });
          console.log(`  · sedes eliminadas: ${sedes.count}`);
        }
        if (idsUsuarios.length > 0) {
          const usuarios = await tx.usuario.deleteMany({ where: { id: { in: idsUsuarios } } });
          console.log(`  · usuarios eliminados: ${usuarios.count}`);
        }
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }

  const despues = await contarTablas();
  imprimirConteos(despues, 'Estado final:');

  const auditoria = await auditar();
  console.log('\n🔎 Auditoría de cierre');
  console.log(`  usuarios totales ..................... ${auditoria.usuarios}`);
  console.log(`  sedes totales ........................ ${auditoria.sedes}`);
  console.log(`  sedes activas ........................ ${auditoria.sedesActivas}`);
  console.log(`  ADMINISTRADOR global activo .......... ${auditoria.adminsGlobalesActivos}`);
  console.log(`  vínculos ADMIN_BARBERIA activos ...... ${auditoria.vinculosAdminSede}`);
  console.log(`  vínculos huérfanos (ámbito sede) ..... ${auditoria.huerfanos}`);
  console.log(`  sedes activas sin administrador ...... ${auditoria.sedesSinAdmin}`);
  console.log(`  usuarios activos sin rol ............. ${auditoria.usuariosActivosSinRol}`);

  const fallos: string[] = [];
  if (auditoria.usuarios !== 1) fallos.push(`usuarios=${auditoria.usuarios} (esperado 1)`);
  if (auditoria.sedes !== 1) fallos.push(`sedes=${auditoria.sedes} (esperado 1)`);
  if (auditoria.sedesActivas !== 1) fallos.push(`sedes activas=${auditoria.sedesActivas} (esperado 1)`);
  if (auditoria.adminsGlobalesActivos !== 1)
    fallos.push(`admins globales activos=${auditoria.adminsGlobalesActivos} (esperado 1)`);
  if (auditoria.vinculosAdminSede !== 1)
    fallos.push(`vínculos ADMIN_BARBERIA=${auditoria.vinculosAdminSede} (esperado 1)`);
  if (auditoria.huerfanos !== 0) fallos.push(`vínculos huérfanos=${auditoria.huerfanos} (esperado 0)`);
  if (auditoria.sedesSinAdmin !== 0) fallos.push(`sedes sin admin=${auditoria.sedesSinAdmin} (esperado 0)`);
  if (auditoria.usuariosActivosSinRol !== 0)
    fallos.push(`usuarios activos sin rol=${auditoria.usuariosActivosSinRol} (esperado 0)`);

  if (fallos.length > 0) {
    abortar(`El baseline no se cumplió: ${fallos.join('; ')}.`);
  }
  console.log('\n✅ Baseline verificado: 1 administrador, 1 sede activa, 0 huérfanos.');
}

main()
  .catch((e) => {
    console.error('❌ ' + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
