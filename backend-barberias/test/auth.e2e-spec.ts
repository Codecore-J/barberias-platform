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

describe('Auth Endpoints (e2e)', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register - Validaciones Defensivas', () => {
    it('debe rechazar con 400 si el payload está incompleto', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          // Falta correo, telefono, password
          nombreCompleto: 'Juan',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('debe rechazar con 400 si la contraseña no cumple la complejidad mínima', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          nombreCompleto: 'Juan Pérez',
          correo: 'juan.val@example.com',
          telefono: '+584141112233',
          password: '123', // Menor a 8 caracteres y sin letras
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('debe rechazar con 400 si la cédula contiene caracteres no numéricos', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          nombreCompleto: 'Juan Pérez',
          correo: 'juan.ced@example.com',
          telefono: '+584141112234',
          cedula: 'ABC-1234', // No numérico
          password: 'Password123',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/login - Control de Accesos', () => {
    it('debe rechazar con 401 para credenciales inexistentes con mensaje genérico', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          correo: 'usuario.inexistente.999@example.com',
          password: 'Password123',
        })
        .expect(401);

      expect(response.body.message).toBe('Credenciales inválidas.');
    });
  });

  describe('GET /api/v1/auth/me - Protección con JwtAuthGuard Global', () => {
    it('debe denegar el acceso con 401 si no se envía header Authorization Bearer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);
    });

    it('debe denegar el acceso con 401 si se envía un token malformado o inválido', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer token_invalido_xyz')
        .expect(401);
    });
  });
});
