/**
 * SEED — Categorías oficiales de la sede + roles y permisos de la plataforma.
 *
 * - `seedCategoriasOficiales(barberiaId)` se ejecuta tras la creación de la barbería
 *   (donde el `barberiaId` ya se conoce) y también en un cron/seed de proveedores.
 *   `ON CONFLICT DO NOTHING` (vía `createMany({ skipDuplicates: true })`) garantiza
 *   que nunca se reescriben categorías existentes ni se dupliquen.
 * - El resto del seed (roles, permisos, asignación) era el original de la plataforma.
 *   Ejecutar con: `npm run seed` (tsx, runner del proyecto).
 *
 * Regla de negocio (Sección 3.1):
 * Autorización jerárquica: Permisos → Roles → Usuario.
 * Nunca un campo simple tipo `usuario.tipo = \"admin\"`.
 */
import { PrismaClient } from '@prisma/client';

/** Categorías oficiales de la sede: ellas vinculan los servicios que publica el barbero. */
const CATEGORIAS_OFICIALES = [
  {
    nombre: 'Cortes Premium y Degradados',
    descripcion: 'Fade, Taper, Moicano, Mullet y cortes texturizados.',
  },
  {
    nombre: 'Cortes Básicos y Tradicionales',
    descripcion: 'Solo rebajar, corte clásico a tijera y tradicional.',
  },
  {
    nombre: 'Arreglos Rápidos y Mantenimiento',
    descripcion: 'Rapado (clavos), solo cerquillo, diseños y Bigen.',
  },
  {
    nombre: 'Barba y Afeitado',
    descripcion: 'Perfilado de barba, afeitado con navaja y ritual con toalla caliente.',
  },
  {
    nombre: 'Combos (Corte + Barba)',
    descripcion: 'Paquetes combinados de corte de cabello y arreglo de barba.',
  },
  {
    nombre: 'Extras y Cuidado Personal',
    descripcion: 'Cejas, mascarilla negra, limpieza facial, lavado y colorimetría.',
  },
  {
    nombre: 'Cortes Infantiles',
    descripcion: 'Cortes y degradados para niños.',
  },
];

const prisma = new PrismaClient();

/**
 * Seed idempotente de las 7 categorías oficiales de la sede.
 *
 * Se ejecuta tras la creación de la barbería (el `barberiaId` lo pone quien cree
 * la cita) y también en un cron/seed de proveedores: `ON CONFLICT DO NOTHING`
 * garantiza que una categoría que ya existe —con su descripción y su código—
 * no se reescriba y que la barbería nunca duplique categorías.
 */	export async function seedCategoriasOficiales(barberiaId: string): Promise<void> {
  console.log(`🌱 Seed de categorías oficiales para ${barberiaId}...`);

  const categoriasInsercion = CATEGORIAS_OFICIALES.map((categoría) => ({
    barberiaId,
    nombre: categoría.nombre,
    descripcion: categoría.descripcion,
  }));

  /**
   * `skipDuplicates: true` equivale a `ON CONFLICT DO NOTHING`: si ya hay una categoría
   * con ese `barberiaId` + `nombre` (clave única de la sede) no se inserte de nuevo,
   * teniendo así una función de seguridad y cero side effects en sedes que ya la ejecutaron.
   */
  const inserted = await prisma.categoriaServicio.createMany({
    data: categoriasInsercion,
    skipDuplicates: true,
  });

  console.log(`✅ ${inserted.count} categoría(s) de las 7 pusas (idempotente).`);
}

async function main() {
  console.log('🌱 Iniciando seed de roles y permisos...');

  // ── PERMISOS ────────────────────────────────────────────────────────────────
  const permisos = [
    // Permisos de cliente
    { codigo: 'reserva:crear', descripcion: 'Crear una reserva' },
    { codigo: 'reserva:cancelar_propia', descripcion: 'Cancelar su propia reserva' },
    { codigo: 'historial:ver_propio', descripcion: 'Ver su propio historial' },
    { codigo: 'barberia:vincularse', descripcion: 'Vincularse a una barbería' },
    { codigo: 'antecedente:declarar', descripcion: 'Declarar información propia como antecedente' },

    // Permisos de barbero
    { codigo: 'reserva:confirmar', descripcion: 'Confirmar o rechazar reservas' },
    { codigo: 'reserva:proponer_horario', descripcion: 'Proponer un nuevo horario para una reserva' },
    { codigo: 'catalogo:gestionar', descripcion: 'Gestionar servicios y combos' },
    { codigo: 'horario:gestionar', descripcion: 'Gestionar horarios y excepciones' },
    { codigo: 'pago:registrar', descripcion: 'Registrar pagos en persona' },
    { codigo: 'antecedente:crear', descripcion: 'Crear antecedentes de clientes' },
    { codigo: 'historial:ver_barberia', descripcion: 'Ver historial de clientes de su barbería' },

    // Permisos de administrador
    { codigo: 'admin:gestionar_barberias', descripcion: 'Aprobar cambios en barberías' },
    { codigo: 'admin:gestionar_usuarios', descripcion: 'Gestionar usuarios de la plataforma' },
    { codigo: 'admin:aprobar_antecedentes', descripcion: 'Aprobar antecedentes compartidos' },
    { codigo: 'admin:ver_auditoria', descripcion: 'Ver registros de auditoría' },
    { codigo: 'admin:aprobar_vinculacion_extra', descripcion: 'Aprobar la 6ª vinculación de un cliente' },
  ];

  for (const permiso of permisos) {
    await prisma.permiso.upsert({
      where: { codigo: permiso.codigo },
      update: { descripcion: permiso.descripcion },
      create: permiso,
    });
  }
  console.log(`✅ ${permisos.length} permisos insertados/actualizados.`);

  // ── ROLES ────────────────────────────────────────────────────────────────────
  const roles = [
    { nombre: 'CLIENTE', ambito: 'GLOBAL' },
    { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
    { nombre: 'BARBERO', ambito: 'BARBERIA' },
    { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
  ];

  for (const rol of roles) {
    await prisma.rol.upsert({
      where: { nombre: rol.nombre },
      update: { ambito: rol.ambito },
      create: rol,
    });
  }
  console.log(`✅ ${roles.length} roles insertados/actualizados.`);

  // ── ASIGNACIÓN DE PERMISOS A ROLES ───────────────────────────────────────────
  const rolCliente = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'CLIENTE' } });
  const rolAdminBarberia = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN_BARBERIA' } });
  const rolBarbero = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'BARBERO' } });
  const rolAdmin   = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMINISTRADOR' } });

  const permisosCliente = ['reserva:crear', 'reserva:cancelar_propia', 'historial:ver_propio', 'barberia:vincularse', 'antecedente:declarar'];
  const permisosBarbero = ['reserva:confirmar', 'reserva:proponer_horario', 'catalogo:gestionar', 'horario:gestionar', 'pago:registrar', 'antecedente:crear', 'historial:ver_barberia'];
  // E0-07: el responsable de una sede no es un barbero ni un administrador de
  // plataforma. Sus permisos son los de gestión de SU sede; el aislamiento real
  // lo impone `RolesGuard` con el `barberia_id` de `usuario_roles`.
  const permisosAdminBarberia = [
    'reserva:confirmar',
    'reserva:proponer_horario',
    'catalogo:gestionar',
    'horario:gestionar',
    'pago:registrar',
    'antecedente:crear',
    'admin:ver_auditoria',
    'admin:aprobar_antecedentes',
    'historial:ver_barberia',
  ];
  const permisosAdmin   = permisos.map(p => p.codigo); // El admin tiene todos los permisos

  async function asignarPermisos(rolId: string, codigos: string[]) {
    for (const codigo of codigos) {
      const permiso = await prisma.permiso.findUniqueOrThrow({ where: { codigo } });
      await prisma.rolPermiso.upsert({
        where: { rolId_permisoId: { rolId, permisoId: permiso.id } },
        update: {},
        create: { rolId, permisoId: permiso.id },
      });
    }
  }

  await asignarPermisos(rolCliente.id, permisosCliente);
  await asignarPermisos(rolAdminBarberia.id, permisosAdminBarberia);
  await asignarPermisos(rolBarbero.id, permisosBarbero);
  await asignarPermisos(rolAdmin.id, permisosAdmin);

  console.log('✅ Permisos asignados a roles correctamente.');
  console.log('🎉 Seed completado exitosamente.');
}

main()
  .catch((e) => {
    console.error('❌ Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
