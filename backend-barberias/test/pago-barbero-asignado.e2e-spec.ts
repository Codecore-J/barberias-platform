import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

/**
 * E3-09 · un BARBERO solo cobra las reservas que tiene asignadas.
 *
 * Antes de este cambio cualquier BARBERO de la sede podía cobrar CUALQUIER
 * reserva de esa sede, incluidas las asignadas a otro barbero: `validateAccess`
 * comprobaba sede y rol, pero no miraba `reserva.barberoId`. La decisión ya
 * tomada es:
 *
 *  - BARBERO con reserva asignada a él → cobra (201).
 *  - BARBERO con reserva asignada a OTRO barbero → 403.
 *  - BARBERO con reserva SIN asignar → 403 (debe asignarse primero).
 *  - ADMIN_BARBERIA y ADMINISTRADOR → cobran sin asignar, como hasta ahora.
 *
 * El bypass del ADMINISTRADOR y la validación de sede del ADMIN_BARBERIA no
 * cambian: los tests 4 y 5 de este fichero son los controles que lo garantizan.
 *
 * El POST se llama por el alias que usa el frontend (`POST /cobros` con la
 * cabecera x-barberia-id, `core/services/reservas.service.ts`), no por la ruta
 * con la sede en el path.
 */
describe('E3-09 · POST /cobros: el BARBERO solo cobra lo que tiene asignado', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const correos = [
    'duenio.pago.e309@test.com',
    'admin.pago.e309@test.com',
    'barbero.a.pago.e309@test.com',
    'barbero.b.pago.e309@test.com',
    'global.pago.e309@test.com',
    'cliente.pago.e309@test.com',
  ];

  let barberiaA: string;
  let clienteId: string;

  let tokenAdminSede: string;
  let tokenBarberoA: string;
  let tokenBarberoB: string;
  let tokenGlobal: string;

  // Una reserva por test: cobrarla la marca COMPLETADA, y una reserva ya
  // pagada responde 409, así que reutilizarla enmascararía el resultado.
  let reservaAjena: string;
  let reservaPropia: string;
  let reservaSinAsignarBarbero: string;
  let reservaSinAsignarAdmin: string;
  let reservaSinAsignarGlobal: string;

  const api = '/api/v1';

  async function crearUsuario(correo: string, nombre: string, telefono: string) {
    return prisma.usuario.create({
      data: {
        nombreCompleto: nombre,
        correo,
        telefono,
        passwordHash: await bcrypt.hash('Password1!', 10),
      },
    });
  }

  /** Reserva directa en la sede, con y sin barbero. */
  async function crearReserva(barberoId: string | null) {
    return prisma.reserva.create({
      data: {
        barberiaId: barberiaA,
        clienteId,
        barberoId,
        tipoReserva: 'INDIVIDUAL',
        estado: 'CONFIRMADA',
        modoConfirmacion: 'AUTOMATICA',
        fechaCita: new Date('2026-12-01'),
        horaInicio: new Date('1970-01-01T10:00:00.000Z'),
        horaFin: new Date('1970-01-01T10:45:00.000Z'),
        totalPagar: 100,
      },
      select: { id: true },
    });
  }

  async function cobrar(token: string, reservaId: string) {
    return request(app.getHttpServer())
      .post(`${api}/cobros`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-barberia-id', barberiaA)
      .send({ reservaId, monto: 100, metodoPago: 'EFECTIVO' });
  }

  /**
   * Limpieza idempotente, en orden de FK: pagos → reservas → auditoría →
   * usuario_roles → barbería → usuarios. Se usa al entrar y al salir, así un
   * run rojo (que sí llega a crear pagos) no contamina el siguiente.
   */
  async function limpiar() {
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { in: correos } },
      select: { id: true },
    });
    const idsUsuario = usuarios.map((u) => u.id);

    const sedes = await prisma.barberia.findMany({
      where: {
        OR: [
          { nombre: { contains: 'PAGO-E309' } },
          { responsableId: { in: idsUsuario } },
        ],
      },
      select: { id: true },
    });
    const idsSede = sedes.map((s) => s.id);

    const reservas = await prisma.reserva.findMany({
      where: { barberiaId: { in: idsSede } },
      select: { id: true },
    });
    const idsReserva = reservas.map((r) => r.id);

    await prisma.pago.deleteMany({ where: { reservaId: { in: idsReserva } } });
    await prisma.reserva.deleteMany({ where: { id: { in: idsReserva } } });
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.reporte.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // La suite entera corre contra el mismo storage en memoria: sin este
      // override los logins del beforeAll y los POST del test contarían contra
      // el límite global de 120/min y un 429 falsearía el resultado.
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    prisma = app.get(PrismaService);

    await limpiar();

    // Catálogo de roles (idempotente).
    const roles: Record<string, { id: string }> = {};
    for (const [nombre, ambito] of [
      ['ADMINISTRADOR', 'GLOBAL'],
      ['ADMIN_BARBERIA', 'BARBERIA'],
      ['BARBERO', 'BARBERIA'],
      ['CLIENTE', 'GLOBAL'],
    ] as [string, string][]) {
      roles[nombre] = await prisma.rol.upsert({
        where: { nombre },
        update: {},
        create: { nombre, ambito },
        select: { id: true },
      });
    }

    // Seis usuarios, cada uno con su teléfono (unique).
    const duenio = await crearUsuario(correos[0], 'Dueño Pago E309', '9997100001');
    const adminSede = await crearUsuario(correos[1], 'Admin Sede E309', '9997100002');
    const barberoA = await crearUsuario(correos[2], 'Barbero A E309', '9997100003');
    const barberoB = await crearUsuario(correos[3], 'Barbero B E309', '9997100004');
    const global = await crearUsuario(correos[4], 'Global E309', '9997100005');
    const cliente = await crearUsuario(correos[5], 'Cliente E309', '9997100006');
    clienteId = cliente.id;

    // La sede A es de duenio: el admin de sede NO es responsable, para que el
    // test 4 ejercite la rama del rol ADMIN_BARBERIA y no la del responsable.
    barberiaA = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia PAGO-E309',
          telefono: '9997111111',
          ubicacion: 'Sede E309',
          codigoAcceso: 'E309PAGO',
          enlaceUnico: 'https://pago.e309.test/x',
          responsableId: duenio.id,
        },
      })
    ).id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminSede.id, rolId: roles['ADMIN_BARBERIA'].id, barberiaId: barberiaA },
        { usuarioId: barberoA.id, rolId: roles['BARBERO'].id, barberiaId: barberiaA },
        { usuarioId: barberoB.id, rolId: roles['BARBERO'].id, barberiaId: barberiaA },
        { usuarioId: global.id, rolId: roles['ADMINISTRADOR'].id, barberiaId: null },
      ],
    });

    // Una reserva por test, todas en la misma sede. `reservaAjena` es de B y
    // la cobra A (debe fallar); `reservaPropia` es de B y la cobra B (debe pasar).
    reservaAjena = (await crearReserva(barberoB.id)).id;
    reservaPropia = (await crearReserva(barberoB.id)).id;
    reservaSinAsignarBarbero = (await crearReserva(null)).id;
    reservaSinAsignarAdmin = (await crearReserva(null)).id;
    reservaSinAsignarGlobal = (await crearReserva(null)).id;

    const login = async (correo: string) => {
      const res = await request(app.getHttpServer())
        .post(`${api}/auth/login`)
        .send({ correo, password: 'Password1!' });
      expect([200, 201], `login de ${correo} → ${res.status}`).toContain(res.status);
      return res.body.accessToken as string;
    };

    tokenAdminSede = await login(correos[1]);
    tokenBarberoA = await login(correos[2]);
    tokenBarberoB = await login(correos[3]);
    tokenGlobal = await login(correos[4]);
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 60_000);

  it('ROJO: un BARBERO NO cobra la reserva asignada a OTRO barbero de la misma sede (403)', async () => {
    const res = await cobrar(tokenBarberoA, reservaAjena);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/asignad/i);

    // Ni el pago ni la transición de estado se tocaron.
    const pago = await prisma.pago.findUnique({ where: { reservaId: reservaAjena } });
    expect(pago).toBeNull();
    const reserva = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaAjena } });
    expect(reserva.estado).toBe('CONFIRMADA');
  });

  it('VERDE: el BARBERO sí cobra la reserva que SÍ tiene asignada (control de no regresión)', async () => {
    const res = await cobrar(tokenBarberoB, reservaPropia);

    expect([200, 201]).toContain(res.status);
    const reserva = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaPropia } });
    expect(reserva.estado).toBe('COMPLETADA');
  });

  it('el BARBERO NO cobra una reserva SIN asignar: debe asignarse primero (403)', async () => {
    const res = await cobrar(tokenBarberoA, reservaSinAsignarBarbero);

    expect(res.status).toBe(403);
    const pago = await prisma.pago.findUnique({ where: { reservaId: reservaSinAsignarBarbero } });
    expect(pago).toBeNull();
  });

  it('el ADMIN_BARBERIA de la sede sí cobra una reserva SIN asignar (bypass de sede intacto)', async () => {
    const res = await cobrar(tokenAdminSede, reservaSinAsignarAdmin);

    expect([200, 201]).toContain(res.status);
    const reserva = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaSinAsignarAdmin } });
    expect(reserva.estado).toBe('COMPLETADA');
  });

  it('el ADMINISTRADOR global sí cobra una reserva SIN asignar (bypass global intacto)', async () => {
    const res = await cobrar(tokenGlobal, reservaSinAsignarGlobal);

    expect([200, 201]).toContain(res.status);
    const reserva = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaSinAsignarGlobal } });
    expect(reserva.estado).toBe('COMPLETADA');
  });
});
