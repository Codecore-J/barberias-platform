import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * F6 · dos altas simultáneas de `ADMIN_BARBERIA` en la MISMA sede.
 *
 * El contrato debe ser uno solo: un ganador (201) y un perdedor con
 * `409 SEDE_YA_TIENE_ADMIN` **y `adminActual`**, venga el rechazo de la regla de
 * dominio (409 explícito) o del trigger de PostgreSQL (P2002 → traducido).
 * Nunca 500, nunca dos administradores.
 *
 * Solo con `APP_ENV=dev` contra el Postgres local, igual que el resto de la
 * suite; cada corrida usa un sufijo único y limpia sus propias fixtures.
 */

const DOMINIO = 'f6-concurrente.e2e.test';
const PREFIJO_SEDE = 'E2E-F6-';

describe('F6 · carrera por el administrador único (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const digitos = String(Date.now()).slice(-7);
  const password = 'Password1!';

  const correos = {
    global: `global.f6-${sufijo}@${DOMINIO}`,
    primero: `primero.f6-${sufijo}@${DOMINIO}`,
    segundo: `segundo.f6-${sufijo}@${DOMINIO}`,
  };

  let tokenGlobal = '';
  let sedeId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // Limpieza de corridas anteriores de ESTE archivo (solo lo suyo).
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { endsWith: `@${DOMINIO}` } },
      select: { id: true },
    });
    const sedes = await prisma.barberia.findMany({
      where: { codigoAcceso: { startsWith: PREFIJO_SEDE } },
      select: { id: true },
    });
    const usuarioIds = usuarios.map((u) => u.id);
    const sedeIds = sedes.map((s) => s.id);
    if (usuarioIds.length > 0 || sedeIds.length > 0) {
      await prisma.auditoria.deleteMany({
        where: {
          OR: [
            ...(usuarioIds.length > 0 ? [{ usuarioId: { in: usuarioIds } }] : []),
            ...(sedeIds.length > 0 ? [{ barberiaId: { in: sedeIds } }] : []),
          ],
        },
      });
      await prisma.usuarioRol.deleteMany({
        where: { OR: [{ usuarioId: { in: usuarioIds } }, { barberiaId: { in: sedeIds } }] },
      });
      await prisma.barberia.deleteMany({ where: { id: { in: sedeIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
    }

    const rolAdministrador = await prisma.rol.upsert({
      where: { nombre: 'ADMINISTRADOR' },
      update: {},
      create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
    });
    await prisma.rol.upsert({
      where: { nombre: 'ADMIN_BARBERIA' },
      update: {},
      create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
    });
    await prisma.rol.upsert({
      where: { nombre: 'CLIENTE' },
      update: {},
      create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
    });

    await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        nombreCompleto: 'Global F6',
        correo: correos.global,
        telefono: `84${digitos}0`,
        password,
      });

    const global = await prisma.usuario.findUniqueOrThrow({
      where: { correo: correos.global },
      select: { id: true },
    });
    await prisma.usuarioRol.create({
      data: { usuarioId: global.id, rolId: rolAdministrador.id, barberiaId: null },
    });

    const sede = await prisma.barberia.create({
      data: {
        nombre: `Sede F6-${sufijo}`,
        telefono: `85${digitos}0`,
        ubicacion: 'Sede F6 E2E',
        estado: 'ACTIVO',
        codigoAcceso: `${PREFIJO_SEDE}${sufijo}`,
        enlaceUnico: `https://f6-${sufijo}.test`,
        responsableId: global.id,
      },
      select: { id: true },
    });
    sedeId = sede.id;

    const login = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo: correos.global, password });
    expect(login.status).toBe(200);
    tokenGlobal = login.body.accessToken;
  }, 240_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it('dos altas simultáneas: 201 + 409 SEDE_YA_TIENE_ADMIN con adminActual, sin 500', async () => {
    const alta = (correo: string, telefono: string) =>
      request(app.getHttpServer())
        .post(`${api}/plataforma/usuarios`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({
          nombreCompleto: `Carrera ${correo}`,
          correo,
          telefono,
          password,
          rolNombre: 'ADMIN_BARBERIA',
          barberiaId: sedeId,
        });

    const respuestas = await Promise.all([
      alta(correos.primero, `86${digitos}1`),
      alta(correos.segundo, `86${digitos}2`),
    ]);

    const estados = respuestas.map((r) => r.status).sort();
    expect(estados, JSON.stringify(respuestas.map((r) => r.body))).toEqual([201, 409]);

    const perdedor = respuestas.find((r) => r.status === 409);
    expect(perdedor).toBeDefined();
    expect(perdedor?.body).toMatchObject({
      statusCode: 409,
      codigo: 'SEDE_YA_TIENE_ADMIN',
      adminActual: { id: expect.any(String), correo: expect.any(String) },
    });

    // Y en la base: un solo administrador activo, el de la respuesta 201.
    const admins = await prisma.usuarioRol.count({
      where: { barberiaId: sedeId, estado: 'ACTIVO', rol: { nombre: 'ADMIN_BARBERIA' } },
    });
    expect(admins).toBe(1);
  }, 90_000);
});
