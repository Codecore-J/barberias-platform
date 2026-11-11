/**
 * SEED QA / SANDBOX (tenant de prueba aislado, idempotente)
 *
 * Crea una sede de prueba aislada ("Sede Sandbox QA", código QA2026) y cuentas
 * sintéticas para auditar en vivo módulos que requieren privilegios de sede
 * (gestión de sucursal, usuarios/roles de la sede, bandeja de propuestas y
 * supervisión de citas) SIN tocar datos reales.
 *
 * SEGURIDAD / AISLAMIENTO (verificado contra el código):
 * - Ninguna cuenta recibe el rol global ADMINISTRADOR (plataforma). El admin QA
 *   es ADMIN_BARBERIA con ámbito limitado a la sede QA (UsuarioRol.barberiaId).
 * - VinculoBarberiaGuard concede acceso de staff solo por UsuarioRol ACTIVO
 *   (usuarioId, barberiaId) y acceso de cliente solo por ClienteBarberia ACTIVA
 *   (usuarioId, barberiaId), siempre sobre una barbería en estado ACTIVO.
 * - RolesGuard/alcance resuelven permisos por rol+barberiaId: un ADMIN_BARBERIA
 *   de la sede QA no satisface alcance sobre otra sede. No hay privilegio cruzado.
 *
 * IDEMPOTENTE (upsert / find-or-create acotado a la sede QA): re-ejecutable
 * contra la misma BD (incluida Neon/prod) sin duplicar ni alterar sedes reales.
 *
 * Salvaguarda: si APP_ENV o NODE_ENV es "production", exige CONFIRM_QA_SEED=YES
 * para evitar ejecuciones accidentales. La contraseña de prueba se toma de
 * QA_USERS_PASSWORD (nunca se imprime); por defecto usa la convención demo.
 *
 * Ejecutar (apuntando a la BD objetivo mediante DATABASE_URL en el entorno):
 *   # local/dev
 *   npm run seed:qa
 *   # producción (Neon) — SOLO con autorización explícita y DATABASE_URL de prod
 *   CONFIRM_QA_SEED=YES APP_ENV=production npm run seed:qa
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';

// Carga .env local si existe (útil en dev); en entornos gestionados DATABASE_URL
// ya viene inyectada y este bloque es inofensivo.
if (!process.env.DATABASE_URL && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* lo reporta Prisma si falta DATABASE_URL */
  }
}

const ES_PRODUCCION =
  process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
if (ES_PRODUCCION && process.env.CONFIRM_QA_SEED !== 'YES') {
  console.error(
    'ABORTADO: APP_ENV/NODE_ENV=production requiere CONFIRM_QA_SEED=YES para ejecutar el seed QA.',
  );
  console.error(
    'Ejecuta solo con autorización explícita y entendiendo que escribe en la BD objetivo (idempotente, acotado a la sede QA).',
  );
  process.exit(1);
}

const PASSWORD = process.env.QA_USERS_PASSWORD ?? 'Password123!';
if (!process.env.QA_USERS_PASSWORD) {
  console.warn(
    '⚠️  QA_USERS_PASSWORD no definida: se usa la contraseña de convención demo (cuentas QA).',
  );
}

const prisma = new PrismaClient();

// ── Identificadores fijos (claves naturales para idempotencia) ───────────────
const QA = {
  barberia: {
    codigoAcceso: 'QA2026',
    enlaceUnico: 'sede-sandbox-qa',
    nombre: 'Sede Sandbox QA',
    descripcion:
      'Sede de prueba aislada para QA en vivo. No usar para operaciones reales.',
    telefono: '3000000090', // 10 dígitos, cumple CHECK
    ubicacion: 'Entorno QA / Sandbox (no es una sede real)',
  },
  admin: {
    correo: 'admin.qa@barberias.demo',
    nombre: 'Administrador QA',
    telefono: '3000000091',
  },
  barbero: {
    correo: 'barbero.qa@barberias.demo',
    nombre: 'Barbero QA',
    telefono: '3000000092',
  },
  cliente: {
    correo: 'cliente.qa@barberias.demo',
    nombre: 'Cliente QA',
    telefono: '3000000093',
  },
  servicio: {
    nombre: 'Corte QA (Sandbox)',
    precio: '15000.00',
    duracionEstimada: 30,
  },
  servicioBarbero: {
    nombrePersonalizado: 'Corte QA Barbero',
    precio: '15000.00',
    duracionMinutos: 30,
  },
  categoria: {
    nombre: 'Cortes QA (Sandbox)',
    descripcion: 'Categoría aislada para pruebas de QA en vivo.',
  },
} as const;

function horaUtc(hhmm: string): Date {
  // @db.Time se representa como Date en epoch; convención del proyecto: 1970-01-01T..Z
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

async function upsertUsuario(
  correo: string,
  nombreCompleto: string,
  telefono: string,
  passwordHash: string,
): Promise<string> {
  const usuario = await prisma.usuario.upsert({
    where: { correo },
    update: {
      passwordHash,
      nombreCompleto,
      telefono,
      telefonoVerificado: true,
      estadoCuenta: 'ACTIVO',
    },
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
  barberiaId: string | null,
): Promise<void> {
  const rol = await prisma.rol.findUnique({ where: { nombre: nombreRol } });
  if (!rol) {
    throw new Error(
      `Rol "${nombreRol}" no existe. Ejecuta primero el seed base de roles (npm run seed).`,
    );
  }
  // Limpia asignaciones previas del par usuario/rol (cualquier scope) para
  // evitar duplicados con índices parciales (barberia_id NULL vs NOT NULL).
  await prisma.usuarioRol.deleteMany({ where: { usuarioId, rolId: rol.id } });
  await prisma.usuarioRol.create({
    data: { usuarioId, rolId: rol.id, barberiaId, estado: 'ACTIVO' },
  });
}

async function asegurarClienteBarberia(
  usuarioId: string,
  barberiaId: string,
): Promise<void> {
  await prisma.clienteBarberia.upsert({
    where: { uk_cliente_barberia: { usuarioId, barberiaId } },
    update: { estadoVinculacion: 'ACTIVO' },
    create: {
      usuarioId,
      barberiaId,
      estadoVinculacion: 'ACTIVO',
      esBarberiaActiva: false,
    },
  });
}

async function asegurarServicio(barberiaId: string): Promise<string> {
  // Servicio (catálogo legacy por sede) no tiene @@unique(barberiaId,nombre):
  // idempotencia por búsqueda acotada a la sede QA.
  const existente = await prisma.servicio.findFirst({
    where: { barberiaId, nombre: QA.servicio.nombre },
    select: { id: true },
  });
  if (existente) {
    await prisma.servicio.update({
      where: { id: existente.id },
      data: {
        precio: QA.servicio.precio as any,
        duracionEstimada: QA.servicio.duracionEstimada,
        margenOperativo: 0,
        destacado: false,
        estado: 'ACTIVO',
      },
    });
    return existente.id;
  }
  const creado = await prisma.servicio.create({
    data: {
      barberiaId,
      nombre: QA.servicio.nombre,
      precio: QA.servicio.precio as any,
      duracionEstimada: QA.servicio.duracionEstimada,
      margenOperativo: 0,
      destacado: false,
      estado: 'ACTIVO',
    },
  });
  return creado.id;
}

async function asegurarHorariosSede(barberiaId: string): Promise<void> {
  // Horario no tiene unique compuesto: reemplazo ACOTADO a la sede QA.
  await prisma.horario.deleteMany({ where: { barberiaId } });
  const dias = [1, 2, 3, 4, 5, 6, 7]; // ISO 1=lunes..7=domingo
  await prisma.horario.createMany({
    data: dias.map((diaSemana) => ({
      barberiaId,
      diaSemana,
      horaInicio: horaUtc('09:00'),
      horaFin: horaUtc('18:00'),
    })),
  });
}

async function asegurarHorariosBarbero(
  barberiaId: string,
  barberoId: string,
): Promise<void> {
  // HorarioBarbero tiene @@unique([barberiaId, barberoId, diaSemana]) → upsert.
  const dias = [1, 2, 3, 4, 5, 6];
  for (const diaSemana of dias) {
    await prisma.horarioBarbero.upsert({
      where: {
        uk_horario_barbero_dia: { barberiaId, barberoId, diaSemana },
      },
      update: {
        horaInicio: horaUtc('09:00'),
        horaFin: horaUtc('18:00'),
        horaInicioDescanso: null,
        horaFinDescanso: null,
        esDiaLibre: false,
      },
      create: {
        barberiaId,
        barberoId,
        diaSemana,
        horaInicio: horaUtc('09:00'),
        horaFin: horaUtc('18:00'),
        esDiaLibre: false,
      },
    });
  }
  // Domingo libre (idempotente)
  await prisma.horarioBarbero.upsert({
    where: { uk_horario_barbero_dia: { barberiaId, barberoId, diaSemana: 7 } },
    update: {
      horaInicio: null,
      horaFin: null,
      horaInicioDescanso: null,
      horaFinDescanso: null,
      esDiaLibre: true,
    },
    create: { barberiaId, barberoId, diaSemana: 7, esDiaLibre: true },
  });
}

async function main() {
  console.log('🌱 Seed QA / Sandbox (idempotente, aislado)...');
  if (ES_PRODUCCION) {
    console.log(
      '   Modo PRODUCCIÓN confirmado (CONFIRM_QA_SEED=YES). Escribe SOLO en la sede QA.',
    );
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // 1) Usuarios sintéticos (upsert por correo)
  const adminId = await upsertUsuario(
    QA.admin.correo,
    QA.admin.nombre,
    QA.admin.telefono,
    passwordHash,
  );
  const barberoId = await upsertUsuario(
    QA.barbero.correo,
    QA.barbero.nombre,
    QA.barbero.telefono,
    passwordHash,
  );
  const clienteId = await upsertUsuario(
    QA.cliente.correo,
    QA.cliente.nombre,
    QA.cliente.telefono,
    passwordHash,
  );

  // 2) Sede QA (upsert por codigoAcceso, único). El responsable es el admin QA.
  const barberia = await prisma.barberia.upsert({
    where: { codigoAcceso: QA.barberia.codigoAcceso },
    update: {
      nombre: QA.barberia.nombre,
      descripcion: QA.barberia.descripcion,
      telefono: QA.barberia.telefono,
      ubicacion: QA.barberia.ubicacion,
      enlaceUnico: QA.barberia.enlaceUnico,
      responsableId: adminId,
      estado: 'ACTIVO',
    },
    create: {
      nombre: QA.barberia.nombre,
      descripcion: QA.barberia.descripcion,
      telefono: QA.barberia.telefono,
      ubicacion: QA.barberia.ubicacion,
      codigoAcceso: QA.barberia.codigoAcceso,
      enlaceUnico: QA.barberia.enlaceUnico,
      responsableId: adminId,
      estado: 'ACTIVO',
    },
  });
  const qaBarberiaId = barberia.id;

  // 3) Configuración de la sede QA (upsert por PK barberiaId)
  await prisma.configuracionBarberia.upsert({
    where: { barberiaId: qaBarberiaId },
    update: {
      modoReserva: 'MANUAL',
      aceptaIndividual: true,
      aceptaGrupal: true,
      nuevasReservasActivas: true,
      oportunidadesEspacioActivas: true,
    },
    create: {
      barberiaId: qaBarberiaId,
      modoReserva: 'MANUAL',
      aceptaIndividual: true,
      aceptaGrupal: true,
      nuevasReservasActivas: true,
      oportunidadesEspacioActivas: true,
      margenGrupalMinutos: 10,
      permiteCancelacionEspecial: false,
    },
  });

  // 4) Roles (scoping de tenant) — SIN rol global ADMINISTRADOR
  await asignarRol(adminId, 'CLIENTE', null);
  await asignarRol(adminId, 'ADMIN_BARBERIA', qaBarberiaId); // ámbito SEDE QA
  await asignarRol(barberoId, 'CLIENTE', null);
  await asignarRol(barberoId, 'BARBERO', qaBarberiaId); // ámbito SEDE QA
  await asignarRol(clienteId, 'CLIENTE', null);

  // 5) Vinculación de cliente a la sede QA (acceso de cliente al catálogo/flujo)
  await asegurarClienteBarberia(clienteId, qaBarberiaId);

  // 6) Catálogo aislado (legacy + V3 híbrido)
  await asegurarServicio(qaBarberiaId);
  const categoria = await prisma.categoriaServicio.upsert({
    where: {
      uk_categoria_sede_nombre: {
        barberiaId: qaBarberiaId,
        nombre: QA.categoria.nombre,
      },
    },
    update: { descripcion: QA.categoria.descripcion, activa: true },
    create: {
      barberiaId: qaBarberiaId,
      nombre: QA.categoria.nombre,
      descripcion: QA.categoria.descripcion,
      activa: true,
    },
  });
  await prisma.servicioBarbero.upsert({
    where: {
      uk_servicio_barbero_categoria_nombre: {
        barberoId,
        categoriaId: categoria.id,
        nombrePersonalizado: QA.servicioBarbero.nombrePersonalizado,
      },
    },
    update: {
      precio: QA.servicioBarbero.precio as any,
      duracionMinutos: QA.servicioBarbero.duracionMinutos,
      activo: true,
    },
    create: {
      categoriaId: categoria.id,
      barberoId,
      nombrePersonalizado: QA.servicioBarbero.nombrePersonalizado,
      precio: QA.servicioBarbero.precio as any,
      duracionMinutos: QA.servicioBarbero.duracionMinutos,
      activo: true,
    },
  });

  // 7) Horarios aislados (sede + barbero)
  await asegurarHorariosSede(qaBarberiaId);
  await asegurarHorariosBarbero(qaBarberiaId, barberoId);

  // 8) Verificación de aislamiento (aserciones, sin leer otras sedes)
  const adminGlobal = await prisma.usuarioRol.findFirst({
    where: {
      usuarioId: adminId,
      rol: { nombre: 'ADMINISTRADOR' },
      barberiaId: null,
    },
    select: { id: true },
  });
  if (adminGlobal) {
    throw new Error(
      'FALLO DE AISLAMIENTO: admin.qa tiene rol ADMINISTRADOR global. Abortado.',
    );
  }
  const adminScope = await prisma.usuarioRol.findFirst({
    where: {
      usuarioId: adminId,
      rol: { nombre: 'ADMIN_BARBERIA' },
      barberiaId: qaBarberiaId,
      estado: 'ACTIVO',
    },
    select: { id: true },
  });
  const barberoScope = await prisma.usuarioRol.findFirst({
    where: {
      usuarioId: barberoId,
      rol: { nombre: 'BARBERO' },
      barberiaId: qaBarberiaId,
      estado: 'ACTIVO',
    },
    select: { id: true },
  });
  if (!adminScope || !barberoScope) {
    throw new Error('FALLO: roles de sede QA no quedaron asignados correctamente.');
  }

  console.log('✅ Tenant QA listo (idempotente):');
  console.log(`   Sede: ${barberia.nombre} | codigoAcceso=${QA.barberia.codigoAcceso} | id=${qaBarberiaId}`);
  console.log(`   Admin sede:  ${QA.admin.correo}  (ADMIN_BARBERIA @ QA, sin ADMINISTRADOR global)`);
  console.log(`   Barbero:     ${QA.barbero.correo} (BARBERO @ QA)`);
  console.log(`   Cliente:     ${QA.cliente.correo} (CLIENTE vinculado a QA)`);
  console.log('   Horarios/servicios/categorías: aislados a la sede QA.');
  console.log('   Contraseña: la definida en QA_USERS_PASSWORD (no se imprime).');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed QA:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
