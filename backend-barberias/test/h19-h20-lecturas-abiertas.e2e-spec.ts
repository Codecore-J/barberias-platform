import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

/**
 * E1-03 (H19 y H20): dos lecturas abiertas a cualquier usuario con sesion.
 *
 * - GET /barberias/:id/personal lista barberos y administradores de cualquier
 *   barberia, con correo y telefono.
 * - GET /barberias/:barberiaId/agenda/bloqueos (y su alias /agenda/bloqueos)
 *   devuelve los bloqueos y el motivo de cualquier barberia.
 */

describe('E1-03 · personal y bloqueos no se abren a otros tenants (H19/H20)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const correos = [
    'admin.a.h19@test.com',
    'admin.b.h19@test.com',
    'cliente.h19@test.com',
    'global.h19@test.com',
  ];

  let barberiaA: string;
  let barberiaB: string;
  let tokenAdminA: string;
  let tokenAdminB: string;
  let tokenCliente: string;
  let tokenGlobal: string;

  async function crearUsuario(correo: string, nombre: string, telefono: string) {
    const hash = await bcrypt.hash('Password1!', 10);
    return prisma.usuario.create({
      data: { nombreCompleto: nombre, correo, telefono, passwordHash: hash },
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
    prisma = app.get(PrismaService);

    // Idempotencia.
    await prisma.auditoria.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.bloqueosAgenda.deleteMany({ where: { motivo: { startsWith: 'H19' } } });
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });

    const rolAdmin = await prisma.rol.upsert({
      where: { nombre: 'ADMIN_BARBERIA' },
      update: {},
      create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
    });
    const rolCliente = await prisma.rol.upsert({
      where: { nombre: 'CLIENTE' },
      update: {},
      create: { nombre: 'CLIENTE', ambito: 'BARBERIA' },
    });
    const rolGlobal = await prisma.rol.upsert({
      where: { nombre: 'ADMINISTRADOR' },
      update: {},
      create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
    });

    const adminA = await crearUsuario('admin.a.h19@test.com', 'Admin A', '9991000001');
    const adminB = await crearUsuario('admin.b.h19@test.com', 'Admin B', '9991000002');
    const cliente = await crearUsuario('cliente.h19@test.com', 'Cliente', '9991000003');
    const global = await crearUsuario('global.h19@test.com', 'Global', '9991000004');

    barberiaA = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia A H19',
          telefono: '9991111111',
          ubicacion: 'A',
          codigoAcceso: 'H19-AAAA',
          enlaceUnico: 'https://a.h19.test/x',
          responsableId: adminA.id,
        },
      })
    ).id;
    barberiaB = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia B H19',
          telefono: '9992222222',
          ubicacion: 'B',
          codigoAcceso: 'H19-BBBB',
          enlaceUnico: 'https://b.h19.test/x',
          responsableId: adminB.id,
        },
      })
    ).id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminA.id, rolId: rolAdmin.id, barberiaId: barberiaA },
        { usuarioId: adminB.id, rolId: rolAdmin.id, barberiaId: barberiaB },
        { usuarioId: cliente.id, rolId: rolCliente.id, barberiaId: barberiaA },
        { usuarioId: global.id, rolId: rolGlobal.id, barberiaId: null },
      ],
    });

    // Dos bloqueos private en la barberia B, con motivo.
    await prisma.bloqueosAgenda.createMany({
      data: [
        {
          barberiaId: barberiaB,
          fecha: new Date(),
          horaInicio: new Date('1970-01-01T09:00:00.000Z'),
          horaFin: new Date('1970-01-01T12:00:00.000Z'),
          motivo: 'H19 bloqueo privado de B',
          creadoPor: adminB.id,
        },
        {
          barberiaId: barberiaB,
          fecha: new Date(),
          horaInicio: new Date('1970-01-01T15:00:00.000Z'),
          horaFin: new Date('1970-01-01T18:00:00.000Z'),
          motivo: 'H19 almuerzo de B',
          creadoPor: adminB.id,
        },
      ],
    });

    const login = async (correo: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ correo, password: 'Password1!' });
      expect([200, 201], `login de ${correo}`).toContain(res.status);
      return res.body.accessToken as string;
    };

    tokenAdminA = await login('admin.a.h19@test.com');
    tokenAdminB = await login('admin.b.h19@test.com');
    tokenCliente = await login('cliente.h19@test.com');
    tokenGlobal = await login('global.h19@test.com');
  }, 60000);

  afterAll(async () => {
    await prisma.bloqueosAgenda.deleteMany({ where: { motivo: { startsWith: 'H19' } } });
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    const ids = [barberiaA, barberiaB].filter(Boolean) as string[];
    if (ids.length > 0) {
      await prisma.barberia.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });
    await app.close();
  }, 30000);

  describe('GET /barberias/:id/personal', () => {
    it('un CLIENTE recibe 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/barberias/${barberiaB}/personal`)
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(res.status).toBe(403);
    });

    it('un ADMIN de otra barberia recibe 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/barberias/${barberiaB}/personal`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(403);
    });

    it('el ADMIN propio recibe 200 con correo y telefono', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/barberias/${barberiaB}/personal`)
        .set('Authorization', `Bearer ${tokenAdminB}`);

      expect(res.status).toBe(200);
      expect(res.body[0].correo).toBe('admin.b.h19@test.com');
      expect(res.body[0].telefono).toBeTruthy();
    });

    it('el ADMINISTRADOR global recibe 200 con correo y telefono', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/barberias/${barberiaB}/personal`)
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(200);
      expect(res.body[0].correo).toBe('admin.b.h19@test.com');
    });
  });

  describe('GET /barberias/:barberiaId/agenda/bloqueos', () => {
    it('un CLIENTE recibe 403 y no ve motivos', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/barberias/${barberiaB}/agenda/bloqueos`)
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('H19 bloqueo');
    });

    it('un ADMIN de otra barberia recibe 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/barberias/${barberiaB}/agenda/bloqueos`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(403);
    });

    it('el ADMIN propio recibe 200 con sus bloqueos', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/barberias/${barberiaB}/agenda/bloqueos`)
        .set('Authorization', `Bearer ${tokenAdminB}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });
});