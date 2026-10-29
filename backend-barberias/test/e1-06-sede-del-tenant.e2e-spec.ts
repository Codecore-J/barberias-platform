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
 * E1-06 + Fase 5 (Punto 5.3): la sede sale de la RUTA ()
 * y de ningún otro sitio.
 *
 * El contrato viejo permitía indicar la sede por cabecera (),
 * por query o cayendo en : en  el id del recurso
 * se usaba como id de barbería, el guard verificaba una sede y el servicio
 * consultaba otra. La cabecera se eliminó del backend y del frontend, así que
 * este archivo fija el contrato nuevo:
 *
 *  - la sede en la ruta acota el recurso (404 si es de otra barbería);
 *  - una sede que no es UUID responde 400, nunca se inventa un tenant;
 *  - las rutas planas del contrato viejo ya no existen (404);
 *  - la pertenencia se decide contra la sede de la ruta (403).
 */
describe('E1-06 · la sede sale de la ruta, nunca de una cabecera', () => {
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
      data: { telefonoVerificado: true, nombreCompleto: nombre, correo, telefono, passwordHash: hash },
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
        // `ambito: 'GLOBAL'` es la convención del producto (prisma/seed.ts:56):
        // el CLIENTE es global con `barberia_id` nulo y su pertenencia a una
        // sede va por `cliente_barberias`. Sembrarlo BARBERIA con barberia_id
        // nulo hace que `alcanceCumple` lo deniegue SIEMPRE y los dos tests de
        // "la sede propia" den 403 en una BD limpia (el fallo del primer run de
        // CI del PR #32). En una BD usada no se veía: el upsert con `update: {}`
        // heredaba el rol GLOBAL ya existente.
        create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
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

describe('GET /shops/:shopId/services/:id', () => {
    it('devuelve el servicio cuando la sede viene en la ruta', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/services/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(servicioA);
      expect(res.body.nombre).toBe('Corte E1-06 de A');
    });

    it('responde 404 si el servicio es de otra barbería', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/services/${servicioB}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Combo E1-06');
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de B');
    });

    it('responde 400 si la sede de la ruta no es un UUID, en vez de inventarse un tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/no-es-uuid/services/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/barber/i);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06');
    });

    it('la cabecera x-barberia-id ya NO decide la sede: manda la ruta', async () => {
      // La ruta dice B, la cabecera vieja dice A: si la cabecera contara, el
      // ADMIN_BARBERIA de A leería el recurso de B (era la fuga de E1-06).
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaB}/services/${servicioB}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de B');
    });

    it('el ADMINISTRADOR global lee cualquier sede por la ruta: es transversal', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/services/${servicioA}`)
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(servicioA);
    });
  });

  describe('GET /shops/:shopId/combos/:id', () => {
    it('devuelve el combo cuando la sede viene en la ruta', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/combos/${comboA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(comboA);
      expect(res.body.nombre).toBe('Combo E1-06 de A');
    });

    it('responde 404 si el combo es de otra barbería', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/combos/${comboB}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Combo E1-06 de B');
    });

    it('responde 400 si la sede de la ruta no es un UUID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/no-es-uuid/combos/${comboA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/barber/i);
      expect(JSON.stringify(res.body)).not.toContain('Combo E1-06 de A');
    });
  });

  describe('GET /shops/:shopId/services (lista)', () => {
    it('con sede lista solo los de esa barbería', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/services`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.map((s: any) => s.id)).toContain(servicioA);
      expect(res.body.map((s: any) => s.id)).not.toContain(servicioB);
    });

    it('otra sede lista lo suyo: la ruta acota el tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaB}/services`)
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(200);
      expect(res.body.map((s: any) => s.id)).toContain(servicioB);
      expect(res.body.map((s: any) => s.id)).not.toContain(servicioA);
    });
  });

  /**
   * Fase 5 (Punto 5.3): las rutas planas del contrato viejo se eliminaron sin
   * alias. Lo que pide una sede sin llevarla en la ruta ya no responde con un
   * 400 «indica la barbería»: la ruta simplemente no existe (404).
   */
  describe('las rutas planas del contrato antiguo ya no existen', () => {
    it('GET /catalogo/servicios/:id → 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalogo/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de A');
    });

    it('GET /servicios y GET /servicios/:id (alias de la app) → 404', async () => {
      const lista = await request(app.getHttpServer())
        .get('/api/v1/servicios')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);
      expect(lista.status).toBe(404);

      const detalle = await request(app.getHttpServer())
        .get(`/api/v1/servicios/${servicioA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);
      expect(detalle.status).toBe(404);
      expect(JSON.stringify(detalle.body)).not.toContain('Corte E1-06 de A');
    });

    it('GET /catalogo/servicios (lista plana) → 404, nunca todas las sedes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/catalogo/servicios')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('x-barberia-id', barberiaA);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Corte E1-06 de B');
    });
  });

  /**
   * `home` es la ÚNICA ruta de la app que llama a un handler con sede
   * obligatoria sin pasar por `tenantGuard`, así que era el único sitio donde el
   * 400 se veía de verdad. Con la sede en la ruta, esa llamada ya no existe.
   */
  describe('GET /shops/:shopId/appointments/day', () => {
    it('la ruta plana antigua (/reservas/agenda) ya no existe → 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reservas/agenda?fecha=2026-10-05')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
    });

    it('con sede en la ruta devuelve 200 y no filtra datos de otra barbería', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/appointments/day?fecha=2026-10-05`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  /**
   * La única ruta que usa la variante opcional del decorador: la auditoría de
   * cobros de una sede. La sede viaja en la ruta; la variante opcional existe
   * para que un `?shopId=` global siga siendo legítimo, no para prescindir de
   * la sede.
   */
  describe('GET /shops/:shopId/payments/audit', () => {
    it('el ADMINISTRADOR global la lee con la sede en la ruta', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/payments/audit`)
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
    });

    it('la ruta plana /cobros/auditoria ya no existe → 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cobros/auditoria')
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(404);
    });
  });

  /**
   * E1-06 · parte 3. Los dos huecos que dejó la parte 1 del arreglo.
   *
   * 1. `/appointments/schedule/availability`: el guard y el decorador miran el
   *    ROL, y el `CLIENTE` es GLOBAL con `barberia_id` nulo, así que
   *    `alcanceCumple` lo admitía contra cualquier sede. Con solo la cabecera
   *    `x-barberia-id` un cliente autenticado leía los horarios de una barbería
   *    ajena. Hoy la sede está en la RUTA, así que el cruce se intenta
   *    explícitamente contra la sede ajena.
   *
   * 2. `/select`: el servicio exigía una fila en `cliente_barberias`, que un
   *    BARBERO no tiene porque entra por `usuario_roles`. Pasaba el guard y
   *    recibía 404 en la ruta que el frontend encadena tras crear sede.
   */
  describe('E1-06 parte 3 · pertenencia a la sede', () => {
    const disponibilidad = '?fecha=2026-10-05&duracionMinutos=30';

    it('un cliente NO puede leer la disponibilidad de otra sede: 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaB}/appointments/schedule/availability${disponibilidad}`)
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(res.status).toBe(403);
    });

    it('el mismo cliente SÍ lee la disponibilidad de la suya', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaA}/appointments/schedule/availability${disponibilidad}`)
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('el POST también exige pertenencia: 403 contra la sede ajena', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/shops/${barberiaB}/appointments/schedule/availability`)
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ fecha: '2026-10-05', duracionTotal: 30 });

      expect(res.status).toBe(403);
    });

    it('el POST con la sede propia resuelve: 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/shops/${barberiaA}/appointments/schedule/availability`)
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ fecha: '2026-10-05', duracionTotal: 30 });

      // 201, no 200: `@Post('availability')` no lleva `@HttpCode`, así que Nest
      // aplica el 201 que da por defecto a POST (mismo motivo que en E1-06).
      expect(res.status).toBe(201);
    });

    it('el ADMINISTRADOR global sí lee cualquier sede: es transversal', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/shops/${barberiaB}/appointments/schedule/availability${disponibilidad}`)
        .set('Authorization', `Bearer ${tokenGlobal}`);

      expect(res.status).toBe(200);
    });

    it('un BARBERO de la sede selecciona sin tener fila en cliente_barberias: 200', async () => {
      const vinculos = await prisma.clienteBarberia.count({ where: { usuarioId: barberoA } });
      expect(vinculos, 'el barbero no debe tener vínculo de cliente').toBe(0);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/shops/${barberiaA}/select`)
        .set('Authorization', `Bearer ${tokenBarberoA}`);

      expect(res.status).toBe(200);
      expect(res.body.vinculo).toBe('ROL');
    });

    it('el barbero NO puede seleccionar la sede en la que no trabaja: 403', async () => {
      // Con la sede en la ruta, `RolesGuard` acota el rol a la sede B y el
      // barbero solo tiene rol en A: la denegación ocurre en el guard (403),
      // antes de que el servicio llegue a responder su 404 de siempre.
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/shops/${barberiaB}/select`)
        .set('Authorization', `Bearer ${tokenBarberoA}`);

      expect(res.status).toBe(403);
    });

    it('un usuario sin vínculo ni rol recibe 404 en la sede ajena', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/shops/${barberiaB}/select`)
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(res.status).toBe(404);
    });
  });
});