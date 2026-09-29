import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Healthcheck Probes & Observability (MON-01)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health', 'api/v1/health'],
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('debe responder HTTP 200 en /health con probes reales de base de datos y memoria', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.info).toBeDefined();
    expect(res.body.info.database).toBeDefined();
    expect(res.body.info.database.status).toBe('up');
    expect(res.body.info.memory_heap).toBeDefined();
    expect(res.body.info.memory_heap.status).toBe('up');
  });

  it('debe responder HTTP 200 en /api/v1/health para clientes de API y frontend', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.details).toBeDefined();
    expect(res.body.details.database.status).toBe('up');
  });

  it('debe responder HTTP 200 en /api/v1 con metadatos descriptivos en vez de Hello World (Hallazgo 13)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1')
      .expect(200);

    expect(res.body.name).toBe('Barberias Platform API');
    expect(res.body.status).toBe('online');
    expect(res.body.healthEndpoint).toBe('/api/v1/health');
    expect(res.body.timestamp).toBeDefined();
  });
});
