import { Test, TestingModule } from '@nestjs/testing';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaExceptionFilter } from './../src/shared/filters/prisma-exception.filter.js';
import { PrismaService } from './../src/shared/prisma/prisma.service.js';

/**
 * T-21 · Cuenta zombie por OTP (integración real: HTTP + PostgreSQL).
 *
 * Cubre el camino que ningún doble de test puede prometer: que el PATCH
 * persista el contacto nuevo, que el `GET /me` posterior lo devuelva y que el
 * UNIQUE de `usuarios.telefono` se traduzca en un 409 de negocio y no en un
 * 500. El envío del código NO se dispara aquí a propósito: cada envío es un
 * WhatsApp real y este test corre contra la base de desarrollo; el reenvío se
 * cubre con su 401 (autenticación) y con el unitario de `OtpService`.
 */
describe('T-21 · OTP para cuentas pendientes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** Sufijo único por ejecución: teléfono y correo son UNIQUE en la base. */
  const sufijo = String(Date.now()).slice(-7);
  const TELEFONO_A = `809${sufijo}`;
  const TELEFONO_B = `829${sufijo}`;
  const TELEFONO_NUEVO = `849${sufijo}`;
  const CORREO_A = `zombie.a.${sufijo}@test.com`;
  const CORREO_B = `zombie.b.${sufijo}@test.com`;

  let tokenA = '';
  let tokenB = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

    await app.init();
    prisma = app.get(PrismaService);

    // Dos cuentas recién registradas: nacen con los dos canales SIN verificar,
    // que es exactamente el estado «zombie» que T-21 tiene que desatascar.
    const altaA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        nombreCompleto: 'Zombie A',
        correo: CORREO_A,
        telefono: TELEFONO_A,
        password: 'Password123',
      })
      .expect(201);
    tokenA = altaA.body.accessToken;

    const altaB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        nombreCompleto: 'Zombie B',
        correo: CORREO_B,
        telefono: TELEFONO_B,
        password: 'Password123',
      })
      .expect(201);
    tokenB = altaB.body.accessToken;
  });

  afterAll(async () => {
    // Higiene: las cuentas de la prueba no se quedan en la base de desarrollo.
    await prisma.usuario
      .deleteMany({ where: { correo: { in: [CORREO_A, CORREO_B] } } })
      .catch(() => undefined);
    await app.close();
  });

  it('sin sesión no se puede reenviar ni cambiar el contacto (401)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/resend')
      .send({ tipo: 'TELEFONO' })
      .expect(401);

    await request(app.getHttpServer())
      .patch('/api/v1/auth/otp/update-contact')
      .send({ telefono: TELEFONO_NUEVO })
      .expect(401);
  });

  it('rechaza un teléfono con formato inválido antes de tocar la cuenta (400)', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/auth/otp/update-contact')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ telefono: '809555' })
      .expect(400);
  });

  it('exige al menos un contacto nuevo (400 CONTACTO_REQUERIDO)', async () => {
    const respuesta = await request(app.getHttpServer())
      .patch('/api/v1/auth/otp/update-contact')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(400);

    expect(respuesta.body.codigo).toBe('CONTACTO_REQUERIDO');
  });

  it('corrige el teléfono pendiente y el perfil pasa a devolverlo', async () => {
    const respuesta = await request(app.getHttpServer())
      .patch('/api/v1/auth/otp/update-contact')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ telefono: TELEFONO_NUEVO })
      .expect(200);

    expect(respuesta.body).toMatchObject({
      telefono: TELEFONO_NUEVO,
      correo: CORREO_A,
      canalesInvalidados: ['TELEFONO'],
    });

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.telefono).toBe(TELEFONO_NUEVO);
        // El cambio de destino NO puede dar el canal por verificado.
        expect(body.telefonoVerificado).toBe(false);
      });
  });

  it('un teléfono que ya es de otra cuenta responde 409 CONTACTO_EN_USO', async () => {
    const respuesta = await request(app.getHttpServer())
      .patch('/api/v1/auth/otp/update-contact')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ telefono: TELEFONO_NUEVO })
      .expect(409);

    expect(respuesta.body.codigo).toBe('CONTACTO_EN_USO');
  });

  it('repetir el contacto actual es un 200 idempotente, no un error', async () => {
    const respuesta = await request(app.getHttpServer())
      .patch('/api/v1/auth/otp/update-contact')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ telefono: TELEFONO_B })
      .expect(200);

    expect(respuesta.body.canalesInvalidados).toEqual([]);
  });
});
