/**
 * Fase 2 · Regulariza sedes con más de un `ADMIN_BARBERIA` ACTIVO.
 *
 * El backend ya rechaza crear un segundo dueño (`409 SEDE_YA_TIENE_ADMIN`), pero
 * los datos que se crearon antes de esa regla siguen ahí: la auditoría de
 * producción encontró sedes con dos vínculos ACTIVOS y cuentas cuyo vínculo
 * quedó ACTIVO con la cuenta SUSPENDIDA. Esta herramienta los detecta y los
 * deja en un estado que la regla nueva sabe interpretar.
 *
 * ── Qué hace y qué NO hace ───────────────────────────────────────────────────
 * No borra nada. Un administrador de más se resuelve DESACTIVANDO su vínculo
 * (`estado = 'INACTIVO'`), que es reversible y conserva la cuenta, su historial
 * y su auditoría. Borrar filas de `usuario_roles` quitaría el rastro de que esa
 * persona fue dueña de la sede.
 *
 * ── Regla de elección del dueño que se queda ─────────────────────────────────
 * 1. Prefiere un vínculo cuya CUENTA esté ACTIVA: un administrador suspendido no
 *    puede entrar, así que no debe bloquear la sede.
 * 2. Entre los candidatos, el de cuenta más antigua (`usuarios.creado_at`), que
 *    es el criterio que ya usa el listado de la bandeja.
 * 3. Empate roto por `id` para que dos ejecuciones seguidas elijan lo mismo.
 *
 * ── Uso (desde `backend-barberias`) ──────────────────────────────────────────
 *
 *   # SIMULACIÓN (por defecto): no escribe nada, solo informa
 *   npx tsx prisma/regularizar-administradores-sede.ts
 *
 *   # aplica los cambios
 *   npx tsx prisma/regularizar-administradores-sede.ts --aplicar
 *
 * Misma convención que `purge-test-relics.ts`: sin `--aplicar` no se escribe
 * nada. No ejecutar contra producción sin aprobación explícita.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APLICAR = process.argv.includes('--aplicar');

interface Vinculo {
  id: string;
  estado: string;
  barberiaId: string | null;
  barberiaNombre: string | null;
  usuario: {
    id: string;
    correo: string;
    nombreCompleto: string;
    estadoCuenta: string;
    creadoAt: Date;
  };
}

/** Orden de preferencia: cuenta activa primero, luego la cuenta más antigua. */
function compararCandidatos(a: Vinculo, b: Vinculo): number {
  const aActiva = a.usuario.estadoCuenta === 'ACTIVO' ? 0 : 1;
  const bActiva = b.usuario.estadoCuenta === 'ACTIVO' ? 0 : 1;
  if (aActiva !== bActiva) return aActiva - bActiva;

  const diferencia = a.usuario.creadoAt.getTime() - b.usuario.creadoAt.getTime();
  if (diferencia !== 0) return diferencia;

  return a.id.localeCompare(b.id);
}

async function main(): Promise<void> {
  console.log('🛡️  Regularización de administradores por sede');
  console.log(
    `Modo: ${APLICAR ? 'APLICAR (desactiva vínculos de más)' : 'SIMULACIÓN (añade --aplicar para escribir)'}`,
  );

  const vinculos = (await prisma.usuarioRol.findMany({
    where: { estado: 'ACTIVO', rol: { nombre: 'ADMIN_BARBERIA' } },
    select: {
      id: true,
      estado: true,
      barberiaId: true,
      barberia: { select: { nombre: true } },
      usuario: {
        select: {
          id: true,
          correo: true,
          nombreCompleto: true,
          estadoCuenta: true,
          creadoAt: true,
        },
      },
    },
  })) as unknown as (Omit<Vinculo, 'barberiaNombre'> & {
    barberia: { nombre: string } | null;
  })[];

  const porSede = new Map<string, Vinculo[]>();
  for (const fila of vinculos) {
    if (!fila.barberiaId) {
      // Un ADMIN_BARBERIA sin sede es una fila corrupta: la regla de alcance la
      // ignora, pero conviene verla en el informe en vez de esconderla.
      console.log(
        `  ⚠ Vínculo ADMIN_BARBERIA sin sede: ${fila.usuario.correo} (${fila.id})`,
      );
      continue;
    }
    const lista = porSede.get(fila.barberiaId) ?? [];
    lista.push({ ...fila, barberiaNombre: fila.barberia?.nombre ?? null });
    porSede.set(fila.barberiaId, lista);
  }

  const conflictivas = [...porSede.entries()].filter(([, lista]) => lista.length > 1);

  console.log(`\nSedes con más de un administrador ACTIVO: ${conflictivas.length}`);

  const aDesactivar: string[] = [];

  for (const [barberiaId, lista] of conflictivas) {
    const ordenados = [...lista].sort(compararCandidatos);
    const [conserva, ...sobran] = ordenados;

    console.log(`\n  · ${conserva.barberiaNombre ?? barberiaId} (${barberiaId})`);
    console.log(
      `      conserva: ${conserva.usuario.correo} [${conserva.usuario.estadoCuenta}] (${conserva.usuario.nombreCompleto})`,
    );
    for (const vinculo of sobran) {
      console.log(
        `      desactiva: ${vinculo.usuario.correo} [${vinculo.usuario.estadoCuenta}] (${vinculo.usuario.nombreCompleto})`,
      );
      aDesactivar.push(vinculo.id);
    }
  }

  // Aviso aparte: sedes cuyo único administrador tiene la cuenta suspendida. No
  // es un duplicado, pero la sede queda sin nadie que pueda entrar y la regla
  // nueva no dejará nombrar reemplazo hasta regularizarlo.
  const sedesSinAdminUtil = [...porSede.entries()].filter(
    ([, lista]) => lista.length === 1 && lista[0].usuario.estadoCuenta !== 'ACTIVO',
  );

  if (sedesSinAdminUtil.length > 0) {
    console.log('\nSedes con administrador ACTIVO pero cuenta suspendida:');
    for (const [, [vinculo]] of sedesSinAdminUtil) {
      console.log(
        `  · ${vinculo.barberiaNombre ?? vinculo.barberiaId}: ${vinculo.usuario.correo}`,
      );
    }
    console.log(
      '  → Hay que reactivar la cuenta o desactivar su vínculo antes de nombrar otro dueño.',
    );
  }

  if (aDesactivar.length === 0) {
    console.log('\nNada que regularizar.');
    return;
  }

  if (!APLICAR) {
    console.log(
      `\nSimulación: se desactivarían ${aDesactivar.length} vínculo(s). Vuelve a ejecutar con --aplicar.`,
    );
    return;
  }

  const resultado = await prisma.usuarioRol.updateMany({
    where: { id: { in: aDesactivar } },
    data: { estado: 'INACTIVO' },
  });

  console.log(`\n✅ ${resultado.count} vínculo(s) pasaron a INACTIVO.`);
}

main()
  .catch((error) => {
    console.error('❌ Error durante la regularización:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
