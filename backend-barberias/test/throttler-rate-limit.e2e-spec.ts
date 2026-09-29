import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Rate Limiting / Anti-Brute-Force (SEC-02)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('debe permitir hasta 10 intentos de login y bloquear el 11vo con HTTP 429 y cabecera Retry-After', async () => {
    const loginPayload = {
      correo: 'bruteforce.test@example.com',
      password: 'WrongPassword123!',
    };

    // Realizar 10 peticiones consecutivas (permitidas bajo el rate limit de login)
    for (let i = 1; i <= 10; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginPayload);

      // Debería responder 401 (Credenciales inválidas), pero NO 429 todavía
      expect(res.status).toBe(401);
      expect(res.headers['x-ratelimit-limit']).toBe('10');
      expect(Number(res.headers['x-ratelimit-remaining'])).toBe(10 - i);
    }

    // El 11vo intento debe ser bloqueado inmediatamente por ThrottlerGuard con HTTP 429
    const blockedRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(loginPayload);

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(blockedRes.body.statusCode).toBe(429);
    expect(blockedRes.body.message).toContain('Demasiadas solicitudes');
  });

  it('debe permitir hasta 5 solicitudes de recuperación de contraseña y bloquear la 6ta con HTTP 429', async () => {
    const forgotPayload = {
      correo: 'forgot.test@example.com',
    };

    // 5 intentos permitidos
    for (let i = 1; i <= 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send(forgotPayload);

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('5');
    }

    // El 6to intento debe recibir 429
    const blockedRes = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send(forgotPayload);

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(blockedRes.body.statusCode).toBe(429);
  });
});
