/**
 * H-02 · limpieza de teléfonos corruptos (`600NaN2222`).
 *
 * Los valores con `NaN` en `barberias.telefono` son restos de una concatenación
 * con una conversión numérica fallida, anteriores a la validación estricta del
 * DTO. La auditoría E2E del 2026-11-03 encontró 10 filas así.
 *
 * Uso:
 *   # simulación (no escribe nada, solo informa)
 *   node --env-file=.env scripts/fix-corrupted-phones.ts
 *
 *   # aplica los cambios, dejando antes una copia de seguridad en JSON
 *   node --env-file=.env scripts/fix-corrupted-phones.ts --aplicar
 *
 * Reglas:
 *  - Solo se consideran filas cuyo `telefono` no cumple `^\d{10}$`.
 *  - Si al quitar los caracteres no numéricos quedan exactamente 10 dígitos, el
 *    valor se reconstruye tal cual (no se inventa nada). Un número con 9 u 11
 *    dígitos NO se recorta ni se rellena: es ambiguo y se deja para revisión.
 *  - Si no se puede reconstruir (el caso `600NaN2222` → `6002222`), la fila no
 *    tiene arreglo deducible: se rellena con `--placeholder` (por defecto
 *    `0000000000`) y queda listada para revisión manual. El valor original se
 *    conserva en la copia de seguridad.
 *  - En `usuarios.telefono` (UNIQUE y NOT NULL) nunca se escribe el marcador:
 *    varias filas colisionarían. Ahí solo se reconstruyen los recuperables y el
 *    resto se reporta.
 *
 * Uso interno del proyecto: es una herramienta puntual, no forma parte del
 * arranque ni del seed.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();

const PATRON_TELEFONO = /^\d{10}$/;
const APLICAR = process.argv.includes('--aplicar');
const PLACEHOLDER =
  process.argv.find((arg) => arg.startsWith('--placeholder='))?.split('=')[1] ?? '0000000000';

interface FilaAfectada {
  id: string;
  nombre: string;
  telefonoOriginal: string;
  telefonoNuevo: string | null;
  recuperable: boolean;
}

/**
 * Quita todo lo que no sea dígito, SIN recortar.
 *
 * El recorte a 10 es deliberado que no ocurra aquí: `82990010000` (11 dígitos)
 * recortado daría `8299001000`, que parece válido pero es un número inventado.
 * Solo se considera recuperable lo que ya tiene 10 dígitos tras limpiar
 * separadores; el resto se reporta para revisión humana.
 */
const soloDigitos = (valor: string): string => (valor ?? '').replace(/\D/g, '');

function planificar(
  filas: { id: string; nombre: string; telefono: string }[],
  permitirPlaceholder: boolean,
): FilaAfectada[] {
  return filas.map((fila) => {
    const digitos = soloDigitos(fila.telefono ?? '');
    const recuperable = PATRON_TELEFONO.test(digitos);

    return {
      id: fila.id,
      nombre: fila.nombre,
      telefonoOriginal: fila.telefono,
      telefonoNuevo: recuperable ? digitos : permitirPlaceholder ? PLACEHOLDER : null,
      recuperable,
    };
  });
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('ABORTADO: falta DATABASE_URL. Ejecuta con `node --env-file=.env …`.');
    process.exitCode = 1;
    return;
  }

  if (!PATRON_TELEFONO.test(PLACEHOLDER)) {
    console.error(`ABORTADO: --placeholder debe tener 10 dígitos (recibido "${PLACEHOLDER}").`);
    process.exitCode = 1;
    return;
  }

  const barberias = await prisma.barberia.findMany({
    where: { telefono: { contains: 'NaN', mode: 'insensitive' } },
    select: { id: true, nombre: true, telefono: true },
    orderBy: { nombre: 'asc' },
  });

  // Por si hay teléfonos sucios sin la cadena "NaN" literal (espacios, guiones,
  // paréntesis): el criterio real es «no cumple el contrato de 10 dígitos».
  const barberiasInvalidas = await prisma.$queryRawUnsafe<
    { id: string; nombre: string; telefono: string }[]
  >("SELECT id, nombre, telefono FROM barberias WHERE telefono !~ '^[0-9]{10}$' ORDER BY nombre");

  const usuarios = await prisma.$queryRawUnsafe<
    { id: string; nombre: string; telefono: string }[]
  >(
    "SELECT id, nombre_completo AS nombre, telefono FROM usuarios WHERE telefono !~ '^[0-9]{10}$' ORDER BY nombre_completo",
  );

  const planBarberias = planificar(barberiasInvalidas, true);
  const planUsuarios = planificar(usuarios, false);

  console.log(`Modo: ${APLICAR ? 'APLICAR' : 'SIMULACIÓN (añade --aplicar para escribir)'}`);
  console.log(`Sedes con teléfono inválido: ${planBarberias.length} (de ellas con "NaN": ${barberias.length})`);
  console.log(`Usuarios con teléfono inválido: ${planUsuarios.length}`);

  for (const fila of [...planBarberias, ...planUsuarios]) {
    const destino = fila.telefonoNuevo ?? '(sin cambio: requiere revisión manual)';
    console.log(
      `  · [${fila.recuperable ? 'RECUPERABLE' : 'SIN ARREGLO DEDUCIBLE'}] ${fila.nombre}: "${fila.telefonoOriginal}" → "${destino}"`,
    );
  }

  if (!APLICAR) {
    console.log('\nNo se ha escrito nada. Vuelve a ejecutarlo con --aplicar.');
    return;
  }

  const aplicables = [...planBarberias, ...planUsuarios].filter((fila) => fila.telefonoNuevo);
  if (aplicables.length === 0) {
    console.log('\nNada que actualizar.');
    return;
  }

  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const carpeta = join(process.cwd(), 'scratch');
  mkdirSync(carpeta, { recursive: true });
  const respaldo = join(carpeta, `telefonos-corruptos-${marca}.json`);
  writeFileSync(respaldo, JSON.stringify(aplicables, null, 2), 'utf8');
  console.log(`\nCopia de seguridad: ${respaldo}`);

  let sedes = 0;
  let cuentas = 0;

  for (const fila of planBarberias) {
    if (!fila.telefonoNuevo) continue;
    await prisma.barberia.update({
      where: { id: fila.id },
      data: { telefono: fila.telefonoNuevo },
    });
    sedes += 1;
  }

  for (const fila of planUsuarios) {
    if (!fila.telefonoNuevo) continue;
    await prisma.usuario.update({
      where: { id: fila.id },
      data: { telefono: fila.telefonoNuevo },
    });
    cuentas += 1;
  }

  console.log(`Sedes actualizadas: ${sedes}. Cuentas actualizadas: ${cuentas}.`);

  const pendientes = [...planBarberias, ...planUsuarios].filter((fila) => !fila.telefonoNuevo);
  if (pendientes.length > 0) {
    console.log(`\n${pendientes.length} registro(s) necesitan revisión manual:`);
    for (const fila of pendientes) {
      console.log(`  · ${fila.nombre} (${fila.id}): "${fila.telefonoOriginal}"`);
    }
  }
}

main()
  .catch((error) => {
    console.error('Error al limpiar los teléfonos:', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
