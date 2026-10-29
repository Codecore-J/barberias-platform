/**\r
 * SEED — Categorías oficiales de la sede + roles y permisos de la plataforma.\r
 *\r
 * - `seedCategoriasOficiales(barberiaId)` se ejecuta tras la creación de la barbería\r
 *   (donde el `barberiaId` ya se conoce) y también en un cron/seed de proveedores.\r
 *   `ON CONFLICT DO NOTHING` (vía `createMany({ skipDuplicates: true })`) garantiza\r
 *   que nunca se reescriben categorías existentes ni se dupliquen.\r
 * - El resto del seed (roles, permisos, asignación) era el original de la plataforma.\r
 *   Ejecutar con: `npm run seed` (tsx, runner del proyecto).\r
 *\r
 * Regla de negocio (Sección 3.1):\r
 * Autorización jerárquica: Permisos → Roles → Usuario.\r
 * Nunca un campo simple tipo `usuario.tipo = \"admin\"`.\r
 */\r
import { PrismaClient } from '@prisma/client';\r
\r\n/** Categorías oficiales de la sede: ellas vinculan los servicios que publica el barbero. */\r\nconst CATEGORIAS_OFICIALES = [\r\n  {\r\n    nombre: 'Cortes Premium y Degradados',\r\n    descripcion: 'Fade, Taper, Moicano, Mullet y cortes texturizados.',\r\n  },\r\n  {\r\n    nombre: 'Cortes Básicos y Tradicionales',\r\n    descripcion: 'Solo rebajar, corte clásico a tijera y tradicional.',\r\n  },\r\n  {\r\n    nombre: 'Arreglos Rápidos y Mantenimiento',\r\n    descripcion: 'Rapado (clavos), solo cerquillo, diseños y Bigen.',\r\n  },\r\n  {\r\n    nombre: 'Barba y Afeitado',\r\n    descripcion: 'Perfilado de barba, afeitado con navaja y ritual con toalla caliente.',\r\n  },\r\n  {\r\n    nombre: 'Combos (Corte + Barba)',\r\n    descripcion: 'Paquetes combinados de corte de cabello y arreglo de barba.',\r\n  },\r\n  {\r\n    nombre: 'Extras y Cuidado Personal',\r\n    descripcion: 'Cejas, mascarilla negra, limpieza facial, lavado y colorimetría.',\r\n  },\r\n  {\r\n    nombre: 'Cortes Infantiles',\r\n    descripcion: 'Cortes y degradados para niños.',\r\n  },\r\n];\r\n\r\nconst prisma = new PrismaClient();\r\n\r\n/**\r\n * Seed idempotente de las 7 categorías oficiales de la sede.\r\n *\r\n * Se ejecuta tras la creación de la barbería (el `barberiaId` lo pone quien cree\r\n * la cita) y también en un cron/seed de proveedores: `ON CONFLICT DO NOTHING`\r\n * garantiza que una categoría que ya existe —con su descripción y su código—\r\n * no se reescriba y que la barbería nunca duplique categorías.\r\n */\r\texport async function seedCategoriasOficiales(barberiaId: string): Promise<void> {\r
  console.log(`🌱 Seed de categorías oficiales para ${barberiaId}...`);\r
\r
  const categoriasInsercion = CATEGORIAS_OFICIALES.map((categoría) => ({\r
    barberiaId,\r
    nombre: categoría.nombre,\r
    descripcion: categoría.descripcion,\r
  }));\r
\r
  /**\r
   * `skipDuplicates: true` equivale a `ON CONFLICT DO NOTHING`: si ya hay una categoría\r
   * con ese `barberiaId` + `nombre` (clave única de la sede) no se inserte de nuevo,\r
   * teniendo así una función de seguridad y cero side effects en sedes que ya la ejecutaron.\r
   */\r
  const inserted = await prisma.categoriaServicio.createMany({\r
    data: categoriasInsercion,\r
    skipDuplicates: true,\r
  });\r
\r
  console.log(`✅ ${inserted.count} categoría(s) de las 7 pusas (idempotente).`);\r
}\r
\r\nasync function main() {\r
  console.log('🌱 Iniciando seed de roles y permisos...');\r
\r
  // ── PERMISOS ────────────────────────────────────────────────────────────────\r
  const permisos = [\r
    // Permisos de cliente\r
    { codigo: 'reserva:crear', descripcion: 'Crear una reserva' },\r
    { codigo: 'reserva:cancelar_propia', descripcion: 'Cancelar su propia reserva' },\r
    { codigo: 'historial:ver_propio', descripcion: 'Ver su propio historial' },\r
    { codigo: 'barberia:vincularse', descripcion: 'Vincularse a una barbería' },\r
    { codigo: 'antecedente:declarar', descripcion: 'Declarar información propia como antecedente' },\r
\r
    // Permisos de barbero\r
    { codigo: 'reserva:confirmar', descripcion: 'Confirmar o rechazar reservas' },\r
    { codigo: 'reserva:proponer_horario', descripcion: 'Proponer un nuevo horario para una reserva' },\r
    { codigo: 'catalogo:gestionar', descripcion: 'Gestionar servicios y combos' },\r
    { codigo: 'horario:gestionar', descripcion: 'Gestionar horarios y excepciones' },\r
    { codigo: 'pago:registrar', descripcion: 'Registrar pagos en persona' },\r
    { codigo: 'antecedente:crear', descripcion: 'Crear antecedentes de clientes' },\r
    { codigo: 'historial:ver_barberia', descripcion: 'Ver historial de clientes de su barbería' },\r
\r
    // Permisos de administrador\r
    { codigo: 'admin:gestionar_barberias', descripcion: 'Aprobar cambios en barberías' },\r
    { codigo: 'admin:gestionar_usuarios', descripcion: 'Gestionar usuarios de la plataforma' },\r
    { codigo: 'admin:aprobar_antecedentes', descripcion: 'Aprobar antecedentes compartidos' },\r
    { codigo: 'admin:ver_auditoria', descripcion: 'Ver registros de auditoría' },\r
    { codigo: 'admin:aprobar_vinculacion_extra', descripcion: 'Aprobar la 6ª vinculación de un cliente' },\r
  ];\r
\r
  for (const permiso of permisos) {\r
    await prisma.permiso.upsert({\r
      where: { codigo: permiso.codigo },\r
      update: { descripcion: permiso.descripcion },\r
      create: permiso,\r
    });\r
  }\r
  console.log(`✅ ${permisos.length} permisos insertados/actualizados.`);\r
\r
  // ── ROLES ────────────────────────────────────────────────────────────────────\r
  const roles = [\r
    { nombre: 'CLIENTE', ambito: 'GLOBAL' },\r
    { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },\r
    { nombre: 'BARBERO', ambito: 'BARBERIA' },\r
    { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },\r
  ];\r
\r
  for (const rol of roles) {\r
    await prisma.rol.upsert({\r
      where: { nombre: rol.nombre },\r
      update: { ambito: rol.ambito },\r
      create: rol,\r
    });\r
  }\r
  console.log(`✅ ${roles.length} roles insertados/actualizados.`);\r
\r
  // ── ASIGNACIÓN DE PERMISOS A ROLES ───────────────────────────────────────────\r
  const rolCliente = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'CLIENTE' } });\r
  const rolAdminBarberia = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN_BARBERIA' } });\r
  const rolBarbero = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'BARBERO' } });\r
  const rolAdmin   = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMINISTRADOR' } });\r
\r
  const permisosCliente = ['reserva:crear', 'reserva:cancelar_propia', 'historial:ver_propio', 'barberia:vincularse', 'antecedente:declarar'];\r
  const permisosBarbero = ['reserva:confirmar', 'reserva:proponer_horario', 'catalogo:gestionar', 'horario:gestionar', 'pago:registrar', 'antecedente:crear', 'historial:ver_barberia'];\r
  // E0-07: el responsable de una sede no es un barbero ni un administrador de\r
  // plataforma. Sus permisos son los de gestión de SU sede; el aislamiento real\r
  // lo impone `RolesGuard` con el `barberia_id` de `usuario_roles`.\r
  const permisosAdminBarberia = [\r
    'reserva:confirmar',\r
    'reserva:proponer_horario',\r
    'catalogo:gestionar',\r
    'horario:gestionar',\r
    'pago:registrar',\r
    'antecedente:crear',\r
    'admin:ver_auditoria',\r
    'admin:aprobar_antecedentes',\r
    'historial:ver_barberia',\r
  ];\r
  const permisosAdmin   = permisos.map(p => p.codigo); // El admin tiene todos los permisos\r
\r
  async function asignarPermisos(rolId: string, codigos: string[]) {\r
    for (const codigo of codigos) {\r
      const permiso = await prisma.permiso.findUniqueOrThrow({ where: { codigo } });\r
      await prisma.rolPermiso.upsert({\r
        where: { rolId_permisoId: { rolId, permisoId: permiso.id } },\r
        update: {},\r
        create: { rolId, permisoId: permiso.id },\r
      });\r
    }\r
  }\r
\r
  await asignarPermisos(rolCliente.id, permisosCliente);\r
  await asignarPermisos(rolAdminBarberia.id, permisosAdminBarberia);\r
  await asignarPermisos(rolBarbero.id, permisosBarbero);\r
  await asignarPermisos(rolAdmin.id, permisosAdmin);\r
\r
  console.log('✅ Permisos asignados a roles correctamente.');\r
  console.log('🎉 Seed completado exitosamente.');\r
}\r
\r\nmain()\r
  .catch((e) => {\r
    console.error('❌ Error durante el seed:', e);\r
    process.exit(1);\r
  })\r
  .finally(async () => {\r
    await prisma.$disconnect();\r
  });\r
