/**
 * E0-07 · alta segura del primer ADMINISTRADOR global (D36).
 *
 * Uso:
 *   APP_ENV=dev ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' \
 *   ADMIN_PHONE=8090000000 npm run admin:create
 *
 * Reglas:
 *  - La contraseña NUNCA se escribe en el código ni se imprime.
 *  - Mínimo 12 caracteres.
 *  - En producción exige además CONFIRM_CREATE_ADMIN=yes.
 *  - Es idempotente: si el usuario existe, actualiza su contraseña y asegura
 *    la fila GLOBAL de `usuario_roles` (barberia_id NULL).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const APP_ENVS = ['dev', 'staging', 'production'];
const MIN_PASSWORD_LENGTH = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function abortar(mensaje: string): never {
  console.error(`ABORTADO (E0-07): ${mensaje}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV;

  if (!appEnv || !APP_ENVS.includes(appEnv)) {
    abortar(`APP_ENV es obligatorio y debe ser uno de: ${APP_ENVS.join(', ')}.`);
  }

  if (appEnv === 'production' && process.env.CONFIRM_CREATE_ADMIN !== 'yes') {
    abortar('en producción exige CONFIRM_CREATE_ADMIN=yes.');
  }

  const correo = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!correo || !EMAIL_RE.test(correo)) {
    abortar('falta ADMIN_EMAIL o no tiene un formato de correo válido.');
  }

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    abortar(`ADMIN_PASSWORD es obligatorio y debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  // Se valida siempre (antes de tocar la base) aunque solo se use al crear:
  // `usuarios.telefono` es UNIQUE y un relleno fijo haría fallar al segundo
  // administrador. En una rotación de contraseña el valor se ignora.
  const telefono = process.env.ADMIN_PHONE?.trim();
  if (!telefono) {
    abortar('falta ADMIN_PHONE (obligatorio: `usuarios.telefono` es único).');
  }

  const rol = await prisma.rol.findUnique({
    where: { nombre: 'ADMINISTRADOR' },
    select: { id: true, nombre: true, ambito: true },
  });

  if (!rol) {
    abortar('el rol ADMINISTRADOR no existe. Ejecuta `npm run seed` primero.');
  }

  if (rol.ambito !== 'GLOBAL') {
    abortar(`el rol ADMINISTRADOR tiene ámbito ${rol.ambito}; se esperaba GLOBAL.`);
  }

  const existente = await prisma.usuario.findUnique({
    where: { correo },
    select: { id: true },
  });

  const passwordHash = await bcrypt.hash(password, 10);
  const nombreCompleto =
    process.env.ADMIN_NAME?.trim() || 'Administrador de plataforma';

  // D48: este script NO escribe `estado_cuenta`. El alta nace ACTIVO por el
  // valor por defecto del esquema y una cuenta suspendida no se reactiva por
  // crear un administrador: eso sigue siendo una decisión manual auditada.
  let usuario: { id: string; correo: string };

  if (existente) {
    usuario = await prisma.usuario.update({
      where: { id: existente.id },
      data: { passwordHash },
      select: { id: true, correo: true },
    });
  } else {
    usuario = await prisma.usuario.create({
      data: { correo, nombreCompleto, telefono, passwordHash },
      select: { id: true, correo: true },
    });
  }

  const yaTieneRol = await prisma.usuarioRol.findFirst({
    where: {
      usuarioId: usuario.id,
      rolId: rol.id,
      barberiaId: null,
    },
    select: { id: true },
  });

  if (!yaTieneRol) {
    await prisma.usuarioRol.create({
      data: {
        usuarioId: usuario.id,
        rolId: rol.id,
        barberiaId: null,
      },
    });
  }

  console.log(
    `Administrador global listo: ${usuario.correo} (${usuario.id}). ` +
      'La contraseña no se muestra.',
  );
}

main()
  .catch((error) => {
    console.error('Error al crear el administrador:', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
