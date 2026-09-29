import { Test, TestingModule } from '@nestjs/testing';
import { SharedModule } from '../dist/shared/shared.module.js';
import { IamModule } from '../dist/iam/iam.module.js';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../dist/shared/prisma/prisma.service.js';
import request from 'supertest';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';

async function runRecoveryTests() {
  console.log('================================================================');
  console.log('🧪 EJECUTANDO BATERÍA DE PRUEBAS DE SEGURIDAD SEC-01');
  console.log('   Módulo: Recuperación de Cuenta (/forgot-password & /reset-password)');
  console.log('================================================================\n');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [SharedModule, IamModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const server = app.getHttpServer();

  // Asegurar usuario de prueba
  const testEmail = `recovery_test_${Date.now()}@demo.com`;
  const initialPassword = 'InitialPassword123!';
  const newPassword = 'NewPassword456!';
  const passwordHash = await bcrypt.hash(initialPassword, 10);

  const testUser = await prisma.usuario.create({
    data: {
      nombreCompleto: 'Usuario Test Recuperacion',
      correo: testEmail,
      telefono: `+1809${Date.now().toString().slice(-7)}`,
      passwordHash,
      estadoCuenta: 'ACTIVO',
    },
  });

  console.log(`👤 Usuario de prueba creado: ${testEmail} (ID: ${testUser.id})\n`);

  try {
    // 1. Solicitud para correo inexistente (Prevención de enumeración)
    console.log('1️⃣ Caso 1: Solicitud con correo inexistente...');
    const resInexistente = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ correo: 'inexistente_99999@noexiste.com' });

    if (resInexistente.status !== 200) {
      throw new Error(`Esperaba 200, recibido ${resInexistente.status}: ${JSON.stringify(resInexistente.body)}`);
    }
    console.log(`   ✅ Status 200 OK recibido. Mensaje genérico: "${resInexistente.body.message}"\n`);

    // 2. Solicitud con formato de correo inválido
    console.log('2️⃣ Caso 2: Solicitud con formato de correo inválido...');
    const resEmailInvalido = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ correo: 'no-es-un-correo' });

    if (resEmailInvalido.status !== 400) {
      throw new Error(`Esperaba 400, recibido ${resEmailInvalido.status}`);
    }
    console.log(`   ✅ Status 400 Bad Request recibido por validación de DTO.\n`);

    // 3. Solicitud válida para usuario existente
    console.log('3️⃣ Caso 3: Solicitud válida para usuario existente...');
    const resValido = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ correo: testEmail });

    if (resValido.status !== 200) {
      throw new Error(`Esperaba 200, recibido ${resValido.status}`);
    }
    const tokenGenerado = resValido.body.debugToken;
    if (!tokenGenerado) {
      throw new Error('No se recibió debugToken en entorno de desarrollo/test');
    }
    console.log(`   ✅ Status 200 OK. Token generado: ${tokenGenerado.slice(0, 16)}...`);

    // Verificar en BD que existe el hash
    const tokenHashCalculado = crypto.createHash('sha256').update(tokenGenerado).digest('hex');
    const tokenEnBd = await prisma.tokenRecuperacion.findUnique({
      where: { tokenHash: tokenHashCalculado },
    });
    if (!tokenEnBd || tokenEnBd.usado) {
      throw new Error('El token no se persistió correctamente en BD');
    }
    console.log(`   ✅ Token verificado en base de datos (Expira en: ${tokenEnBd.expiraAt.toISOString()})\n`);

    // 4. Intento con token falso / manipulado
    console.log('4️⃣ Caso 4: Intento de reseteo con token falso...');
    const resTokenFalso = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'token-invalido-1234567890abcdef', newPassword });

    if (resTokenFalso.status !== 400) {
      throw new Error(`Esperaba 400, recibido ${resTokenFalso.status}`);
    }
    console.log(`   ✅ Status 400 Bad Request: "${resTokenFalso.body.message}"\n`);

    // 5. Restablecimiento exitoso con token válido
    console.log('5️⃣ Caso 5: Restablecimiento exitoso con token válido...');
    const resResetExitoso = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenGenerado, newPassword });

    if (resResetExitoso.status !== 200) {
      throw new Error(`Esperaba 200, recibido ${resResetExitoso.status}: ${JSON.stringify(resResetExitoso.body)}`);
    }
    console.log(`   ✅ Status 200 OK: "${resResetExitoso.body.message}"\n`);

    // 6. Intento de reutilización del mismo token (Replay Attack)
    console.log('6️⃣ Caso 6: Intento de reutilizar el mismo token por segunda vez...');
    const resReplay = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenGenerado, newPassword: 'AnotherPassword789!' });

    if (resReplay.status !== 400) {
      throw new Error(`Esperaba 400, recibido ${resReplay.status}: ${JSON.stringify(resReplay.body)}`);
    }
    console.log(`   ✅ Replay bloqueado con Status 400: "${resReplay.body.message}"\n`);

    // 7. Intento con token expirado
    console.log('7️⃣ Caso 7: Intento con token expirado...');
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    await prisma.tokenRecuperacion.create({
      data: {
        usuarioId: testUser.id,
        tokenHash: expiredHash,
        expiraAt: new Date(Date.now() - 60000), // Expirado hace 1 minuto
        usado: false,
      },
    });

    const resExpirado = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: expiredRawToken, newPassword: 'ExpiredPassword123!' });

    if (resExpirado.status !== 400) {
      throw new Error(`Esperaba 400, recibido ${resExpirado.status}`);
    }
    console.log(`   ✅ Token expirado rechazado con Status 400: "${resExpirado.body.message}"\n`);

    // 8. Iniciar sesión con la nueva contraseña y confirmar que la anterior no funciona
    console.log('8️⃣ Caso 8: Verificando login con la nueva contraseña...');
    const resLoginViejo = await request(server)
      .post('/api/v1/auth/login')
      .send({ correo: testEmail, password: initialPassword });

    if (resLoginViejo.status !== 401) {
      throw new Error(`La contraseña vieja debió ser rechazada con 401, recibido ${resLoginViejo.status}`);
    }
    console.log(`   ✅ Contraseña anterior rechazada con HTTP 401 Unauthorized.`);

    const resLoginNuevo = await request(server)
      .post('/api/v1/auth/login')
      .send({ correo: testEmail, password: newPassword });

    if (resLoginNuevo.status !== 200 || !resLoginNuevo.body.accessToken) {
      throw new Error(`El login con la nueva contraseña falló: ${JSON.stringify(resLoginNuevo.body)}`);
    }
    console.log(`   ✅ Login con NUEVA contraseña exitoso. JWT generado: ${resLoginNuevo.body.accessToken.slice(0, 20)}...\n`);

    console.log('================================================================');
    console.log('🎉 ¡TODOS LOS 8 CASOS DE PRUEBA DE SEC-01 PASARON CON ÉXITO!');
    console.log('================================================================');
  } finally {
    // Limpieza
    await prisma.tokenRecuperacion.deleteMany({ where: { usuarioId: testUser.id } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: testUser.id } });
    await prisma.auditoria.deleteMany({ where: { usuarioId: testUser.id } });
    await prisma.usuario.delete({ where: { id: testUser.id } });
    await app.close();
  }
}

runRecoveryTests().catch((err) => {
  console.error('\n❌ ERROR EN LA VALIDACIÓN:', err);
  process.exit(1);
});
