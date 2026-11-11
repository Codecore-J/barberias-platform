/**
 * Purga de reliquias de corridas E2E/QA anteriores.
 *
 * Cubre dos frentes en un solo ejecutable, para no repartir borrados en scripts
 * SQL ad-hoc:
 *
 *  1. TAREA 7 · Cuentas de prueba sueltas: correos con los patrones `qa.` /
 *     `.qa.` o cuentas cuyo teléfono incumple el formato de 10 dígitos. Nació
 *     para poder ejecutar `ALTER TABLE "usuarios" VALIDATE CONSTRAINT
 *     chk_usuario_telefono_10_digitos`.
 *  2. TAREA 6 · Sedes heredadas de E2E: las que conservan el teléfono genérico
 *     `0000000000`. Ese valor SÍ pasa el CHECK de 10 dígitos, así que el
 *     constraint no las detecta: son sedes fantasma que aparentan ser válidas.
 *     Se purgan junto a sus reservas, porque `reservas.barberia_id`,
 *     `pagos.barberia_id`, `antecedentes.barberia_origen_id` y
 *     `reportes.barberia_id` son FK en RESTRICT (sin `onDelete` en el esquema)
 *     y bloquean el borrado de la sede.
 *
 * Uso (desde `backend-barberias`):
 *
 *   # SIMULACIÓN (por defecto): no borra nada, solo informa del alcance
 *   npx tsx prisma/purge-test-relics.ts
 *
 *   # borra de verdad
 *   npx tsx prisma/purge-test-relics.ts --aplicar
 *
 * Sigue la misma convención que `scripts/fix-corrupted-phones.ts`: sin bandera
 * no se escribe nada. `--dry-run` se acepta de forma explícita para dejar
 * constancia en scripts de CI.
 *
 * Notas de diseño:
 *
 *  1. El campo de correo en el esquema es `correo`, no `email`. Con `email` el
 *     cliente de Prisma lanza «Unknown argument» y el script no arranca.
 *  2. Antes de borrar se comprueban las tres FKs en RESTRICT que apuntan a
 *     `usuarios` (`barberias.responsable_id`, `reservas.cliente_id`,
 *     `propuestas_horario.creado_por`). Si alguna referencia a esta lista, el
 *     borrado fallaba a mitad de transacción; ahora se aborta con un mensaje
 *     claro en vez de reventar. La comprobación corre también en simulación,
 *     porque es la que avisa de que la purga no podría completarse.
 *  3. Las sedes se seleccionan por TELÉFONO (`0000000000`) o por pertenecer a
 *     una cuenta ya seleccionada. Así la Tarea 6 no depende de recordar qué
 *     correos montaron cada corrida.
 *  4. Todo el borrado va en UNA transacción: o se va todo, o no se va nada.
 *     Sin `--aplicar` la transacción ni siquiera se abre.
 *
 * El resto de relaciones hacia `usuarios` y `barberias` son CASCADE o SET NULL,
 * así que se resuelven solas. `usuario_roles` también lo es, pero se borra
 * explícitamente para dejar constancia de lo que se elimina (y para poder
 * informar del número de filas en simulación).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Teléfonos heredados de cuentas que incumplen el formato de 10 dígitos. */
const TELEFONOS_INVALIDOS = ['818355496', '82990010000', '82990020000', '0000000000'];

/**
 * Tarea 6 · teléfono genérico con el que las corridas E2E antiguas daban de
 * alta sus sedes. Pasa el CHECK de longitud pero no es un contacto real.
 */
const TELEFONO_SEDE_E2E = '0000000000';

/**
 * Tareas 6 y 7 · cuentas de prueba que deben desaparecer aunque su correo no
 * encaje en los patrones de arriba. `permisos.qa.e2e@test.com` ya caía por
 * `.qa.`; se nombra igual para que el alcance quede explícito y no dependa del
 * patrón. Las dos `admin.e30x` son las responsables de las 10 sedes fantasma.
 */
const CORREOS_PRUEBA = [
  'permisos.qa.e2e@test.com',
  'admin.e303@test.com',
  'admin.e401@test.com',
];

/**
 * Dominios y prefijos con los que las corridas E2E y los seeds de demostración
 * daban de alta sus cuentas. Se nombran aquí porque la lista fija de teléfonos
 * de arriba quedó corta: en producción había 51 reliquias con teléfonos de 15
 * dígitos que no figuraban en ninguna lista, y el CHECK no pudo convalidarse
 * por ellas (nov-2026).
 *
 * Deliberadamente NO se selecciona por «teléfono con formato inválido»: eso
 * barrería también a clientes reales con el número mal capturado, que necesitan
 * que alguien corrija el dato, no que se borre la cuenta.
 */
const PATRONES_CORREO_PRUEBA = ['@t.com', '@demo.com'];
const PREFIJOS_CORREO_PRUEBA = ['demo'];

const esCorreoDePrueba = (correo: string): boolean =>
  PATRONES_CORREO_PRUEBA.some((d) => correo.endsWith(d)) ||
  PREFIJOS_CORREO_PRUEBA.some((p) => correo.startsWith(p));

const APLICAR = process.argv.includes('--aplicar');

interface ResumenDependencias {
  barberias: number;
  reservas: number;
  propuestas: number;
  roles: number;
}

interface ResumenSedes {
  sedes: number;
  reservas: number;
  pagos: number;
  antecedentes: number;
  reportes: number;
}

async function main(): Promise<void> {
  console.log('🧹 Purga de reliquias de prueba');
  console.log(`Modo: ${APLICAR ? 'APLICAR (borra de verdad)' : 'SIMULACIÓN (añade --aplicar para borrar)'}`);

  // ── Etapa 1 · cuentas de prueba ────────────────────────────────────────────
  const usuariosPrueba = await prisma.usuario.findMany({
    where: {
      OR: [
        { correo: { startsWith: 'qa.' } },
        { correo: { contains: '.qa.' } },
        { correo: { in: CORREOS_PRUEBA } },
        { telefono: { in: TELEFONOS_INVALIDOS } },
        { correo: { endsWith: '@t.com' } },
        { correo: { endsWith: '@demo.com' } },
        { correo: { startsWith: 'demo' } },
      ],
    },
    select: { id: true, correo: true, telefono: true },
  });

  // Red de seguridad: nunca se borra una cuenta que no encaje en los patrones de
  // prueba, aunque la selección anterior la hubiera arrastrado por otra vía.
  const excluidas = usuariosPrueba.filter((u) => !esCorreoDePrueba(u.correo) && !CORREOS_PRUEBA.includes(u.correo));
  if (excluidas.length > 0) {
    console.log(`\n⚠ Se descartan ${excluidas.length} cuenta(s) que no encajan en los patrones de prueba:`);
    excluidas.forEach((u) => console.log(`  · ${u.correo}`));
  }
  const seleccionFinal = usuariosPrueba.filter(
    (u) => esCorreoDePrueba(u.correo) || CORREOS_PRUEBA.includes(u.correo),
  );

  const ids = seleccionFinal.map((u) => u.id);
  const lista = `'{${ids.join(',')}}'::uuid[]`;

  console.log(`\nCuentas seleccionadas: ${seleccionFinal.length}`);
  for (const u of seleccionFinal) {
    console.log(`  · ${u.telefono}  ${u.correo}`);
  }

  // ── Etapa 2 · sedes fantasma (Tarea 6) ─────────────────────────────────────
  // Por teléfono genérico o por pertenecer a una cuenta ya seleccionada.
  const sedesPrueba = await prisma.barberia.findMany({
    where: {
      OR: [
        { telefono: TELEFONO_SEDE_E2E },
        ...(ids.length > 0 ? [{ responsableId: { in: ids } }] : []),
      ],
    },
    select: { id: true, nombre: true, telefono: true, responsable: { select: { correo: true } } },
    orderBy: { creadoAt: 'asc' },
  });

  const idsSedes = sedesPrueba.map((s) => s.id);
  const listaSedes = `'{${idsSedes.join(',')}}'::uuid[]`;
  const haySedes = idsSedes.length > 0;

  console.log(`\nSedes seleccionadas: ${sedesPrueba.length}`);
  for (const s of sedesPrueba) {
    console.log(`  · ${s.telefono}  ${s.nombre}  (${s.responsable?.correo ?? 'sin responsable'})`);
  }

  if (usuariosPrueba.length === 0 && sedesPrueba.length === 0) {
    console.log('\nNada que purgar.');
    return;
  }

  // Hijos en RESTRICT de las sedes: se borran antes que la sede.
  const [hijosSedes] = await prisma.$queryRawUnsafe<Omit<ResumenSedes, 'sedes'>[]>(
    `SELECT
       ${haySedes ? `(SELECT count(*)::int FROM reservas WHERE barberia_id = ANY(${listaSedes}))` : '0'} AS reservas,
       ${haySedes ? `(SELECT count(*)::int FROM pagos WHERE barberia_id = ANY(${listaSedes}))` : '0'} AS pagos,
       ${haySedes ? `(SELECT count(*)::int FROM antecedentes WHERE barberia_origen_id = ANY(${listaSedes}))` : '0'} AS antecedentes,
       ${haySedes ? `(SELECT count(*)::int FROM reportes WHERE barberia_id = ANY(${listaSedes}))` : '0'} AS reportes`,
  );

  const dependenciasSedes: ResumenSedes = {
    sedes: sedesPrueba.length,
    reservas: hijosSedes.reservas,
    pagos: hijosSedes.pagos,
    antecedentes: hijosSedes.antecedentes,
    reportes: hijosSedes.reportes,
  };

  console.log(
    `\nDependencias de las sedes: ${dependenciasSedes.reservas} reservas, ` +
      `${dependenciasSedes.pagos} pagos, ${dependenciasSedes.antecedentes} antecedentes, ` +
      `${dependenciasSedes.reportes} reportes (se borran con la sede).`,
  );

  // Guard: FKs en RESTRICT hacia `usuarios` QUE NO se resuelven con la purga de
  // sedes. Si una cuenta seleccionada aún tiene sedes fuera del alcance, o
  // reservas como cliente en una sede que sobrevive, hay que mirarlo a mano.
  const [bloqueos] = await prisma.$queryRawUnsafe<
    { barberias: number; reservas: number; propuestas: number }[]
  >(
    `SELECT
       (SELECT count(*)::int FROM barberias
          WHERE responsable_id = ANY(${lista})
            AND ${haySedes ? `NOT (id = ANY(${listaSedes}))` : 'true'}) AS barberias,
       (SELECT count(*)::int FROM reservas
          WHERE cliente_id = ANY(${lista})
            AND ${haySedes ? `NOT (barberia_id = ANY(${listaSedes}))` : 'true'}) AS reservas,
       (SELECT count(*)::int FROM propuestas_horario
          WHERE creado_por = ANY(${lista})) AS propuestas`,
  );

  // Las reservas de clientes de prueba en sedes que sobreviven SÍ se borran: son
  // citas de cuentas ficticias en la agenda de una sede real, no historial
  // legítimo. Las sedes y las propuestas, en cambio, obligan a mirar a mano.
  if (bloqueos.barberias || bloqueos.propuestas) {
    throw new Error(
      `Purga abortada: hay referencias en RESTRICT que sobreviven al alcance ` +
        `(barberias=${bloqueos.barberias}, propuestas_horario=${bloqueos.propuestas}). ` +
        `Resuélvelas antes de borrar usuarios.`,
    );
  }

  if (bloqueos.reservas > 0) {
    console.log(
      `  · ${bloqueos.reservas} reserva(s) de esas cuentas están en sedes que sobreviven ` +
        `y se eliminarán con ellas (citas de prueba en la agenda de una sede real).`,
    );
  }

  const [{ n: roles }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM usuario_roles WHERE usuario_id = ANY(${lista})`,
  );
  const dependencias: ResumenDependencias = {
    barberias: bloqueos.barberias,
    reservas: bloqueos.reservas,
    propuestas: bloqueos.propuestas,
    roles,
  };

  console.log(
    `Dependencias de las cuentas: ${dependencias.roles} roles en usuario_roles, ` +
      `${dependencias.reservas} reservas, ${dependencias.barberias} sedes, ` +
      `${dependencias.propuestas} propuestas (estas tres últimas deben ser 0).`,
  );

  if (!APLICAR) {
    // Se descuentan las cuentas que la purga eliminaría: el número que importa es
    // cuántos violadores sobreviven, no cuántos hay ahora.
    const [{ n: violadores }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM usuarios
        WHERE telefono !~ '^[0-9]{10}$' AND NOT (id = ANY(${lista}))`,
    );
    const [{ n: sedesGenericas }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM barberias
        WHERE telefono = '${TELEFONO_SEDE_E2E}'${haySedes ? ` AND NOT (id = ANY(${listaSedes}))` : ''}`,
    );
    console.log(`Violadores del CHECK tras una purga de este alcance: ${violadores}.`);
    console.log(`Sedes con teléfono ${TELEFONO_SEDE_E2E} restantes: ${sedesGenericas}.`);
    console.log('\nNo se ha borrado nada. Vuelve a ejecutarlo con --aplicar.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (haySedes) {
      // Orden obligado por las FK en RESTRICT del esquema.
      const reportes = await tx.reporte.deleteMany({ where: { barberiaId: { in: idsSedes } } });
      const antecedentes = await tx.antecedente.deleteMany({
        where: { barberiaOrigenId: { in: idsSedes } },
      });
      const pagos = await tx.pago.deleteMany({ where: { barberiaId: { in: idsSedes } } });
      const reservas = await tx.reserva.deleteMany({ where: { barberiaId: { in: idsSedes } } });
      console.log(
        `  · hijos de las sedes eliminados: ${reservas.count} reservas, ${pagos.count} pagos, ` +
          `${antecedentes.count} antecedentes, ${reportes.count} reportes`,
      );
      const sedes = await tx.barberia.deleteMany({ where: { id: { in: idsSedes } } });
      console.log(`  · sedes eliminadas: ${sedes.count}`);
    }

    if (ids.length > 0) {
      const propuestas = await tx.propuestaHorario.deleteMany({
        where: { creadoPor: { in: ids } },
      });
      if (propuestas.count > 0) {
        console.log(`  · propuestas de horario eliminadas: ${propuestas.count}`);
      }
      // Restrict de `reservas.cliente_id`: citas de las cuentas de prueba que
      // viven en sedes fuera del alcance de la purga.
      const reservasFuera = await tx.reserva.deleteMany({
        where: { clienteId: { in: ids }, ...(haySedes ? { barberiaId: { notIn: idsSedes } } : {}) },
      });
      if (reservasFuera.count > 0) {
        console.log(`  · reservas de prueba en sedes que sobreviven: ${reservasFuera.count}`);
      }
      const borradosRoles = await tx.usuarioRol.deleteMany({ where: { usuarioId: { in: ids } } });
      console.log(`  · roles asociados eliminados: ${borradosRoles.count}`);
      const deleted = await tx.usuario.deleteMany({ where: { id: { in: ids } } });
      console.log(`> Eliminados ${deleted.count} usuarios de prueba y sus roles asociados.`);
    }
  });

  // Estado final.
  const [{ n: restantes }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM usuarios WHERE telefono !~ '^[0-9]{10}$'`,
  );
  const [{ n: sedesRestantes }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM barberias WHERE telefono = '${TELEFONO_SEDE_E2E}'`,
  );
  console.log(`Violadores restantes del CHECK: ${restantes}`);
  console.log(`Sedes con teléfono ${TELEFONO_SEDE_E2E} restantes: ${sedesRestantes}`);
  if (restantes > 0) {
    console.log(
      `\n⚠ Quedan ${restantes} teléfono(s) inválido(s): son cuentas reales sin residuo de prueba. ` +
        'El CHECK sigue aplicando a toda escritura nueva, pero no puede convalidarse hasta que ' +
        'el dueño de cada cuenta corrija su número.',
    );
  } else {
    console.log('\n✅ Ningún teléfono inválido: ya se puede ejecutar VALIDATE CONSTRAINT.');
  }
  if (sedesRestantes > 0) {
    throw new Error('Quedan sedes con el teléfono genérico; revisa responsables no incluidos.');
  }
}

main()
  .catch((e) => {
    console.error('❌ ' + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
