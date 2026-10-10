/**
 * E3-08 · Cancelación especial (D17) + Propuesta de horario (D18, §5.4).
 *
 * Solo con APP_ENV=dev.
 *
 * Pedidos de la tarea:
 *   1. Migración D17: `permite_cancelacion_especial` en la configuración y
 *      `cancelado_por_id`, `cancelacion_especial_estado/motivo/detalle` en la
 *      reserva.
 *   2. `POST /barberias/:barberiaId/reservas/:id/cancelacion-especial`
 *      (ADMIN_BARBERIA, ADMINISTRADOR): registra quién la ejecutó, el motivo,
 *      libera el horario, cancela el job de expiración y audita.
 *   3. `POST .../proponer-horario` (CLIENTE dueño): propone un bloque que NO
 *      ocupa agenda hasta que la sede lo acepte (ventana de 10 minutos).
 *
 * El arnés usa el MISMO pipe y filtro que `main.ts`, así que los códigos de
 * estado medidos son los de producción.
 *
 * NOTA DE EJECUCIÓN: necesita Redis (el módulo de reservas registra la cola real)
 * y una base de datos alcanzable.
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
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

describe('E3-08 · cancelación especial y propuesta de horario', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const api = '/api/v1';
  const correos = [
    'duenio.e308@test.com',
    'adminsede.e308@test.com',
    'adminajena.e308@test.com',
    'cliente.e308@test.com',
    'cliente2.e308@test.com',
  ];

  let sede: string;
  let sedeSinFlag: string;
  let sedeAjena: string;
  let servicio: string;
  let servicioSinFlag: string;
  let tokenAdminSede: string;
  let tokenAdminAjena: string;
  let tokenCliente: string;
  let tokenCliente2: string;

  async function limpiar() {
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { in: correos } },
      select: { id: true },
    });
    const idsUsuario = usuarios.map((u) => u.id);

    const sedes = await prisma.barberia.findMany({
      where: {
        OR: [{ codigoAcceso: { startsWith: 'E308' } }, { responsableId: { in: idsUsuario } }],
      },
      select: { id: true },
    });
    const idsSede = sedes.map((s) => s.id);

    const reservas = await prisma.reserva.findMany({
      where: { barberiaId: { in: idsSede } },
      select: { id: true },
    });
    const idsReserva = reservas.map((r) => r.id);

    // Las propuestas caen en cascada al borrar sus reservas.
    await prisma.pago.deleteMany({ where: { reservaId: { in: idsReserva } } });
    await prisma.reserva.deleteMany({ where: { id: { in: idsReserva } } });
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: idsReserva } } });
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

    const [duenio, adminSede, adminAjena, cliente, cliente2] = await Promise.all(
      correos.map((correo, i) =>
        prisma.usuario.create({
          data: {
            nombreCompleto: `E308 ${i}`,
            correo,
            telefono: `9928${String(i).padStart(7, '0')}`,
            passwordHash: '$2b$10$HashFalsoE308NoSeUsaParaLogin',
          },
          select: { id: true },
        }),
      ),
    );

    const crearSede = async (nombre: string, codigoAcceso: string, enlace: string) =>
      (
        await prisma.barberia.create({
          data: {
            nombre,
            telefono: '9928000000',
            ubicacion: nombre,
            codigoAcceso,
            enlaceUnico: enlace,
            responsableId: duenio.id,
          },
          select: { id: true },
        })
      ).id;

    sede = await crearSede('Sede E308', 'E308A', 'https://e308.test');
    sedeSinFlag = await crearSede('Sede E308 sin flag', 'E308B', 'https://e308-sin-flag.test');
    sedeAjena = await crearSede('Sede E308 ajena', 'E308C', 'https://e308-ajena.test');

    // modo_reserva default = MANUAL: la reserva nace PENDIENTE y se acepta por API.
    await prisma.configuracionBarberia.create({ data: { barberiaId: sede } });
    await prisma.configuracionBarberia.create({ data: { barberiaId: sedeSinFlag } });
    await prisma.configuracionBarberia.create({ data: { barberiaId: sedeAjena } });

    // D17: la bandera es FALSE por defecto; solo esta sede la habilita.
    await prisma.configuracionBarberia.update({
      where: { barberiaId: sede },
      data: { permiteCancelacionEspecial: true },
    });

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminSede.id, rolId: roles['ADMIN_BARBERIA'], barberiaId: sede },
        // La misma persona administra también la sede SIN la bandera D17.
        { usuarioId: adminSede.id, rolId: roles['ADMIN_BARBERIA'], barberiaId: sedeSinFlag },
        { usuarioId: adminAjena.id, rolId: roles['ADMIN_BARBERIA'], barberiaId: sedeAjena },
        { usuarioId: cliente.id, rolId: roles['CLIENTE'], barberiaId: null },
        { usuarioId: cliente2.id, rolId: roles['CLIENTE'], barberiaId: null },
      ],
    });

    for (const usuarioId of [cliente.id, cliente2.id]) {
      await prisma.clienteBarberia.create({
        data: { usuarioId, barberiaId: sede, estadoVinculacion: 'ACTIVO' },
      });
      await prisma.clienteBarberia.create({
        data: { usuarioId, barberiaId: sedeSinFlag, estadoVinculacion: 'ACTIVO' },
      });
    }

    const crearServicio = async (barberiaId: string, nombre: string) =>
      (
        await prisma.servicio.create({
          data: {
            barberiaId,
            nombre,
            precio: 30,
            duracionEstimada: 30,
            margenOperativo: 0,
          },
          select: { id: true },
        })
      ).id;

    servicio = await crearServicio(sede, 'Corte E308');
    servicioSinFlag = await crearServicio(sedeSinFlag, 'Corte E308 sin flag');

    // Horario de sede 00:00-23:59 todos los días (`diaSemana` 1=Lunes … 7=Domingo).
    const horarios = (barberiaId: string) =>
      Array.from({ length: 7 }, (_, diaSemana) => ({
        barberiaId,
        diaSemana: diaSemana + 1,
        horaInicio: new Date('1970-01-01T00:00:00.000Z'),
        horaFin: new Date('1970-01-01T23:59:00.000Z'),
      }));

    await prisma.horario.createMany({
      data: [...horarios(sede), ...horarios(sedeSinFlag)],
    });

    tokenAdminSede = await jwtService.signAsync({ sub: adminSede.id, correo: correos[1], roles: [] });
    tokenAdminAjena = await jwtService.signAsync({ sub: adminAjena.id, correo: correos[2], roles: [] });
    tokenCliente = await jwtService.signAsync({ sub: cliente.id, correo: correos[3], roles: [] });
    tokenCliente2 = await jwtService.signAsync({ sub: cliente2.id, correo: correos[4], roles: [] });
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 60_000);

  // ── Auxiliares ───────────────────────────────────────────────────────────

  function sumarMinutos(hhmm: string, minutos: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + minutos;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  /** Crea una solicitud MANUAL legítima y devuelve su id (asserta el 201). */
  async function crearPendiente(
    dia: number,
    horaInicio: string,
    token = tokenCliente,
    barberiaId = sede,
    servicioId = servicio,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fecha: fecha(dia),
        horaInicio,
        horaFin: sumarMinutos(horaInicio, 30),
        serviciosIds: [servicioId],
        precioTotalEsperado: 30,
        tipo: 'INDIVIDUAL',
      });

    expect(
      res.status,
      `crear solicitud ${fecha(dia)} ${horaInicio}: ${res.status} ${JSON.stringify(res.body)}`,
    ).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE');
    return res.body.id;
  }

  /** Crea y confirma: deja una CONFIRMADA ocupando su bloque. */
  async function crearConfirmada(
    dia: number,
    horaInicio: string,
    token = tokenCliente,
    barberiaId = sede,
    servicioId = servicio,
  ) {
    const reservaId = await crearPendiente(dia, horaInicio, token, barberiaId, servicioId);
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/aceptar`)
      .set('Authorization', `Bearer ${tokenAdminSede}`);
    expect(res.status, `aceptar ${reservaId}: ${JSON.stringify(res.body)}`).toBe(201);
    return reservaId;
  }

  const cancelacionEspecial = (
    reservaId: string,
    body: Record<string, unknown>,
    token: string,
    barberiaId = sede,
  ) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/cancelacion-especial`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const proponer = (
    reservaId: string,
    body: Record<string, unknown>,
    token: string,
    barberiaId = sede,
  ) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/proponer-horario`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const aceptarPropuesta = (reservaId: string, token: string, barberiaId = sede) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/propuesta-horario/aceptar`)
      .set('Authorization', `Bearer ${token}`);

  const rechazarPropuesta = (reservaId: string, token: string, barberiaId = sede) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/propuesta-horario/rechazar`)
      .set('Authorization', `Bearer ${token}`);

  const auditoriasDe = (reservaId: string, accion: string) =>
    prisma.auditoria.count({ where: { entidadId: reservaId, accion } });

  const leer = (reservaId: string) => prisma.reserva.findUnique({ where: { id: reservaId } });

  const propuestaDe = (reservaId: string) =>
    prisma.propuestaHorario.findFirst({
      where: { reservaId, estado: 'PENDIENTE' },
      orderBy: { creadoAt: 'desc' },
    });

  // ── Cancelación especial (D17) ───────────────────────────────────────────

  it('ROJO: sin la bandera D17 → 422 CANCELACION_ESPECIAL_NO_HABILITADA y la reserva no se toca', async () => {
    const reservaId = await crearConfirmada(2, '10:00', tokenCliente, sedeSinFlag, servicioSinFlag);

    const res = await cancelacionEspecial(
      reservaId,
      { motivoCodigo: 'EMERGENCIA' },
      tokenAdminSede,
      sedeSinFlag,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.codigo).toBe('CANCELACION_ESPECIAL_NO_HABILITADA');

    const enBd = await leer(reservaId);
    expect(enBd!.estado).toBe('CONFIRMADA');
    expect(await auditoriasDe(reservaId, 'RESERVA_CANCELACION_ESPECIAL')).toBe(0);
  });

  it('VERDE: con la bandera, la sede cancela con motivo: registra quién, libera el hueco y audita', async () => {
    const reservaId = await crearConfirmada(2, '12:00');

    const res = await cancelacionEspecial(
      reservaId,
      { motivoCodigo: 'EMERGENCIA' },
      tokenAdminSede,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('CANCELADA');

    const enBd = await leer(reservaId);
    expect(enBd!.estado).toBe('CANCELADA');
    expect(enBd!.cancelacionEspecialEstado).toBe('APROBADA');
    expect(enBd!.cancelacionEspecialMotivo).toBe('EMERGENCIA');
    expect(enBd!.canceladoPorId).toBeTruthy();
    expect(await auditoriasDe(reservaId, 'RESERVA_CANCELACION_ESPECIAL')).toBe(1);

    // El hueco se libera de verdad: otro cliente puede reservar ahí mismo.
    const libre = await crearPendiente(2, '12:00', tokenCliente2);
    expect(libre).toBeTruthy();
  });

  it('ROJO: motivo OTRO sin detalle → 400 y la reserva sigue viva', async () => {
    const reservaId = await crearConfirmada(2, '14:00');

    const res = await cancelacionEspecial(
      reservaId,
      { motivoCodigo: 'OTRO', motivoDetalle: 'no' },
      tokenAdminSede,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect((await leer(reservaId))!.estado).toBe('CONFIRMADA');
  });

  it('ROJO: un CLIENTE no puede ejecutar la cancelación especial (403 del guard)', async () => {
    const reservaId = await crearConfirmada(2, '15:00');

    const res = await cancelacionEspecial(
      reservaId,
      { motivoCodigo: 'ENFERMEDAD' },
      tokenCliente,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect((await leer(reservaId))!.estado).toBe('CONFIRMADA');
  });

  it('ROJO: un admin de otra sede recibe 403', async () => {
    const reservaId = await crearConfirmada(2, '16:00');

    const res = await cancelacionEspecial(
      reservaId,
      { motivoCodigo: 'CIERRE_IMPREVISTO' },
      tokenAdminAjena,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('ROJO: cancelación especial de una reserva ya cancelada → 409 ESTADO_INVALIDO', async () => {
    const reservaId = await crearConfirmada(2, '17:00');
    expect(
      (await cancelacionEspecial(reservaId, { motivoCodigo: 'FUERZA_MAYOR' }, tokenAdminSede))
        .status,
    ).toBe(201);

    const res = await cancelacionEspecial(
      reservaId,
      { motivoCodigo: 'FUERZA_MAYOR' },
      tokenAdminSede,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('ESTADO_INVALIDO');
  });

  // ── Propuesta de horario (D18 / §5.4) ────────────────────────────────────

  it('ROJO: el CLIENTE dueño propone un horario: ventana de 10 min, sin mover la cita ni ocupar el hueco', async () => {
    const reservaId = await crearConfirmada(3, '10:00');

    const res = await proponer(
      reservaId,
      { fecha: fecha(4), horaInicio: '11:00', horaFin: '11:30' },
      tokenCliente,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE');
    expect(res.body.tipo).toBe('REPROGRAMACION');

    const minutos = (new Date(res.body.expiraAt).getTime() - Date.now()) / 60000;
    expect(minutos).toBeGreaterThan(9);
    expect(minutos).toBeLessThanOrEqual(10);

    // La cita NO se movió: proponer no reprograma.
    const enBd = await leer(reservaId);
    expect(new Date(enBd!.fechaCita).toISOString().slice(0, 10)).toBe(fecha(3));
    expect(enBd!.horaInicio.getUTCHours()).toBe(10);
    expect(await auditoriasDe(reservaId, 'RESERVA_REPROGRAMADA')).toBe(0);

    // El hueco propuesto sigue libre: la propuesta NO ocupa agenda.
    const libre = await crearPendiente(4, '11:00', tokenCliente2);
    expect(libre).toBeTruthy();
  });

  it('ROJO: la sede acepta la propuesta y la cita se mueve, con auditoría', async () => {
    const reservaId = await crearConfirmada(3, '14:00');
    expect(
      (
        await proponer(
          reservaId,
          { fecha: fecha(4), horaInicio: '15:00', horaFin: '15:30' },
          tokenCliente,
        )
      ).status,
    ).toBe(201);

    const res = await aceptarPropuesta(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const enBd = await leer(reservaId);
    expect(new Date(enBd!.fechaCita).toISOString().slice(0, 10)).toBe(fecha(4));
    expect(enBd!.horaInicio.getUTCHours()).toBe(15);
    expect(enBd!.estado).toBe('CONFIRMADA');
    expect(await auditoriasDe(reservaId, 'RESERVA_REPROGRAMADA')).toBe(1);

    // La propuesta queda cerrada: ya no hay ninguna viva.
    expect(await propuestaDe(reservaId)).toBeNull();
  });

  it('ROJO: aceptar sin propuesta viva → 409 SIN_PROPUESTA', async () => {
    const reservaId = await crearConfirmada(3, '16:00');

    const res = await aceptarPropuesta(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('SIN_PROPUESTA');
  });

  it('ROJO: si el hueco se ocupa antes de aceptar → 409 CONFLICTO_HORARIO y la cita no se mueve', async () => {
    const reservaId = await crearConfirmada(5, '10:00');
    expect(
      (
        await proponer(
          reservaId,
          { fecha: fecha(5), horaInicio: '12:00', horaFin: '12:30' },
          tokenCliente,
        )
      ).status,
    ).toBe(201);

    // Otro cliente toma el hueco después de la propuesta.
    await crearConfirmada(5, '12:00', tokenCliente2);

    const res = await aceptarPropuesta(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('CONFLICTO_HORARIO');

    const enBd = await leer(reservaId);
    expect(enBd!.horaInicio.getUTCHours()).toBe(10);
    expect(await auditoriasDe(reservaId, 'RESERVA_REPROGRAMADA')).toBe(0);
  });

  it('ROJO: no se puede proponer dos veces mientras hay una viva → 409 PROPUESTA_PENDIENTE', async () => {
    const reservaId = await crearConfirmada(6, '10:00');
    expect(
      (
        await proponer(
          reservaId,
          { fecha: fecha(6), horaInicio: '11:00', horaFin: '11:30' },
          tokenCliente,
        )
      ).status,
    ).toBe(201);

    const res = await proponer(
      reservaId,
      { fecha: fecha(6), horaInicio: '13:00', horaFin: '13:30' },
      tokenCliente,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('PROPUESTA_PENDIENTE');
  });

  it('ROJO: una propuesta vencida no se puede aceptar → 409 PROPUESTA_EXPIRADA', async () => {
    const reservaId = await crearConfirmada(6, '15:00');
    expect(
      (
        await proponer(
          reservaId,
          { fecha: fecha(6), horaInicio: '16:00', horaFin: '16:30' },
          tokenCliente,
        )
      ).status,
    ).toBe(201);

    // La ventana venció: se fuerza el vencimiento en la base.
    await prisma.propuestaHorario.updateMany({
      where: { reservaId, estado: 'PENDIENTE' },
      data: { expiraAt: new Date(Date.now() - 60000) },
    });

    const res = await aceptarPropuesta(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('PROPUESTA_EXPIRADA');

    const enBd = await leer(reservaId);
    expect(enBd!.horaInicio.getUTCHours()).toBe(15);
  });

  it('ROJO: un CLIENTE ajeno no puede proponer sobre la reserva de otro → 403 RESERVA_AJENA', async () => {
    const reservaId = await crearConfirmada(7, '10:00');

    const res = await proponer(
      reservaId,
      { fecha: fecha(7), horaInicio: '11:00', horaFin: '11:30' },
      tokenCliente2,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.codigo).toBe('RESERVA_AJENA');
  });

  it('ROJO: la sede rechaza la propuesta sin mover la cita', async () => {
    const reservaId = await crearConfirmada(7, '13:00');
    expect(
      (
        await proponer(
          reservaId,
          { fecha: fecha(7), horaInicio: '14:00', horaFin: '14:30' },
          tokenCliente,
        )
      ).status,
    ).toBe(201);

    const res = await rechazarPropuesta(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('RECHAZADA');
    expect(await auditoriasDe(reservaId, 'RESERVA_PROPUESTA_RECHAZADA')).toBe(1);

    const enBd = await leer(reservaId);
    expect(enBd!.horaInicio.getUTCHours()).toBe(13);
    expect(enBd!.estado).toBe('CONFIRMADA');
  });

  it('ROJO: proponer un horario para una reserva terminal → 409 ESTADO_INVALIDO', async () => {
    const reservaId = await crearConfirmada(7, '16:00');
    expect(
      (await cancelacionEspecial(reservaId, { motivoCodigo: 'EMERGENCIA' }, tokenAdminSede)).status,
    ).toBe(201);

    const res = await proponer(
      reservaId,
      { fecha: fecha(7), horaInicio: '17:00', horaFin: '17:30' },
      tokenCliente,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('ESTADO_INVALIDO');
  });
});
