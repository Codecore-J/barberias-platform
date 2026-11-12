// scripts/seed-qa-admin.ts
/**
 * Cuenta de administrador GLOBAL para el tenant de QA.
 *
 * Seguro de ejecutar varias veces (idempotente) y NO destructivo:
 *  1. Garantiza el usuario `admin.qa@barberias.demo` (upsert por correo).
 *  2. Garantiza su rol `ADMINISTRADOR` GLOBAL (`barberia_id = NULL`).
 *
 * No borra ni purga ningún otro usuario: una cuenta de QA no puede justificar
 * tocar datos ajenos. Si necesitas limpiar cuentas de prueba, hazlo con un
 * script explícito y acotado a un tenant.
 *
 * Variables (opcionales):
 *   QA_ADMIN_EMAIL     · correo de la cuenta           (def. admin.qa@barberias.demo)
 *   QA_ADMIN_TELEFONO  · teléfono de 10 dígitos        (def. 9555555555)
 *   QA_ADMIN_PASSWORD  · contraseña a fijar            (def. QA_USERS_PASSWORD / Password123!)
 *
 * En producción exige `CONFIRM_QA_SEED=YES`, igual que `prisma/seed-qa.ts`.
 *
 * ⚠️ Advertencia de seguridad: los valores por defecto de la tabla anterior son
 * públicos (viven en el repositorio). Solo son aceptables en un sandbox efímero.
 * Si esta cuenta se siembra contra un entorno que maneja datos reales, define
 * QA_ADMIN_PASSWORD (o QA_USERS_PASSWORD) con un secreto propio, rótala de
 * inmediato y no la reutilices de un entorno a otro.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';

// `tsx` no carga `.env` por su cuenta (el CLI de Prisma sí): sin esto las
// variables de entorno del archivo nunca llegarían al proceso.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // `.env` ilegible: se usan solo las variables del entorno real.
  }
}

const prisma = new PrismaClient({ log: ['error'] });

const ROL_ADMINISTRADOR = 'ADMINISTRADOR';
const SALT_ROUNDS = 10;

const ADMIN_EMAIL = (process.env.QA_ADMIN_EMAIL || 'admin.qa@barberias.demo')
  .trim()
  .toLowerCase();
const TELEFONO = process.env.QA_ADMIN_TELEFONO || '9555555555';
const PASSWORD =
  process.env.QA_ADMIN_PASSWORD || process.env.QA_USERS_PASSWORD || 'Password123!';
const NOMBRE = 'Admin QA';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO_RE = /^\d{10}$/;

function abortar(mensaje: string): never {
  console.error('❌ ' + mensaje);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!EMAIL_RE.test(ADMIN_EMAIL)) {
    abortar(`QA_ADMIN_EMAIL no es un correo válido: ${ADMIN_EMAIL}`);
  }
  if (!TELEFONO_RE.test(TELEFONO)) {
    abortar(`QA_ADMIN_TELEFONO debe tener 10 dígitos: ${TELEFONO}`);
  }

  const entornoProduccion =
    process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
  if (entornoProduccion && process.env.CONFIRM_QA_SEED !== 'YES') {
    abortar(
      'Entorno de producción sin CONFIRM_QA_SEED=YES. ' +
        'Ejecuta: CONFIRM_QA_SEED=YES APP_ENV=production npm run admin:qa',
    );
  }

  // El teléfono es único y no se reasigna a otro usuario: eso rompería su OTP.
  const telefonoOcupado = await prisma.usuario.findFirst({
    where: { telefono: TELEFONO, NOT: { correo: ADMIN_EMAIL } },
    select: { correo: true },
  });
  if (telefonoOcupado) {
    abortar(
      `El teléfono ${TELEFONO} ya pertenece a ${telefonoOcupado.correo}. ` +
        'Define QA_ADMIN_TELEFONO con otro número.',
    );
  }

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  // Transacción interactiva: `tx` existe desde la primera línea, sin índices
  // prematuros sobre un array que aún no se ha ejecutado.
  const resultado = await prisma.$transaction(async (tx) => {
    const rol = await tx.rol.findUnique({
      where: { nombre: ROL_ADMINISTRADOR },
      select: { id: true, ambito: true },
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

    const usuario = await tx.usuario.upsert({
      where: { correo: ADMIN_EMAIL },
      update: {
        nombreCompleto: NOMBRE,
        telefono: TELEFONO,
        passwordHash,
        estadoCuenta: 'ACTIVO',
        correoVerificado: true,
        telefonoVerificado: true,
        tokenVersion: { increment: 1 },
      },
      create: {
        correo: ADMIN_EMAIL,
        nombreCompleto: NOMBRE,
        telefono: TELEFONO,
        passwordHash,
        estadoCuenta: 'ACTIVO',
        correoVerificado: true,
        telefonoVerificado: true,
        tokenVersion: 1,
      },
      select: { id: true, correo: true },
    });

    const asignacion = await tx.usuarioRol.findFirst({
      where: { usuarioId: usuario.id, rolId: rol.id, barberiaId: null },
      select: { id: true, estado: true },
    });

    if (!asignacion) {
      await tx.usuarioRol.create({
        data: {
          usuarioId: usuario.id,
          rolId: rol.id,
          barberiaId: null,
          estado: 'ACTIVO',
        },
      });
    } else if (asignacion.estado !== 'ACTIVO') {
      await tx.usuarioRol.update({
        where: { id: asignacion.id },
        data: { estado: 'ACTIVO' },
      });
    }

    return { usuario, creada: !asignacion };
  });

  console.log(
    `ADMIN_QA_READY correo=${resultado.usuario.correo} rol=${ROL_ADMINISTRADOR} ` +
      `asignacion=${resultado.creada ? 'creada' : 'existente'}`,
  );
}

main()
  .catch((e: unknown) => {
    console.error('❌ ' + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
