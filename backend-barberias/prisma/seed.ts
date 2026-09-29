/**
 * SEED INICIAL — Roles y Permisos de la Plataforma
 *
 * Inserta los 3 roles del sistema y sus permisos base.
 * Ejecutar con: npx ts-node prisma/seed.ts
 * O: npm run seed (si está configurado en package.json)
 *
 * Regla de negocio (Sección 3.1):
 * Autorización jerárquica: Permisos → Roles → Usuario.
 * Nunca un campo simple tipo `usuario.tipo = "admin"`.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
  const rolBarbero = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'BARBERO' } });
  const rolAdmin   = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMINISTRADOR' } });

  const permisosCliente = ['reserva:crear', 'reserva:cancelar_propia', 'historial:ver_propio', 'barberia:vincularse', 'antecedente:declarar'];
  const permisosBarbero = ['reserva:confirmar', 'reserva:proponer_horario', 'catalogo:gestionar', 'horario:gestionar', 'pago:registrar', 'antecedente:crear', 'historial:ver_barberia'];
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
