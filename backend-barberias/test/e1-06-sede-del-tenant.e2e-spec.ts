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
 * E1-06: `@CurrentBarberiaId` caía en `params.id` como cuarta fuente, así que en
 * `GET /catalogo/servicios/:id` y `GET /catalogo/combos/:id` el id del recurso se
 * usaba como id de barbería y la consulta quedaba `{ id, barberiaId }` con los
 * dos iguales: nunca encontraba nada. Peor aún, el guard NO usa ese fallback, de
 * modo que el guard verificaba una sede y el servicio consultaba otra.
 *
 * El contrato que fija este archivo: la sede sale del contexto del tenant
 * (`params.barberiaId`, `x-barberia-id` o query) y, si no hay ninguna, la ruta
 * responde 400 en vez de inventarse un tenant.
 */
describe('E1-06 · la sede sale del tenant, nunca de params.id', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const correos = [
    'admin.a.e106@test.com',
    'admin.b.e106@test.com',
    'cliente.a.e106@test.com',
    'global.e106@test.com',
  ];

  let barberiaA: string;
  let barberiaB: string;
  let servicioA: string;
  let servicioB: string;
  let comboA: string;
  let comboB: string;
  let tokenAdminA: string;
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

    // Idempotencia. Las barberías van antes que los usuarios: `responsable_id`
    // es una FK y borrarlos al revés revienta la limpieza de una corrida previa.
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.barberia.deleteMany({
      where: { nombre: { contains: 'E1-06' } },
    });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });

    const [rolAdmin, rolCliente, rolGlobal] = await Promise.all([
      prisma.rol.upsert({
        where: { nombre: 'ADMIN_BARBERIA' },
        update: {},
        create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'CLIENTE' },
        update: {},
        create: { nombre: 'CLIENTE', ambito: 'BARBERIA' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'ADMINISTRADOR' },
        update: {},
        create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
      }),
    ]);

    const adminA = await crearUsuario('admin.a.e106@test.com', 'Admin A', '9992000001');
    const adminB = await crearUsuario('admin.b.e106@test.com', 'Admin B', '9992000002');
    const cliente = await crearUsuario('cliente.a.e106@test.com', 'Cliente A', '9992000003');
    const global = await crearUsuario('global.e106@test.com', 'Global', '9992000004');

    barberiaA = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia A E1-06',
          telefono: '9992111111',
          ubicacion: 'A',
          codigoAcceso: 'E106-AAAA',
          enlaceUnico: 'https://a.e106.test/x',
          responsableId: adminA.id,
        },
      })
    ).id;
    barberiaB = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia B E1-06',
          telefono: '9992222222',
          ubicacion: 'B',
          codigoAcceso: 'E106-BBBB',
          enlaceUnico: 'https://b.e106.test/x',
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

    servicioA = (
      await prisma.servicio.create({
        data: {
          barberiaId: barberiaA,
          nombre: 'Corte E1-06 de A',
          precio: 100,
          duracionEstimada: 30,
        },
      })
    ).id;
    servicioB = (
      await prisma.servicio.create({
        data: {
          barberiaId: barberiaB,
          nombre: 'Corte E1-06 de B',
          precio: 200,
          duracionEstimada: 45,
        },
      })
    ).id;
    comboA = (
      await prisma.combo.create({
        data: {
          barberiaId: barberiaA,
          nombre: 'Combo E1-06 de A',
          precioEspecial: 150,
          duracionPropia: 60,
        },
      })
    ).id;
    comboB = (
      await prisma.combo.create({
        data: {
          barberiaId: barberiaB,
          nombre: 'Combo E1-06 de B',
          precioEspecial: 250,
          duracionPropia: 90,
        },
      })
    ).id;

    const login = async (correo: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ correo, password: 'Password1!' });
      expect([200, 201], `login de ${correo}`).toContain(res.status);
      return res.body.accessToken as string;
    };

    tokenAdminA = await login('admin.a.e106@test.com');
    tokenGlobal = await login('global.e106@test.com');
  }, 60000);

  afterAll(async () => {
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.barberia.deleteMany({
      where: { nombre: { contains: 'E1-06' } },
    });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });
    await app.close();
  }, 30000);

  describe('GET /catalogo/servicios/:id', () => {
    it('devuelve el servicio cuando la sede viene en la cabecera', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(servicioA);
      expect(res.body.nombre).toBe('Corte E1-06 de A');
    });

    it('responde 404 si el servicio es de otra barbería', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/servicios/${servicioB}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Combo E1-06');
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de B');
    });

    it('responde 400 si no se indica la sede, en vez de usar params.id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/barber/i);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06');
    });

    it('el ADMINISTRADOR global sin sede activa recibe 400, no todas las sedes', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(400);
    });

    it('la ruta no filtra el recurso del admin de otra sede', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(servicioA);
    });
  });

  describe('GET /catalogo/combos/:id', () => {
    it('devuelve el combo cuando la sede viene en la cabecera', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/combos/${comboA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(comboA);
      expect(res.body.nombre).toBe('Combo E1-06 de A');
    });

    it('responde 404 si el combo es de otra barbería', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/combos/${comboB}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Combo E1-06 de B');
    });

    it('responde 400 si no se indica la sede, en vez de usar params.id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/combos/${comboA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/barber/i);
      expect(JSON.stringify(res.body)).not.toContain('Combo E1-06 de A');
    });

    it('el ADMINISTRADOR global sin sede activa recibe 400', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/combos/${comboA}`)
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /catalogo/servicios (lista)', () => {
    it('sin sede no lista los servicios de todas las barberías', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/catalogo/servicios')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de B');
    });

    it('con sede lista solo los de esa barbería', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/catalogo/servicios')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(200);
      expect(res.body.map((s: any) => s.id)).toContain(servicioA);
      expect(res.body.map((s: any) => s.id)).not.toContain(servicioB);
    });
  });
});