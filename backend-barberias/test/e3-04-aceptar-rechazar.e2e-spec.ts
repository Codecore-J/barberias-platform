/**
 * E3-04 · Aceptar y rechazar solicitudes (§5.3 y §5.4; BACKLOG §E3-04).
 *
 * Solo con APP_ENV=dev.
 *
 * Pedidos de la tarea:
 *   1. POST /barberias/:barberiaId/reservas/:id/aceptar (ADMIN_BARBERIA,
 *      ADMINISTRADOR): PENDIENTE → CONFIRMADA, revalida disponibilidad bajo
 *      bloqueo y responde 409 SOLICITUD_EXPIRADA si `expira_at` ya pasó.
 *   2. POST .../:id/rechazar con `motivo_codigo` obligatorio del catálogo §5.5
 *      (`OTRO` exige detalle): PENDIENTE → RECHAZADA.
 *   3. Migración `motivo_codigo` / `motivo_detalle` con CHECK del catálogo.
 *   4. Cancelar el job de expiración (E3-05) y auditar RESERVA_CONFIRMADA y
 *      RESERVA_RECHAZADA.
 *
 * El arnés usa el MISMO pipe y filtro que `main.ts` (validación → 400), para
 * que los códigos de estado medidos aquí sean los de producción.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

describe('E3-04 · aceptar y rechazar solicitudes MANUALES', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let colaReservas: Queue;

  const api = '/api/v1';
  const correos = [
    'duenio.e304@test.com',
    'adminsede.e304@test.com',
    'adminajena.e304@test.com',
    'cliente.e304@test.com',
    'global.e304@test.com',
  ];

  let sede: string;
  let sedeAjena: string;
  let servicio: string;
  let tokenAdminSede: string;
  let tokenAdminAjena: string;
  let tokenCliente: string;

  const JOB_EXPIRAR = 'expirar-reserva';
  // Sin `:`: BullMQ rechaza los `jobId` propios que lo contienen.
  const jobIdDe = (reservaId: string) => `${JOB_EXPIRAR}-${reservaId}`;

  async function limpiar() {
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { in: correos } },
      select: { id: true },
    });
    const idsUsuario = usuarios.map((u) => u.id);

    const sedes = await prisma.barberia.findMany({
      where: { OR: [{ codigoAcceso: { startsWith: 'E304' } }, { responsableId: { in: idsUsuario } }] },
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
    await prisma.servicio.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.horario.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.reporte.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
  }

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
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    colaReservas = app.get<Queue>(getQueueToken('reservas-pendientes'));

    await limpiar();

    const roles: Record<string, string> = {};
    for (const [nombre, ambito] of [
      ['ADMINISTRADOR', 'GLOBAL'],
      ['ADMIN_BARBERIA', 'BARBERIA'],
      ['BARBERO', 'BARBERIA'],
      ['CLIENTE', 'GLOBAL'],
    ] as [string, string][]) {
      roles[nombre] = (
        await prisma.rol.upsert({
          where: { nombre },
          update: {},
          create: { nombre, ambito },
          select: { id: true },
        })
      ).id;
    }

    const [duenio, adminSede, adminAjena, cliente] = await Promise.all(
      correos.slice(0, 4).map((correo, i) =>
        prisma.usuario.create({
          data: {
            nombreCompleto: `E304 ${i}`,
            correo,
            telefono: `9997${String(i).padStart(7, '0')}`,
            passwordHash: '$2b$10$HashFalsoE304NoSeUsaParaLogin',
          },
          select: { id: true },
        }),
      ),
    );
    const global = await prisma.usuario.create({
      data: {
        nombreCompleto: 'E304 global',
        correo: correos[4],
        telefono: '99970000004',
        passwordHash: '$2b$10$HashFalsoE304NoSeUsaParaLogin',
      },
      select: { id: true },
    });

    // La sede bajo prueba y una sede ajena para el 403 cross-tenant.
    sede = (
      await prisma.barberia.create({
        data: {
          nombre: 'Sede E304',
          telefono: '9997111111',
          ubicacion: 'Sede E304',
          codigoAcceso: 'E304A',
          enlaceUnico: 'https://e304.test',
          responsableId: duenio.id,
        },
        select: { id: true },
      })
    ).id;

    sedeAjena = (
      await prisma.barberia.create({
        data: {
          nombre: 'Sede E304 ajena',
          telefono: '9997222222',
          ubicacion: 'Sede E304 ajena',
          codigoAcceso: 'E304B',
          enlaceUnico: 'https://e304-ajena.test',
          responsableId: duenio.id,
        },
        select: { id: true },
      })
    ).id;

    // modo_reserva default = MANUAL: la reserva nace PENDIENTE con expira_at.
    await prisma.configuracionBarberia.create({ data: { barberiaId: sede } });
    await prisma.configuracionBarberia.create({ data: { barberiaId: sedeAjena } });

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminSede.id, rolId: roles['ADMIN_BARBERIA'], barberiaId: sede },
        { usuarioId: adminAjena.id, rolId: roles['ADMIN_BARBERIA'], barberiaId: sedeAjena },
        { usuarioId: cliente.id, rolId: roles['CLIENTE'], barberiaId: null },
        { usuarioId: global.id, rolId: roles['ADMINISTRADOR'], barberiaId: null },
      ],
    });

    // La creación de la reserva exige vínculo ACTIVO entre el cliente y la sede.
    await prisma.clienteBarberia.create({
      data: { usuarioId: cliente.id, barberiaId: sede, estadoVinculacion: 'ACTIVO' },
    });

    servicio = (
      await prisma.servicio.create({
        data: {
          barberiaId: sede,
          nombre: 'Corte E304',
          precio: 30,
          duracionEstimada: 30,
          margenOperativo: 0,
        },
        select: { id: true },
      })
    ).id;

    // Horario de sede 00:00-23:59 todos los días: cualquier hora cuadra.
    await prisma.horario.createMany({
      data: Array.from({ length: 7 }, (_, diaSemana) => ({
        barberiaId: sede,
        diaSemana,
        horaInicio: new Date('1970-01-01T00:00:00.000Z'),
        horaFin: new Date('1970-01-01T23:59:00.000Z'),
      })),
    });

    tokenAdminSede = await jwtService.signAsync({ sub: adminSede.id, correo: correos[1], roles: [] });
    tokenAdminAjena = await jwtService.signAsync({ sub: adminAjena.id, correo: correos[2], roles: [] });
    tokenCliente = await jwtService.signAsync({ sub: cliente.id, correo: correos[3], roles: [] });
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 60_000);

  /** Crea una solicitud MANUAL legítima y devuelve su id (asserta el 201). */
  async function crearPendiente(horaInicio: string, dia = 1): Promise<string> {
    const [h, m] = horaInicio.split(':').map(Number);
    const fin = new Date(2000, 0, 1, h, m + 30);
    const horaFin = `${String(fin.getHours()).padStart(2, '0')}:${String(fin.getMinutes()).padStart(2, '0')}`;

    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${sede}/reservas`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .send({
        fecha: fecha(dia),
        horaInicio,
        horaFin,
        serviciosIds: [servicio],
        precioTotalEsperado: 30,
        tipo: 'INDIVIDUAL',
      });

    expect(
      res.status,
      `crear solicitud ${horaInicio}: ${res.status} ${JSON.stringify(res.body)}`,
    ).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE');
    return res.body.id;
  }

  const aceptar = (reservaId: string, token: string, barberiaId = sede) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/aceptar`)
      .set('Authorization', `Bearer ${token}`);

  const rechazar = (
    reservaId: string,
    token: string,
    body: Record<string, unknown>,
    barberiaId = sede,
  ) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/rechazar`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  // ── ROJO: aceptar ────────────────────────────────────────────────────────

  it('ROJO: aceptar una solicitud expirada → 409 SOLICITUD_EXPIRADA', async () => {
    const reservaId = await crearPendiente('11:00');
    // El job de expiración todavía no ha corrido: se fuerza el caducado en BD
    // para probar la comprobación de `expira_at` del servicio.
    await prisma.reserva.update({
      where: { id: reservaId },
      data: { expiraAt: new Date(Date.now() - 60_000) },
    });

    const res = await aceptar(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('SOLICITUD_EXPIRADA');

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('PENDIENTE');
  });

  it('ROJO: un admin de otra barbería recibe 403 al aceptar', async () => {
    const reservaId = await crearPendiente('16:00');

    const res = await aceptar(reservaId, tokenAdminAjena);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('PENDIENTE');
  });

  it('ROJO: un CLIENTE no puede aceptar su propia solicitud (403)', async () => {
    const reservaId = await crearPendiente('17:00');

    const res = await aceptar(reservaId, tokenCliente);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('ROJO: aceptar una reserva que ya no está PENDIENTE → 409 ESTADO_INVALIDO', async () => {
    const reservaId = await crearPendiente('12:00');
    const primera = await aceptar(reservaId, tokenAdminSede);
    expect(primera.status, JSON.stringify(primera.body)).toBe(201);

    const segunda = await aceptar(reservaId, tokenAdminSede);

    expect(segunda.status, JSON.stringify(segunda.body)).toBe(409);
    expect(segunda.body.codigo).toBe('ESTADO_INVALIDO');
  });

  // ── ROJO: rechazar ───────────────────────────────────────────────────────

  it('ROJO: rechazar sin motivo → 400', async () => {
    const reservaId = await crearPendiente('13:00');

    const sinMotivo = await rechazar(reservaId, tokenAdminSede, {});
    expect(sinMotivo.status, JSON.stringify(sinMotivo.body)).toBe(400);

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('PENDIENTE');
  });

  it('ROJO: rechazar con un motivo fuera del catálogo §5.5 → 400', async () => {
    const reservaId = await crearPendiente('14:00');

    const res = await rechazar(reservaId, tokenAdminSede, { motivoCodigo: 'LO_QUE_SEA' });

    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('ROJO: OTRO sin detalle suficiente → 400 (§5.5 exige 5 caracteres)', async () => {
    const reservaId = await crearPendiente('15:00');

    const corto = await rechazar(reservaId, tokenAdminSede, {
      motivoCodigo: 'OTRO',
      motivoDetalle: 'ab',
    });
    expect(corto.status, JSON.stringify(corto.body)).toBe(400);

    const vacio = await rechazar(reservaId, tokenAdminSede, { motivoCodigo: 'OTRO' });
    expect(vacio.status, JSON.stringify(vacio.body)).toBe(400);

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('PENDIENTE');
  });

  it('ROJO: un admin de otra barbería recibe 403 al rechazar', async () => {
    const reservaId = await crearPendiente('18:00');

    const res = await rechazar(
      reservaId,
      tokenAdminAjena,
      { motivoCodigo: 'HORARIO_NO_DISPONIBLE' },
    );

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('PENDIENTE');
    expect(enBd?.motivoCodigo).toBeNull();
  });

  // ── VERDE / CONTROL ──────────────────────────────────────────────────────

  it('CONTROL: aceptar PENDIENTE → CONFIRMADA, audita y cancela el job de expiración', async () => {
    const reservaId = await crearPendiente('09:00');

    // El job determinista existe antes de aceptar (lo encoló crearReserva).
    expect(await colaReservas.getJob(jobIdDe(reservaId))).toBeTruthy();

    const res = await aceptar(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('CONFIRMADA');

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('CONFIRMADA');

    const auditoria = await prisma.auditoria.findFirst({
      where: { accion: 'RESERVA_CONFIRMADA', entidadId: reservaId },
    });
    expect(auditoria, 'no se registró RESERVA_CONFIRMADA en auditoría').toBeTruthy();

    // E3-04 §4: el job de expiración se cancela al aceptar.
    expect(await colaReservas.getJob(jobIdDe(reservaId))).toBeFalsy();
  });

  it('CONTROL: rechazar con OTRO → RECHAZADA con motivo persistido, audita y cancela el job', async () => {
    const reservaId = await crearPendiente('10:00');
    expect(await colaReservas.getJob(jobIdDe(reservaId))).toBeTruthy();

    const res = await rechazar(reservaId, tokenAdminSede, {
      motivoCodigo: 'OTRO',
      motivoDetalle: 'El barbero asignado se ausentó por una urgencia familiar.',
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('RECHAZADA');
    expect(res.body.motivoCodigo).toBe('OTRO');
    expect(res.body.motivoDetalle).toContain('urgencia familiar');

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('RECHAZADA');
    expect(enBd?.motivoCodigo).toBe('OTRO');

    const auditoria = await prisma.auditoria.findFirst({
      where: { accion: 'RESERVA_RECHAZADA', entidadId: reservaId },
    });
    expect(auditoria, 'no se registró RESERVA_RECHAZADA en auditoría').toBeTruthy();

    expect(await colaReservas.getJob(jobIdDe(reservaId))).toBeFalsy();
  });

  it('CONTROL: rechazar libera el hueco (§5.3) y otra reserva entra en él', async () => {
    const reservaId = await crearPendiente('19:00');

    const res = await rechazar(reservaId, tokenAdminSede, {
      motivoCodigo: 'HORARIO_NO_DISPONIBLE',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.motivoDetalle).toBeNull();

    // Mismo hueco: si RECHAZADA siguiera ocupando, esto daría 409.
    const segunda = await request(app.getHttpServer())
      .post(`${api}/barberias/${sede}/reservas`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .send({
        fecha: fecha(1),
        horaInicio: '19:00',
        horaFin: '19:30',
        serviciosIds: [servicio],
        precioTotalEsperado: 30,
        tipo: 'INDIVIDUAL',
      });

    expect(
      segunda.status,
      `el hueco seguía ocupado tras rechazar: ${segunda.status} ${JSON.stringify(segunda.body)}`,
    ).toBe(201);
  });

  it('CONTROL: el CHECK de la migración rechaza un motivo fuera del catálogo', async () => {
    const reservaId = await crearPendiente('20:00');

    // Prueba directa de la base: el catálogo §5.5 no depende de la aplicación.
    await expect(
      prisma.reserva.update({
        where: { id: reservaId },
        data: { motivoCodigo: 'BASURA_FUERA_DEL_CATALOGO' },
      }),
    ).rejects.toThrow();
  });

  it('CONTROL: el CHECK exige detalle de 5 caracteres cuando el código es OTRO', async () => {
    const reservaId = await crearPendiente('21:00');

    await expect(
      prisma.reserva.update({
        where: { id: reservaId },
        data: { estado: 'RECHAZADA', motivoCodigo: 'OTRO', motivoDetalle: 'ab' },
      }),
    ).rejects.toThrow();
  });
});
