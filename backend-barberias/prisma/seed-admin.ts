// prisma/seed-admin.ts
// Script para inyectar/asegurar cuenta de administrador global en producción
// Ejecutar: npx tsx prisma/seed-admin.ts

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';

// tsx no carga .env por su cuenta (el CLI de Prisma sí): sin esto
// ADMIN_SEED_PASSWORD del archivo nunca llegaría al proceso.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env ilegible: se usa el respaldo de desarrollo.
  }
}

/**
 * La contraseña del administrador NO vive en el código: se lee de
 * `ADMIN_SEED_PASSWORD`. El literal de respaldo es solo para que el script
 * siga siendo ejecutable en una base de desarrollo recién creada; en
 * producción la variable es la vía y la contraseña rota sin tocar el archivo.
 */
const password = process.env.ADMIN_SEED_PASSWORD || 'qa-segura-42';

const adminData = {
  email: 'admin.cremaq.production@test.com',
  nombre: 'Admin Produccion QA',
  telefono: '8294728320',
};
const SALT_ROUNDS = 10;

function logSuccess(msg: string): void { console.log('✅ ' + msg); }
function logInfo(msg: string): void  { console.log('   ' + msg); }
function logError(msg: string): void { console.log('❌ ' + msg); }

async function main() {
  const prisma = new PrismaClient();
  try {
    // PASO 1: Liberar teléfono 8294728320 si está en uso por otro usuario
    logInfo('Liberando teléfono 8294728320...');
    const usuarioConTelefono = await prisma.usuario.findFirst({
      where: { telefono: '8294728320', NOT: { correo: adminData.email } },
    });
    if (usuarioConTelefono) {
      await prisma.usuario.updateMany({
        where: { telefono: '8294728320', NOT: { correo: adminData.email } },
        data: { telefono: '5061234567' },
      });
      logInfo('Teléfono liberado a 5061234567');
    }

    // PASO 2: Upsert del usuario administrador
    logInfo('Creando/actualizando usuario administrador...');
    const usuario = await prisma.usuario.upsert({
      where: { correo: adminData.email },
      update: {
        nombreCompleto: adminData.nombre,
        telefono: adminData.telefono,
        passwordHash: '',
        estadoCuenta: 'ACTIVO',
        correoVerificado: true,
        telefonoVerificado: true,
        tokenVersion: { increment: 1 },
      },
      create: {
        correo: adminData.email,
        nombreCompleto: adminData.nombre,
        telefono: adminData.telefono,
        passwordHash: '',
        estadoCuenta: 'ACTIVO',
        correoVerificado: true,
        telefonoVerificado: true,
        tokenVersion: 1,
      },
    });
    logSuccess('Usuario administrador procesado: ' + usuario.correo);

    // PASO 3: Hash de contraseña
    logInfo('Hasheando contraseña...');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: passwordHash },
    });
    logSuccess('Contraseña hasheada y guardada');

    // PASO 4: Verificar/crear sede usando SQL CRUD puro
    logInfo('Verificando sedes existentes...');
    const barberiaExistente = await prisma.barberia.findFirst();
    let barberiaId: string;

    if (barberiaExistente) {
      barberiaId = barberiaExistente.id;
      logInfo('Sede ya existe: ' + barberiaExistente.nombre);
    } else {
      logInfo('Creando sede por defecto usando SQL CRUD puro...');
      const enlaceUnico = 'sede-principal-qa-' + Date.now();
      try {
        // SQL CRUD puro: insertar solo campos esenciales
        await prisma.$executeRaw`INSERT INTO "barberias" ("nombre", "telefono", "ubicacion", "codigo_acceso", "enlace_unico", "responsable_id") VALUES ('Sede Principal QA', '8295551234', 'Santo Domingo', 'QA123456', '${enlaceUnico}', '00000000-0000-0000-0000-000000000000')`;
        const findSede = await prisma.barberia.findFirst({ where: { nombre: 'Sede Principal QA' } });
        barberiaId = findSede?.id || '00000000-0000-0000-0000-000000000000';
        logSuccess('Sede creada via SQL');
      } catch (createError) {
        // Si falla por constraint, intentar sin responsable_id
        try {
          await prisma.$executeRaw`INSERT INTO "barberias" ("nombre", "telefono", "ubicacion", "codigo_acceso", "enlace_unico") VALUES ('Sede Principal QA', '8295551234', 'Santo Domingo', 'QA123456', '${enlaceUnico}')`;
          const findSede = await prisma.barberia.findFirst({ where: { nombre: 'Sede Principal QA' } });
          barberiaId = findSede?.id || '00000000-0000-0000-0000-000000000000';
          logInfo('Sede creada sin responsable_id (fallback)');
        } catch (fallbackError) {
          logError('Error creating sede: ' + (fallbackError instanceof Error ? fallbackError.message : String(fallbackError)));
          barberiaId = '00000000-0000-0000-0000-000000000000';
        }
      }
    }

    // Confirmación
    logSuccess('================================================================');
    logInfo('PROCESO COMPLETADO');
    logInfo('Admin: ' + usuario.correo);
    logInfo('Sede ID: ' + barberiaId);
    logSuccess('================================================================');
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error)); process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
main();