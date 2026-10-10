/**
 * E3-06 · Reprogramación de reservas  +  E3-07 · Reglas de cancelación del cliente.
 *
 * Solo con APP_ENV=dev.
 *
 * Pedidos de la tarea:
 *   1. E3-07: si quien cancela es el CLIENTE y faltan menos de 30 minutos para el
 *      inicio de la cita, responde 422 `FUERA_DE_VENTANA`.
 *   2. E3-06: `PATCH /barberias/:barberiaId/reservas/:id/reprogramar` valida el
 *      horario nuevo (horizonte, configuración y disponibilidad), libera el bloque
 *      actual, toma el nuevo y audita, todo bajo el `FOR UPDATE` de la sede.
 *   3. Los tres escenarios que pidió el dueño: colisión de reprogramación,
 *      reprogramación exitosa y la barrera de los 30 minutos.
 *
 * El arnés usa el MISMO pipe y filtro que `main.ts`, así que los códigos de estado
 * que se miden aquí son los de producción.
 *
 * NOTA DE EJECUCIÓN: necesita Redis (el módulo de reservas registra la cola real)
 * y una base de datos alcanzable. En una máquina de desarrollo sin Redis este
 * fichero no se puede ejecutar; la evidencia local es la suite unitaria
 * (`reserva.service.spec.ts`, describes E3-06 y E3-07) y la matriz de permisos.
 *
 * Las tres primeras pruebas fijan las convenciones de fecha/hora que usa la base
 * (`fecha_cita` es `DATE` —medianoche UTC del día— y `hora_inicio`/`hora_fin` son
 * `TIME` —el `Date` lleva la hora etiquetada en sus partes UTC, como la escribe
 * `parseTime`—).
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

/** Hora etiquetada en las partes UTC, igual que la escribe `parseTime`. */
function hora(h: number, m: number): Date {
  const d = new Date('1970-01-01T00:00:00Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

describe('E3-06/E3-07 · reprogramación y reglas de cancelación del cliente', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const api = '/api/v1';
  const correos = [
    'duenio.e3067@test.com',
    'adminsede.e3067@test.com',
    'adminajena.e3067@test.com',
    'cliente.e3067@test.com',
    'cliente2.e3067@test.com',
  ];

  let sede: string;
  let sedeAjena: string;
  let servicio: string;
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
        OR: [{ codigoAcceso: { startsWith: 'E3067' } }, { responsableId: { in: idsUsuario } }],
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
            nombreCompleto: `E3067 ${i}`,
            correo,
            telefono: `9997${String(i).padStart(7, '0')}`,
            passwordHash: '$2b$10$HashFalsoE3067NoSeUsaParaLogin',
          },
          select: { id: true },
        }),
      ),
    );

    sede = (
      await prisma.barberia.create({
        data: {
          nombre: 'Sede E3067',
          telefono: '9997111111',
          ubicacion: 'Sede E3067',
          codigoAcceso: 'E3067A',
          enlaceUnico: 'https://e3067.test',
          responsableId: duenio.id,
        },
        select: { id: true },
      })
    ).id;

    sedeAjena = (
      await prisma.barberia.create({
        data: {
          nombre: 'Sede E3067 ajena',
          telefono: '9997222222',
          ubicacion: 'Sede E3067 ajena',
          codigoAcceso: 'E3067B',
          enlaceUnico: 'https://e3067-ajena.test',
          responsableId: duenio.id,
        },
        select: { id: true },
      })
    ).id;

    // modo_reserva default = MANUAL: la reserva nace PENDIENTE y se acepta por API.
    await prisma.configuracionBarberia.create({ data: { barberiaId: sede } });
    await prisma.configuracionBarberia.create({ data: { barberiaId: sedeAjena } });

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminSede.id, rolId: roles['ADMIN_BARBERIA'], barberiaId: sede },
        { usuarioId: adminAjena.id, rolId: roles['ADMIN_BARBERIA'], barberiaId: sedeAjena },
        { usuarioId: cliente.id, rolId: roles['CLIENTE'], barberiaId: null },
        { usuarioId: cliente2.id, rolId: roles['CLIENTE'], barberiaId: null },
      ],
    });

    await prisma.clienteBarberia.create({
      data: { usuarioId: cliente.id, barberiaId: sede, estadoVinculacion: 'ACTIVO' },
    });
    await prisma.clienteBarberia.create({
      data: { usuarioId: cliente2.id, barberiaId: sede, estadoVinculacion: 'ACTIVO' },
    });

    servicio = (
      await prisma.servicio.create({
        data: {
          barberiaId: sede,
          nombre: 'Corte E3067',
          precio: 30,
          duracionEstimada: 30,
          margenOperativo: 0,
        },
        select: { id: true },
      })
    ).id;

    // Horario de sede 00:00-23:59 todos los días (`diaSemana` 1=Lunes … 7=Domingo).
    await prisma.horario.createMany({
      data: Array.from({ length: 7 }, (_, diaSemana) => ({
        barberiaId: sede,
        diaSemana: diaSemana + 1,
        horaInicio: new Date('1970-01-01T00:00:00.000Z'),
        horaFin: new Date('1970-01-01T23:59:00.000Z'),
      })),
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

  /** Crea una solicitud MANUAL legítima y devuelve su id (asserta el 201). */
  async function crearPendiente(
    dia: number,
    horaInicio: string,
    token = tokenCliente,
  ): Promise<string> {
    const horaFin = sumarMinutos(horaInicio, 30);

    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${sede}/reservas`)
      .set('Authorization', `Bearer ${token}`)
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
      `crear solicitud ${fecha(dia)} ${horaInicio}: ${res.status} ${JSON.stringify(res.body)}`,
    ).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE');
    return res.body.id;
  }

  /** Crea y confirma: deja una CONFIRMADA ocupando su bloque. */
  async function crearConfirmada(dia: number, horaInicio: string, token = tokenCliente) {
    const reservaId = await crearPendiente(dia, horaInicio, token);
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${sede}/reservas/${reservaId}/aceptar`)
      .set('Authorization', `Bearer ${tokenAdminSede}`);
    expect(res.status, `aceptar ${reservaId}: ${JSON.stringify(res.body)}`).toBe(201);
    return reservaId;
  }

  function sumarMinutos(hhmm: string, minutos: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + minutos;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  const reprogramar = (
    reservaId: string,
    body: Record<string, unknown>,
    token: string,
    barberiaId = sede,
  ) =>
    request(app.getHttpServer())
      .patch(`${api}/barberias/${barberiaId}/reservas/${reservaId}/reprogramar`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const cancelar = (reservaId: string, token: string, barberiaId = sede) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/cancelar`)
      .set('Authorization', `Bearer ${token}`);

  /**
   * Coloca la cita a `minutos` del reloj real escribiendo en la base, para probar
   * los límites 29/31 sin esperar. Se escriben las MISMAS convenciones que usa la
   * API: `fecha_cita` = medianoche UTC del día etiquetado y `hora_inicio`/`hora_fin`
   * = la hora etiquetada en las partes UTC.
   */
  async function colocarCita(reservaId: string, minutos: number) {
    const objetivo = new Date(Date.now() + minutos * 60000);
    const dia = new Date(
      Date.UTC(objetivo.getFullYear(), objetivo.getMonth(), objetivo.getDate()),
    );
    const fin = new Date(objetivo.getTime() + 30 * 60000);

    await prisma.reserva.update({
      where: { id: reservaId },
      data: {
        fechaCita: dia,
        horaInicio: hora(objetivo.getHours(), objetivo.getMinutes()),
        horaFin: hora(fin.getHours(), fin.getMinutes()),
      },
    });
  }

  const auditoriasDe = (reservaId: string, accion: string) =>
    prisma.auditoria.count({ where: { entidadId: reservaId, accion } });

  const leer = (reservaId: string) =>
    prisma.reserva.findUnique({ where: { id: reservaId } });

  // ── E3-06 · reprogramación ───────────────────────────────────────────────

  it('VERDE: el admin de la sede mueve la cita, audita el cambio y libera el bloque viejo', async () => {
    const reservaId = await crearConfirmada(2, '10:00');

    const res = await reprogramar(
      reservaId,
      { fecha: fecha(3), horaInicio: '11:00', horaFin: '11:30' },
      tokenAdminSede,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const enBd = await leer(reservaId);
    expect(new Date(enBd!.fechaCita).toISOString().slice(0, 10)).toBe(fecha(3));
    expect(enBd!.horaInicio.getUTCHours()).toBe(11);
    expect(enBd!.horaInicio.getUTCMinutes()).toBe(0);
    // Reprogramar NO toca el estado ni los snapshots financieros.
    expect(enBd!.estado).toBe('CONFIRMADA');
    expect(Number(enBd!.totalPagar)).toBe(30);
    expect(await auditoriasDe(reservaId, 'RESERVA_REPROGRAMADA')).toBe(1);

    // El bloque viejo queda libre para cualquiera (el horario se libera de verdad).
    const libre = await crearPendiente(2, '10:00', tokenCliente2);
    expect(libre).toBeTruthy();
  });

  it('ROJO: chocar con otro bloque ocupado → 409 CONFLICTO_HORARIO y la cita no se mueve', async () => {
    const reservaId = await crearConfirmada(4, '10:00');
    await crearConfirmada(4, '12:00', tokenCliente2);

    const res = await reprogramar(
      reservaId,
      { fecha: fecha(4), horaInicio: '12:00', horaFin: '12:30' },
      tokenAdminSede,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('CONFLICTO_HORARIO');

    const enBd = await leer(reservaId);
    expect(enBd!.horaInicio.getUTCHours()).toBe(10);
    expect(await auditoriasDe(reservaId, 'RESERVA_REPROGRAMADA')).toBe(0);
  });

  it('ROJO: un admin de otra sede no puede reprogramar (403 del guard)', async () => {
    const reservaId = await crearConfirmada(5, '09:00');

    const res = await reprogramar(
      reservaId,
      { fecha: fecha(5), horaInicio: '10:00', horaFin: '10:30' },
      tokenAdminAjena,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('ROJO: un CLIENTE no reprograma por su cuenta (403 del guard)', async () => {
    const reservaId = await crearConfirmada(6, '09:00');

    const res = await reprogramar(
      reservaId,
      { fecha: fecha(6), horaInicio: '10:00', horaFin: '10:30' },
      tokenCliente,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('ROJO: reprogramar una reserva ya cancelada → 409 ESTADO_INVALIDO', async () => {
    const reservaId = await crearConfirmada(7, '09:00');
    expect((await cancelar(reservaId, tokenAdminSede)).status).toBe(201);

    const res = await reprogramar(
      reservaId,
      { fecha: fecha(7), horaInicio: '10:00', horaFin: '10:30' },
      tokenAdminSede,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('ESTADO_INVALIDO');
  });

  // ── E3-07 · ventana de cancelación del CLIENTE ───────────────────────────

  it('ROJO: a 29 minutos del inicio el CLIENTE recibe 422 FUERA_DE_VENTANA', async () => {
    const reservaId = await crearConfirmada(8, '10:00');
    await colocarCita(reservaId, 29);

    const res = await cancelar(reservaId, tokenCliente);

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.codigo).toBe('FUERA_DE_VENTANA');

    const enBd = await leer(reservaId);
    expect(enBd!.estado).toBe('CONFIRMADA');
    expect(await auditoriasDe(reservaId, 'RESERVA_CANCELADA')).toBe(0);
  });

  it('VERDE: a 31 minutos del inicio el CLIENTE sí cancela', async () => {
    const reservaId = await crearConfirmada(8, '14:00');
    await colocarCita(reservaId, 31);

    const res = await cancelar(reservaId, tokenCliente);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('CANCELADA');

    const enBd = await leer(reservaId);
    expect(enBd!.estado).toBe('CANCELADA');
    expect(await auditoriasDe(reservaId, 'RESERVA_CANCELADA')).toBe(1);
  });

  it('VERDE: el STAFF no tiene ventana — cancela a 5 minutos del inicio', async () => {
    const reservaId = await crearConfirmada(8, '16:00');
    await colocarCita(reservaId, 5);

    const res = await cancelar(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('CANCELADA');
  });

  it('VERDE: una solicitud PENDIENTE se cancela siempre, aunque falten 5 minutos', async () => {
    const reservaId = await crearPendiente(8, '18:00');
    await colocarCita(reservaId, 5);

    const res = await cancelar(reservaId, tokenCliente);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('CANCELADA');
  });
});
