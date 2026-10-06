/**
 * SEED DE USUARIOS DEMO (entorno local de preview)
 *
 * Crea las tres cuentas que los botones "ACCESO RÁPIDO DEMO" de la pantalla de
 * login rellenan (cliente@demo.com / barbero@demo.com / admin@demo.com) con la
 * contraseña estática que esos botones usan (Password123!), más una barbería
 * demo para poder vincularse/seleccionar desde la UI.
 *
 * Regla E0-07: la contraseña NO se escribe en el código; se toma de la variable
 * de entorno DEMO_USERS_PASSWORD y el script solo corre con APP_ENV=dev.
 * (Debe coincidir con la que rellena fillDemo() en login.component.ts.)
 *
 * Ejecutar con la DATABASE_URL apuntando a la base local:
 *   APP_ENV=dev DEMO_USERS_PASSWORD=<valor> DATABASE_URL="postgresql://...@localhost:5432/barberias_db" npx tsx prisma/seed-demo-users.ts
 * Re-ejecutable (idempotente).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Guard E0-07: este seed solo tiene sentido en entorno local de desarrollo.
if (process.env.APP_ENV !== 'dev') {
  console.error('ABORTADO (E0-07): este seed solo puede ejecutarse con APP_ENV=dev.');
  process.exit(1);
}

const PASSWORD = process.env.DEMO_USERS_PASSWORD;
if (!PASSWORD) {
  console.error('ABORTADO (E0-07): falta la variable de entorno DEMO_USERS_PASSWORD.');
  process.exit(1);
}

const prisma = new PrismaClient();
const CODIGO_ACCESO = 'DEMO2026';

async function upsertUsuario(
  correo: string,
  nombreCompleto: string,
  telefono: string,
): Promise<string> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const usuario = await prisma.usuario.upsert({
    where: { correo },
    update: { passwordHash },
    create: { correo, nombreCompleto, telefono, passwordHash },
  });
  return usuario.id;
}

async function asignarRol(
  usuarioId: string,
  nombreRol: string,
  barberiaId: string | null = null,
): Promise<void> {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { nombre: nombreRol } });
  // Limpia cualquier asignación previa del par usuario/rol (cualquier scope)
  // para que la re-ejecución no duplique filas a pesar de que el índice único
  // compuesto ignora filas con barberia_id NULL.
  await prisma.usuarioRol.deleteMany({ where: { usuarioId, rolId: rol.id } });
  await prisma.usuarioRol.create({ data: { usuarioId, rolId: rol.id, barberiaId } });
}

async function main() {
  console.log('🌱 Seed de usuarios demo (preview local)...');

  const adminId = await upsertUsuario('admin@demo.com', 'Admin Demo', '3000000001');
  const barberoId = await upsertUsuario('barbero@demo.com', 'Barbero Demo', '3000000002');
  const clienteId = await upsertUsuario('cliente@demo.com', 'Cliente Demo', '3000000003');

  const barberia = await prisma.barberia.upsert({
    where: { codigoAcceso: CODIGO_ACCESO },
    update: { responsableId: adminId },
    create: {
      nombre: 'Imperial Barbers Demo',
      descripcion: 'Barbería de demostración para el entorno local de preview',
      telefono: '3000000000',
      ubicacion: 'Calle Demo 123, Ciudad',
      codigoAcceso: CODIGO_ACCESO,
      enlaceUnico: 'imperial-barbers-demo',
      responsableId: adminId,
    },
  });

  await asignarRol(adminId, 'CLIENTE');
  await asignarRol(adminId, 'ADMINISTRADOR');
  await asignarRol(barberoId, 'CLIENTE');
  await asignarRol(barberoId, 'BARBERO', barberia.id);
  await asignarRol(clienteId, 'CLIENTE');

  console.log('✅ Usuarios demo creados: admin@demo.com, barbero@demo.com, cliente@demo.com');
  console.log(`   (contraseña de los tres: la que rellenan los botones demo)`);
  console.log(`✅ Barbería demo: ${barberia.nombre} — código de acceso ${CODIGO_ACCESO}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
