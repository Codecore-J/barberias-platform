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
    'barbero.a.e106@test.com',
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
  let tokenCliente: string;
  let barberoA: string;
  let tokenBarberoA: string;

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

    const [rolAdmin, rolCliente, rolGlobal, rolBarbero] = await Promise.all([
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
      prisma.rol.upsert({
        where: { nombre: 'BARBERO' },
        update: {},
        create: { nombre: 'BARBERO', ambito: 'BARBERIA' },
      }),
    ]);

    const adminA = await crearUsuario('admin.a.e106@test.com', 'Admin A', '9992000001');
    const adminB = await crearUsuario('admin.b.e106@test.com', 'Admin B', '9992000002');
    const cliente = await crearUsuario('cliente.a.e106@test.com', 'Cliente A', '9992000003');
    const barbero = await crearUsuario('barbero.a.e106@test.com', 'Barbero A', '9992000005');
    const global = await crearUsuario('global.e106@test.com', 'Global', '9992000004');
    barberoA = barbero.id;

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
        // El CLIENTE es GLOBAL con `barberia_id` nulo: por eso `alcanceCumple`
        // lo dejaba pasar contra cualquier sede. Su pertenencia real va por
        // `cliente_barberias`, que es lo que comprueba la parte 3.
        { usuarioId: cliente.id, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: barbero.id, rolId: rolBarbero.id, barberiaId: barberiaA },
        { usuarioId: global.id, rolId: rolGlobal.id, barberiaId: null },
      ],
    });

    await prisma.clienteBarberia.create({
      data: { usuarioId: cliente.id, barberiaId: barberiaA, estadoVinculacion: 'ACTIVO' },
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
    tokenCliente = await login('cliente.a.e106@test.com');
    tokenBarberoA = await login('barbero.a.e106@test.com');
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

  /**
   * El alias que usa la app. `ServiciosService` llama a `${API_URL}/servicios`,
   * no a `/catalogo/servicios`, así que el contrato nuevo hay que comprobarlo
   * también en la URL que el frontend usa de verdad.
   */
  describe('GET /servicios/:id (alias de la app)', () => {
    it('devuelve el servicio cuando la sede viene en la cabecera', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(servicioA);
    });

    it('responde 404 si el servicio es de otra barbería', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/servicios/${servicioB}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de B');
    });

    it('responde 400 si no se indica la sede', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06');
    });

    it('la lista por alias sin sede tampoco devuelve todas las barberías', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/servicios')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de B');
    });
  });

  /**
   * `home` es la ÚNICA ruta de la app que llama a un handler con sede
   * obligatoria sin pasar por `tenantGuard`, así que es el único sitio donde el
   * 400 se ve de verdad. Antes de E1-06 ya respondía 400 desde
   * `ReservaService.obtenerAgendaDiaria`; aquí se fija el contrato nuevo.
   */
  describe('GET /reservas/agenda sin sede', () => {
    it('responde 400 en vez de buscar con params.id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reservas/agenda?fecha=2026-10-05')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
    });

    it('con sede devuelve 200 y no filtra datos de otra barbería', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reservas/agenda?fecha=2026-10-05')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  /**
   * La única ruta que usa la variante opcional. El ADMINISTRADOR global no
   * tiene sede activa (`GET /barberias` le devuelve `[]` porque filtra por
   * `responsableId`), y su panel de inicio llama a esta ruta sin cabecera. Si
   * `CurrentBarberiaIdOpcional` dejara de ser opcional, ese panel se rompe.
   */
  describe('GET /cobros/auditoria sin sede (ADMINISTRADOR global)', () => {
    it('responde 200 con el listado global, no 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cobros/auditoria')
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(200);
      // `consultarAuditorias` devuelve la página, no un array suelto.
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
    });

    it('un ADMIN_BARBERIA sin sede sigue recibiendo 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cobros/auditoria')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
    });
  });

    it('responde 200 con el listado global, no 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cobros/auditoria')
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(200);
      // `consultarAuditorias` devuelve la página, no un array suelto.
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
    });

    it('un ADMIN_BARBERIA sin sede sigue recibiendo 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cobros/auditoria')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
    });

  /**
   * E1-06 · parte 3. Los dos huecos que dejó la parte 1 del arreglo.
   *
   * 1. `/agenda/disponibilidad`: el guard y el decorador miran el ROL, y el
   *    `CLIENTE` es GLOBAL con `barberia_id` nulo, así que `alcanceCumple` lo
   *    admitía contra cualquier sede. Con solo la cabecera `x-barberia-id` un
   *    cliente autenticado leía los horarios de una barbería ajena.
   *
   * 2. `/seleccionar`: el servicio exigía una fila en `cliente_barberias`, que
   *    un BARBERO no tiene porque entra por `usuario_roles`. Pasaba el guard y
   *    recibía 404 en la ruta que el frontend encadena tras crear sede.
   */
  describe('E1-06 parte 3 · pertenencia a la sede', () => {
    it('un cliente NO puede leer la disponibilidad de otra sede: 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agenda/disponibilidad')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('x-barberia-id', barberiaB);

      expect(res.status).toBe(403);
    });

    it('el mismo cliente SÍ lee la disponibilidad de la suya', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agenda/disponibilidad')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('el POST también exige pertenencia: 403 desde el alias', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/agenda/disponibilidad')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('x-barberia-id', barberiaB)
        .send({ fecha: '2026-10-05', duracionTotal: 30 });

      expect(res.status).toBe(403);
    });

    it('el POST con la sede propia responde 200 (el alias ya no exige params.barberiaId)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/agenda/disponibilidad')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('x-barberia-id', barberiaA)
        .send({ fecha: '2026-10-05', duracionTotal: 30 });

      expect(res.status).toBe(200);
    });

    it('el ADMINISTRADOR global sí lee cualquier sede: es transversal', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agenda/disponibilidad')
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .set('x-barberia-id', barberiaB);

      expect(res.status).toBe(200);
    });

    it('un BARBERO de la sede selecciona sin tener fila en cliente_barberias: 200', async () => {
      const vinculos = await prisma.clienteBarberia.count({ where: { usuarioId: barberoA } });
      expect(vinculos, 'el barbero no debe tener vínculo de cliente').toBe(0);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/barberias/${barberiaA}/seleccionar`)
        .set('Authorization', `Bearer ${tokenBarberoA}`);

      expect(res.status).toBe(200);
      expect(res.body.vinculo).toBe('ROL');
    });

    it('el barbero NO puede seleccionar la sede en la que no trabaja', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/barberias/${barberiaB}/seleccionar`)
        .set('Authorization', `Bearer ${tokenBarberoA}`);

      expect(res.status).toBe(404);
    });

    it('un usuario sin vínculo ni rol recibe 404 en la sede ajena', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/barberias/${barberiaB}/seleccionar`)
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(res.status).toBe(404);
    });
  });
});
