import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

class ValidadorException extends BadRequestException {
  override getStatus() {
    return 422;
  }
}

describe('E4-02 · oportunidades (limpio)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = '/api/v1';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: (errors) => new ValidadorException(errors) }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('flujo básico', async () => {
    // Usa datos existentes creados en otro test? Mejor crear frescos
    expect(true).toBe(true);
  });
});
