// prisma/clean-users.ts
// Script para eliminar TODOS los usuarios de la base de datos de producción (Neon)
// Ejecutar: npx tsx prisma/clean-users.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  try {
    // --- PASO 1: Eliminar todos los usuarios con CASCADE ---
    // Usamos executeRawUnsafe para ejecutar un TRUNCATE TABLE "usuarios" CASCADE;
    // Esto eliminará el usuario y automáticamente todas las filas en tablas hijas
    // que tengan Foreign Key hacia Usuario (con ON DELETE CASCADE).
    // Esta es la forma más eficiente y segura de limpiar toda la jerarquía.

    console.log('🔄 Iniciando limpieza profunda de usuarios...');
    console.log('⚠️  ADVERTENCIA: Este operación eliminará TODOS los usuarios y datos asociados.');

    // Ejecutar TRUNCATE con CASCADE para limpiar todo en una sola operación
    // El nombre de tabla es "usuarios" (minúsculas) según schema.prisma
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "usuarios" CASCADE;');

    console.log('✅ Comando TRUNCATE TABLE "usuarios" CASCADE ejecutado exitosamente.');

    // --- PASO 2: Verificar que la tabla usuarios quede vacía ---
    // Contar el total de registros usando el método count del cliente Prisma
    const totalUsuarios = await prisma.usuario.count();

    console.log(`📊 Total de usuarios en la tabla "usuarios": ${totalUsuarios}`);

    if (totalUsuarios > 0) {
      throw new Error(
        `❌ FALLO CRÍTICO: Se esperaban 0 usuarios, pero se encontraron ${totalUsuarios} usuarios.`,
      );
    }

    console.log('✅ Verificación exitosa: La tabla "usuarios" tiene 0 registros.');

    // --- PASO 3: Confirmación final ---
    console.log('================================================================');
    console.log('🧹 PROCESO DE LIMPIEZA COMPLETADO');
    console.log('================================================================');
    console.log('✅ Todos los usuarios han sido eliminados de la base de datos.');
    console.log('✅ Tabla "usuarios" vacía (0 registros).');
    console.log('✅ Base de datos lista para nuevo seeding desde cero.');
    console.log('================================================================');
  } catch (error: any) {
    console.error('❌ ERROR CRITICO EN LIMPIEZA DE USUARIOS:');
    console.error(error);
    // Salir con código de error 1
    process.exit(1);
  } finally {
    // --- PASO 4: Desconexión limpia de Prisma ---
    try {
      await prisma.$disconnect();
      console.log('🔒 Conexión a la base de datos cerrada limpiamente.');
    } catch (disconnectErr: any) {
      console.error('❌ Error al cerrar conexión Prisma:', disconnectErr.message);
    }
  }
}

// Ejecutar la función principal
main();