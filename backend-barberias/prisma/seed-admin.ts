// prisma/seed-admin.ts
// Script para inyectar/asegurar la cuenta de administrador GLOBAL en producción.
// Ejecutar: npm run seed:admin
//
// Es idempotente: se puede ejecutar las veces que haga falta sin duplicar filas.
// Garantiza las TRES cosas que necesita un administrador global:
//   1. El usuario existe y tiene la contraseña vigente.
//   2. Existe el rol ADMINISTRADOR (ámbito GLOBAL) en `roles`.
//   3. Existe la asignación `usuario_roles` con `barberia_id = NULL`, que es la
//      que hace viajar `ADMINISTRADOR` en el JWT y abre el panel.
//
// No crea sedes: un ADMINISTRADOR global no necesita ser responsable de ninguna
// y el panel le muestra todas las activas. Sembrar una sede ficticia con un
// `responsable_id` inventado solo ensuciaba la base.
//
// CREDENCIALES · nunca se escriben en el código ni en el repositorio.
//   SEED_ADMIN_EMAIL      correo de la cuenta maestra
//   SEED_ADMIN_PASSWORD   contraseña a fijar (obligatoria en todos los entornos)
//   SEED_ADMIN_TELEFONO   teléfono de 10 dígitos, único en `usuarios`
//
// En producción (APP_ENV o NODE_ENV = production) las tres son obligatorias y el
// script aborta con código 1 si falta alguna: es preferible no sembrar nada a
// sembrar una cuenta con credenciales por defecto. En desarrollo local, el correo
// y el teléfono admiten un valor de conveniencia (se avisa por consola); la
// contraseña también se exige allí para no dejar un acceso predecible.
//
// Ejemplo:
//   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_ADMIN_TELEFONO=... npm run seed:admin

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;
const ROL_ADMINISTRADOR = 'ADMINISTRADOR';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO_RE = /^\d{10}$/;
const PASSWORD_MIN_LENGTH = 8;

/** Valores de conveniencia SOLO para desarrollo local; nunca se usan en producción. */
const DEFAULTS_LOCALES = {
  correo: 'admin.local@barberias.demo',
  telefono: '3000000000',
};

function logOk(msg: string): void {
  console.log('✅ ' + msg);
}

function logInfo(msg: string): void {
  console.log('   ' + msg);
}

function abortar(mensaje: string): never {
  console.error('❌ ' + mensaje);
  process.exit(1);
}

interface CredencialesSeed {
  correo: string;
  telefono: string;
  passwordPlain: string;
}

/**
 * Resuelve y valida las credenciales ANTES de abrir la conexión a la base:
 * una configuración inválida no debe llegar a tocar producción.
 */
function leerCredenciales(): CredencialesSeed {
  const entornoProduccion =
    process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';

  const crudo = {
    correo: process.env.SEED_ADMIN_EMAIL?.trim(),
    telefono: process.env.SEED_ADMIN_TELEFONO?.trim(),
    passwordPlain: process.env.SEED_ADMIN_PASSWORD,
  };

  // La contraseña no tiene valor por defecto en ningún entorno: un fallback aquí
  // sería exactamente el agujero que este refactor elimina.
  if (!crudo.passwordPlain) {
    abortar(
      'Falta SEED_ADMIN_PASSWORD. ' +
        'Ejecuta: SEED_ADMIN_PASSWORD=<contraseña> SEED_ADMIN_EMAIL=<correo> ' +
        'SEED_ADMIN_TELEFONO=<10 dígitos> npm run seed:admin',
    );
  }

  if (entornoProduccion && (!crudo.correo || !crudo.telefono)) {
    const faltan = [
      !crudo.correo ? 'SEED_ADMIN_EMAIL' : null,
      !crudo.telefono ? 'SEED_ADMIN_TELEFONO' : null,
    ].filter(Boolean);
    abortar(
      `Entorno de producción sin ${faltan.join(' ni ')}. ` +
        'No se siembran credenciales por defecto: define las variables y reintenta.',
    );
  }

  if (!crudo.correo || !crudo.telefono) {
    logInfo(
      'Aviso: usando valores locales de conveniencia para ' +
        (!crudo.correo ? 'SEED_ADMIN_EMAIL ' : '') +
        (!crudo.telefono ? 'SEED_ADMIN_TELEFONO' : '') +
        ' (solo desarrollo).',
    );
  }

  const correo = (crudo.correo ?? DEFAULTS_LOCALES.correo).toLowerCase();
  const telefono = crudo.telefono ?? DEFAULTS_LOCALES.telefono;
  const passwordPlain = crudo.passwordPlain;

  if (!EMAIL_RE.test(correo)) {
    abortar(`SEED_ADMIN_EMAIL no es un correo válido: ${correo}`);
  }
  if (!TELEFONO_RE.test(telefono)) {
    abortar(`SEED_ADMIN_TELEFONO debe tener 10 dígitos: ${telefono}`);
  }
  if (passwordPlain.length < PASSWORD_MIN_LENGTH) {
    abortar(
      `SEED_ADMIN_PASSWORD debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }

  return { correo, telefono, passwordPlain };
}

async function main(): Promise<void> {
  const adminData = leerCredenciales();
  const prisma = new PrismaClient();

  try {
    // PASO 1 · El rol debe existir y ser GLOBAL. Sin esta fila no hay nada que
    // asignar: abortar es mejor que crear un usuario a medias.
    logInfo('Verificando el rol ' + ROL_ADMINISTRADOR + '...');
    const rol = await prisma.rol.findUnique({
      where: { nombre: ROL_ADMINISTRADOR },
      select: { id: true, nombre: true, ambito: true },
    });

    if (!rol) {
      throw new Error(
        `No existe el rol ${ROL_ADMINISTRADOR}. Ejecuta \`npm run seed\` antes de este script.`,
      );
    }
    if (rol.ambito !== 'GLOBAL') {
      throw new Error(
        `El rol ${ROL_ADMINISTRADOR} tiene ámbito ${rol.ambito}; se esperaba GLOBAL.`,
      );
    }
    logOk('Rol ' + ROL_ADMINISTRADOR + ' disponible (' + rol.id + ')');

    // PASO 2 · El teléfono es único y no se reasigna en silencio: cambiar el
    // teléfono de otra cuenta rompería su verificación OTP. Si está ocupado,
    // el operador decide.
    const telefonoOcupado = await prisma.usuario.findFirst({
      where: { telefono: adminData.telefono, NOT: { correo: adminData.correo } },
      select: { correo: true },
    });
    if (telefonoOcupado) {
      throw new Error(
        `El teléfono ${adminData.telefono} ya pertenece a ${telefonoOcupado.correo}. ` +
          'Libera ese teléfono o define otro SEED_ADMIN_TELEFONO.',
      );
    }

    // PASO 3 · Upsert del usuario. La contraseña se hashea ANTES del upsert para
    // que una sola escritura deje el hash y el `tokenVersion` definitivos: así
    // se invalidan las sesiones viejas una única vez y no queda una ventana con
    // `password_hash` vacío.
    logInfo('Creando/actualizando usuario administrador...');
    const passwordHash = await bcrypt.hash(adminData.passwordPlain, SALT_ROUNDS);

    const usuario = await prisma.usuario.upsert({
      where: { correo: adminData.correo },
      update: {
        telefono: adminData.telefono,
        passwordHash,
        estadoCuenta: 'ACTIVO',
        correoVerificado: true,
        telefonoVerificado: true,
        tokenVersion: { increment: 1 },
      },
      create: {
        correo: adminData.correo,
        nombreCompleto: 'Admin Global',
        telefono: adminData.telefono,
        passwordHash,
        estadoCuenta: 'ACTIVO',
        correoVerificado: true,
        telefonoVerificado: true,
        tokenVersion: 1,
      },
      select: { id: true, correo: true },
    });
    logOk('Usuario administrador listo: ' + usuario.correo);

    // PASO 4 · La asignación GLOBAL. El índice parcial
    // `uk_usuario_rol_global` no es expresable en Prisma, así que el "upsert"
    // se hace con búsqueda previa dentro de la misma transacción lógica.
    logInfo('Garantizando el rol global del usuario...');
    const asignacion = await prisma.usuarioRol.findFirst({
      where: { usuarioId: usuario.id, rolId: rol.id, barberiaId: null },
      select: { id: true, estado: true },
    });

    if (!asignacion) {
      await prisma.usuarioRol.create({
        data: {
          usuarioId: usuario.id,
          rolId: rol.id,
          barberiaId: null,
          estado: 'ACTIVO',
        },
      });
      logOk('Rol ' + ROL_ADMINISTRADOR + ' asignado (barberiaId = null)');
    } else if (asignacion.estado !== 'ACTIVO') {
      await prisma.usuarioRol.update({
        where: { id: asignacion.id },
        data: { estado: 'ACTIVO' },
      });
      logOk('Asignación existente reactivada (' + asignacion.id + ')');
    } else {
      logOk('El usuario ya tenía el rol ' + ROL_ADMINISTRADOR + ' global');
    }

    logOk('================================================================');
    logInfo('PROCESO COMPLETADO');
    logInfo('Admin: ' + usuario.correo);
    logInfo('Rol: ' + ROL_ADMINISTRADOR + ' (GLOBAL, barberiaId = null)');
    logInfo('Cierra sesión y vuelve a entrar para recibir el JWT con el rol.');
    logOk('================================================================');
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error('❌ ' + mensaje);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
