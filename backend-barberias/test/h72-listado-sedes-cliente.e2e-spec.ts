import { Test, TestingModule } from '@nestjs/testing';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

const API = '/api/v1';

/**
 * H72 · `GET /mi-estado/barberias` — el CLIENTE ve sus sedes, y solo las suyas.
 *
 * El hallazgo era que `GET /barberias` filtra por `responsableId` y a un cliente
 * puro le devuelve `[]`, así que la tarjeta de su vínculo (y el botón de salir
 * de E3-12/3) no tenía lista donde pintarse. Lo que se prueba aquí es la regla
 * de lectura COMPLETA, no el caso feliz:
 *
 *   1. aislamiento: el token de A nunca trae una sede de B;
 *   2. filtro de vínculo: `DESVINCULADO` es historial, no sede donde operar;
 *   3. filtro de sede: una barbería `INACTIVO` (suspendida, E2-07) no se ofrece;
 *   4. política: solo el CLIENTE (el BARBERO y el ADMIN_BARBERIA reciben 403);
 *   5. contrato: el estado del vínculo y la sede activa viajan, y `codigoAcceso`
 *      y `enlaceUnico` NO (el cliente ya está dentro: no necesita la puerta).
 *
 * Las filas se siembran por Prisma a propósito: lo que se mide es la LECTURA
 * (la consulta y su filtro), no el alta del vínculo, que tiene sus propias
 * suites (`e3-12-vinculacion`, `e3-12-desvinculacion`).
 */
describe('H72 · el cliente lista sus sedes (GET /mi-estado/barberias)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let clienteAId: string;
  let clienteBId: string;
  let barberoId: string;
  let adminSedeId: string;

  let tokenClienteA: string;
  let tokenClienteB: string;
  let tokenBarbero: string;
  let tokenAdminSede: string;
  let tokenAdminGlobal: string;

  /** Sedes del cliente A: la activa, la pendiente y las dos que NO deben salir. */
  let sedeActivaA: string;
  let sedePendienteA: string;
  let sedeCerradaA: string;
  let sedeSuspendidaA: string;
  /** Sede del cliente B: existe, pero A no puede verla. */
  let sedeDeB: string;
  /** Sede sin ningún vínculo: la puerta que a nadie le toca. */
  let sedeSinVinculo: string;

  let adminGlobalId: string;

  const sufijo = Date.now();
  const PASSWORD = 'ClaveH72123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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
    app.setGlobalPrefix(API);
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    const [rolAdministrador, rolAdminBarberia, rolBarbero, rolCliente] = await Promise.all([
      prisma.rol.upsert({
        where: { nombre: 'ADMINISTRADOR' },
        update: {},
        create: { nombre: 'ADMINISTRADOR', ambito: 'GLOBAL' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'ADMIN_BARBERIA' },
        update: {},
        create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'BARBERO' },
        update: {},
        create: { nombre: 'BARBERO', ambito: 'BARBERIA' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'CLIENTE' },
        update: {},
        create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
      }),
    ]);

    const hash = await bcrypt.hash(PASSWORD, 10);

    const crearUsuario = async (etiqueta: string, telefono: string) =>
      (
        await prisma.usuario.create({
          data: {
            nombreCompleto: `${etiqueta} H72 ${sufijo}`,
            correo: `${etiqueta}.h72.${sufijo}@test.com`,
            telefono,
            passwordHash: hash,
          },
          select: { id: true },
        })
      ).id;

    adminGlobalId = await crearUsuario('global', `1${String(sufijo).slice(-9)}`);
    clienteAId = await crearUsuario('cliente.a', `2${String(sufijo).slice(-9)}`);
    clienteBId = await crearUsuario('cliente.b', `3${String(sufijo).slice(-9)}`);
    barberoId = await crearUsuario('barbero', `4${String(sufijo).slice(-9)}`);
    adminSedeId = await crearUsuario('admin.sede', `5${String(sufijo).slice(-9)}`);

    const crearSede = async (etiqueta: string, estado = 'ACTIVO') =>
      (
        await prisma.barberia.create({
          data: {
            nombre: `Barbería ${etiqueta} ${sufijo}`,
            telefono: '955555555',
            ubicacion: `Sede ${etiqueta}`,
            codigoAcceso: `H72${etiqueta.replace(/\W/g, '').slice(0, 3)}${String(sufijo).slice(-5)}`,
            enlaceUnico: `h72-${etiqueta}-${sufijo}`,
            responsableId: adminGlobalId,
            estado,
          },
          select: { id: true },
        })
      ).id;

    // Se crean en orden de nombre DESCENDENTE para que el orden de la respuesta
    // (activa primero, luego por nombre) no coincida con el de creación.
    sedeSuspendidaA = await crearSede('z.suspendida', 'INACTIVO');
    sedeCerradaA = await crearSede('y.cerrada');
    sedeSinVinculo = await crearSede('x.sin vinculo');
    sedePendienteA = await crearSede('b.pendiente');
    sedeDeB = await crearSede('c.de b');
    sedeActivaA = await crearSede('a.activa');

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminGlobalId, rolId: rolAdministrador.id, barberiaId: null },
        { usuarioId: adminSedeId, rolId: rolAdminBarberia.id, barberiaId: sedeActivaA },
        { usuarioId: barberoId, rolId: rolBarbero.id, barberiaId: sedeActivaA },
        { usuarioId: clienteAId, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: clienteBId, rolId: rolCliente.id, barberiaId: null },
      ],
    });

    await prisma.clienteBarberia.createMany({
      data: [
        // Las dos que SÍ deben salir: una operativa y otra esperando plataforma.
        { usuarioId: clienteAId, barberiaId: sedeActivaA, estadoVinculacion: 'ACTIVO', esBarberiaActiva: true },
        {
          usuarioId: clienteAId,
          barberiaId: sedePendienteA,
          estadoVinculacion: 'PENDIENTE_APROBACION',
          esBarberiaActiva: false,
        },
        // Las dos que NO: historial cerrado (D20/D21) y sede suspendida (E2-07).
        { usuarioId: clienteAId, barberiaId: sedeCerradaA, estadoVinculacion: 'DESVINCULADO', esBarberiaActiva: false },
        { usuarioId: clienteAId, barberiaId: sedeSuspendidaA, estadoVinculacion: 'ACTIVO', esBarberiaActiva: false },
        // La de B: existe y A no puede verla.
        { usuarioId: clienteBId, barberiaId: sedeDeB, estadoVinculacion: 'ACTIVO', esBarberiaActiva: true },
      ],
    });

    const correos = await prisma.usuario.findMany({
      where: { id: { in: [adminGlobalId, adminSedeId, barberoId, clienteAId, clienteBId] } },
      select: { id: true, correo: true },
    });
    const correoDe = (id: string) => correos.find((u) => u.id === id)!.correo;

    tokenAdminGlobal = await jwtService.signAsync({
      sub: adminGlobalId,
      correo: correoDe(adminGlobalId),
      roles: ['ADMINISTRADOR'],
    });
    tokenAdminSede = await jwtService.signAsync({
      sub: adminSedeId,
      correo: correoDe(adminSedeId),
      roles: ['ADMIN_BARBERIA'],
    });
    tokenBarbero = await jwtService.signAsync({
      sub: barberoId,
      correo: correoDe(barberoId),
      roles: ['BARBERO'],
    });
    tokenClienteA = await jwtService.signAsync({
      sub: clienteAId,
      correo: correoDe(clienteAId),
      roles: ['CLIENTE'],
    });
    tokenClienteB = await jwtService.signAsync({
      sub: clienteBId,
      correo: correoDe(clienteBId),
      roles: ['CLIENTE'],
    });
  }, 120_000);

  afterAll(async () => {
    const idsSede = [
      sedeActivaA,
      sedePendienteA,
      sedeCerradaA,
      sedeSuspendidaA,
      sedeDeB,
      sedeSinVinculo,
    ];
    const idsUsuario = [adminGlobalId, adminSedeId, barberoId, clienteAId, clienteBId];

    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.usuarioRol.deleteMany({
      where: { OR: [{ usuarioId: { in: idsUsuario } }, { barberiaId: { in: idsSede } }] },
    });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });

    await app.close();
  }, 60_000);

  const listar = (token: string) =>
    request(app.getHttpServer())
      .get(`${API}/mi-estado/barberias`)
      .set('Authorization', `Bearer ${token}`);

  describe('el cliente A recibe exactamente sus sedes visibles', () => {
    it('200: solo la activa y la pendiente, con la activa primero', async () => {
      const res = await listar(tokenClienteA).expect(200);

      expect(res.body.map((sede: { id: string }) => sede.id)).toEqual([
        sedeActivaA,
        sedePendienteA,
      ]);
      // Orden pedido a la consulta: sede activa primero, luego por nombre.
      expect(res.body[0].nombre).toContain('a.activa');
    });

    it('el estado del vínculo viaja para que la tarjeta pueda anunciarlo', async () => {
      const res = await listar(tokenClienteA).expect(200);

      const porId = new Map<string, any>(res.body.map((s: any) => [s.id, s]));

      expect(porId.get(sedeActivaA)).toMatchObject({
        id: sedeActivaA,
        estadoVinculacion: 'ACTIVO',
        esBarberiaActiva: true,
        estado: 'ACTIVO',
      });
      expect(porId.get(sedePendienteA)).toMatchObject({
        estadoVinculacion: 'PENDIENTE_APROBACION',
        esBarberiaActiva: false,
      });
    });

    it('no expone la puerta de entrada: sin codigoAcceso ni enlaceUnico', async () => {
      const res = await listar(tokenClienteA).expect(200);

      for (const sede of res.body) {
        expect(sede).not.toHaveProperty('codigoAcceso');
        expect(sede).not.toHaveProperty('enlaceUnico');
      }
    });
  });

  describe('los filtros del encargo se aplican en la consulta', () => {
    it('excluye el vínculo DESVINCULADO: el historial no es una sede donde operar', async () => {
      const res = await listar(tokenClienteA).expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).not.toContain(sedeCerradaA);
    });

    it('excluye la barbería inactiva aunque el vínculo esté ACTIVO', async () => {
      const res = await listar(tokenClienteA).expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).not.toContain(sedeSuspendidaA);
    });

    it('la sede que existe pero no tiene vínculo tampoco aparece', async () => {
      const res = await listar(tokenClienteA).expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).not.toContain(sedeSinVinculo);
    });
  });

  describe('aislamiento entre clientes (D48)', () => {
    it('el token de A no devuelve ninguna sede de B', async () => {
      const res = await listar(tokenClienteA).expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).not.toContain(sedeDeB);
      expect(res.body).toHaveLength(2);
    });

    it('el token de B solo trae la suya', async () => {
      const res = await listar(tokenClienteB).expect(200);

      expect(res.body.map((s: { id: string }) => s.id)).toEqual([sedeDeB]);
    });
  });

  describe('política de la ruta', () => {
    it('sin token responde 401', async () => {
      await request(app.getHttpServer()).get(`${API}/mi-estado/barberias`).expect(401);
    });

    it('el BARBERO recibe 403: su listado es por rol, no por vínculo de cliente', async () => {
      await listar(tokenBarbero).expect(403);
    });

    it('el ADMIN_BARBERIA recibe 403: su listado es el de responsable (E1-07)', async () => {
      await listar(tokenAdminSede).expect(403);
    });

    it('el ADMINISTRADOR pasa por jerarquía (E1-04) y solo ve sus propios vínculos', async () => {
      const res = await listar(tokenAdminGlobal).expect(200);

      expect(res.body).toEqual([]);
    });
  });
});
