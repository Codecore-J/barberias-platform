// scripts/seed-qa-admin.ts
/**
 * Solo para QA aislado:
 *  1. Crea UN ADMINISTRADOR GLOBAL permanente (ROL_ADMINISTRADOR, ámbito GLOBAL).
 *  2. Inmediatamente elimina el resto de usuarios de la entidad (todos los que
 *     no tengan el mismo correo). Así queda la cuenta de admin como única y
 *     estable para las pruebas de sesión, panel y E2E de vinculación.
 *
 * No toca datos de producción: se ejecuta en QA/tenant, y el correo/telefono
 * se leen de variables de entorno (QA_ADMIN_EMAIL, QA_ADMIN_TELEFONO),
 * nunca de código.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({ log: ['error'] });

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL || 'admin.cremaq.production@test.com';
const NOMBRE = 'Admin QA de Producción';
const TELEFONO = process.env.QA_ADMIN_TELEFONO || '9555555555';
// Solo para esta sesión: cambia antes de que se use en producción.
const PASSWORD = process.env.QA_ADMIN_PASSWORD || 'qa-segura-42';

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const tx = await prisma.$transaction([
    prisma.usuario.create({
      data: {
        nombreCompleto: NOMBRE,
        correo: ADMIN_EMAIL,
        telefono: TELEFONO,
        passwordHash,
        estadoCuenta: 'ACTIVO',
      },
      select: { id: true },
    }),
    prisma.usuarioRol.create({
      data: {
        usuarioId: tx[0].id,
        rolId: (await prisma.rol.findUnique({ where: { nombre: 'ADMINISTRADOR' } })).id,
        barberiaId: null,
      },
    }),
  ]);

  console.log(`ADMIN_CREATED id=${tx[0].id} correo=${ADMIN_EMAIL}`);

  const todos = await prisma.usuario.findMany({
    where: { NOT: { correo: ADMIN_EMAIL } },
    select: { id: true, correo: true },
  });

  for (const u of todos) {
    try {
      await prisma.usuario.delete({ where: { id: u.id } });
      console.log(`DELETED correo=${u.correo}`);
    } catch (e) {
      console.log(`SKIP correo=${u.correo} error=${String((e as Error).message)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
