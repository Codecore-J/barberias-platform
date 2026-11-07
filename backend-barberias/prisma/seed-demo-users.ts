/**
 * SEED DE USUARIOS DEMO (entorno local de preview)
 *
 * Crea las tres cuentas que los botones "ACCESO RÁPIDO DEMO" de la pantalla de
 * login rellenan (cliente@demo.com / barbero@demo.com / admin@demo.com) con la
 * contraseña estática que esos botones usan (Password123!), más una barbería
 * demo para poder vincularse/seleccionar desde la UI.
 *
 * Regla E0-07: el script solo corre con APP_ENV=dev. La contraseña se toma de
 * DEMO_USERS_PASSWORD y, si no está definida, cae al valor que rellena
 * `fillDemo()` en login.component.ts: los botones son un fixture de desarrollo y
 * su contraseña ya viaja en el bundle del cliente, así que exigir una variable
 * extra solo producía botones que devolvían 401 en una base recién creada
 * (I-07). La barrera real contra producción es el guard de APP_ENV.
 *
 * Ejecutar (un solo comando; lee el `.env` del backend si hace falta):
 *   npm run seed:demo
 * Re-ejecutable (idempotente).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';

// I-07 · sin este bootstrap el operador tenía que exportar APP_ENV y
// DEMO_USERS_PASSWORD a mano, y en Windows `APP_ENV=dev cmd` ni siquiera existe.
// Prisma ya carga DATABASE_URL por su cuenta; esto cubre las variables del seed.
if (!process.env.APP_ENV && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env ilegible: lo decide el guard de abajo con su mensaje.
  }
}

// Guard E0-07: este seed solo tiene sentido en entorno local de desarrollo.
if (process.env.APP_ENV !== 'dev') {
  console.error('ABORTADO (E0-07): este seed solo puede ejecutarse con APP_ENV=dev.');
  process.exit(1);
}

/** La misma que rellena `fillDemo()` en `login.component.ts`. */
const PASSWORD_POR_DEFECTO = 'Password123!';

const PASSWORD = process.env.DEMO_USERS_PASSWORD ?? PASSWORD_POR_DEFECTO;
if (!process.env.DEMO_USERS_PASSWORD) {
  console.warn(
    '⚠️  DEMO_USERS_PASSWORD no definida: se usa la del botón demo del login.',
  );
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
    // I-07 · `telefonoVerificado` es obligatorio para que los botones demo sirvan
    // de algo: `authGuard` manda a /auth/verify a todo cliente sin teléfono
    // verificado, así que el botón 👤 Cliente aterrizaba en un OTP que nadie iba
    // a recibir en una cuenta sembrada.
    update: { passwordHash, telefonoVerificado: true, estadoCuenta: 'ACTIVO' },
    create: {
      correo,
      nombreCompleto,
      telefono,
      passwordHash,
      telefonoVerificado: true,
      estadoCuenta: 'ACTIVO',
    },
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
