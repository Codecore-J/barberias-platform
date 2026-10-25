import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2-07 · P-SD-3 y P-SD-4 · la sede suspendida deja de vender.
 *
 * `PATCH /barberias/:id/estado` existía desde E2-07 y funcionaba, pero su
 * efecto era cosmético: una sede en `INACTIVO` seguía creando reservas y
 * devolviendo huecos (hemorragia operativa del PLAN_MIGRACION_SOFT_DELETE §4).
 * Esta suite mide, sobre HTTP real y base real, que el cambio de estado ahora:
 *
 *  1. BLOQUEA el alta de reserva → 422 `SEDE_INACTIVA` (D40), y la vuelve a
 *     permitir al reactivar: el bloqueo depende del estado, no es definitivo.
 *  2. BLOQUEA la disponibilidad y los huecos → 422 `SEDE_INACTIVA` (una sede
 *     suspendida tampoco expone su agenda).
 *  3. DEJA RASTRO en `auditoria`: `BARBERIA_SUSPENDIDA` / `BARBERIA_REACTIVADA`
 *     con el estado anterior y el nuevo, en la misma transacción del cambio.
 *  4. El CHECK de la base rechaza un estado de catálogo fuera de catálogo
 *     (`servicios_estado_check` / `combos_estado_check`, la migración
 *     `20261014000000_e207_catalogo_estado_check`), y la API responde 400 antes
 *     de llegar a la base.
 *
 * Las reservas YA creadas siguen siendo operables por el staff mientras la
 * sede está suspendida —decisión tomada al ejecutar P-SD-4—: suspender corta
 * la demanda nueva, no deja huérfanas a la que ya existe.
 */

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

describe('E2-07 · P-SD-3/P-SD-4 · sede suspendida: no reserva, no expone agenda, audita', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const tokens: Record<string, string> = {};
  const datos: Record<string, string> = {};
  const correos: Record<string, string> = {};

  const headers = (rol: string, barberiaId?: string) => {
    const h: Record<string, string> = { Authorization: `Bearer ${tokens[rol]}` };
    if (barberiaId) h['x-barberia-id'] = barberiaId;
    return h;
  };

  const registrarYLogin = async (rol: string, correo: string, telefono: string) => {
    const r = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({ nombreCompleto: correo, correo, telefono, password: 'Password1!' });
    expect([200, 201, 409]).toContain(r.status);

    const l = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password: 'Password1!' });
    expect(l.status).toBe(200);
    tokens[rol] = l.body.accessToken;
    correos[rol] = correo;
  };

  /** Payload de reserva del cliente (mismo esquema que el wizard, E3-03/2). */
  function payloadReserva(horaInicio: string, horaFin: string) {
    return {
      fecha: datos.fecha,
      horaInicio,
      horaFin,
      serviciosIds: [datos.servicio],
      precioTotalEsperado: 10,
      tipo: 'INDIVIDUAL',
    };
  }

  const cambiarEstado = (estado: string) =>
    request(app.getHttpServer())
      .patch(`${api}/shops/${datos.sede}/status`)
      .set(headers('global'))
      .send({ estado });

  const altaDeReserva = (horaInicio: string, horaFin: string) =>
    request(app.getHttpServer())
      .post(`${api}/shops/${datos.sede}/appointments`)
      .set(headers('cliente', datos.sede))
      .send(payloadReserva(horaInicio, horaFin));

  const disponibilidad = () =>
    request(app.getHttpServer())
      .get(`${api}/shops/${datos.sede}/appointments/schedule/availability?fecha=${datos.fecha}&duracionMinutos=30`)
      .set(headers('cliente', datos.sede));

  const huecos = () =>
    request(app.getHttpServer())
      .get(`${api}/shops/${datos.sede}/appointments/schedule/slots?fecha=${datos.fecha}&duracionMinutos=30`)
      .set(headers('cliente', datos.sede));

  const eventosDeEstado = (accion: string) =>
    prisma.auditoria.findMany({
      where: { accion, entidad: 'barberias', entidadId: datos.sede },
      orderBy: { creadoAt: 'desc' },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    // Sufijo único: la base de `dev` es compartida entre corridas y archivos.
    const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    datos.fecha = fecha(2);

    // Teléfonos de 10 dígitos exactos: `RegisterDto` los valida.
    const serie = String(Math.floor(Math.random() * 9000) + 1000);
    const tel = (n: number) => `809${serie}${String(n).padStart(3, '0')}`;

    await registrarYLogin('admin', `admin.psd34-${sufijo}@test.com`, tel(1));
    await registrarYLogin('cliente', `cliente.psd34-${sufijo}@test.com`, tel(2));
    await registrarYLogin('global', `global.psd34-${sufijo}@test.com`, tel(3));
    await registrarYLogin('barbero', `barbero.psd34-${sufijo}@test.com`, tel(4));

    const admin = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.admin }, select: { id: true } });
    const cliente = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.cliente }, select: { id: true } });
    const global = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.global }, select: { id: true } });
    const barbero = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.barbero }, select: { id: true } });

    const sede = await prisma.barberia.create({
      data: {
        nombre: `Sede PSD34-${sufijo}`,
        telefono: `703${sufijo.slice(-6).padEnd(6, '0')}01`,
        ubicacion: 'Sede P-SD-3',
        estado: 'ACTIVO',
        codigoAcceso: `PSD34-${sufijo}`,
        enlaceUnico: `https://psd34-${sufijo}.test`,
        responsableId: admin.id,
      },
    });
    datos.sede = sede.id;

    await prisma.configuracionBarberia.create({
      data: {
        barberiaId: sede.id,
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
        aceptaGrupal: false,
        horizonteReservaDias: 30,
        margenGrupalMinutos: 0,
        oportunidadesEspacioActivas: true,
      },
    });

    // Los roles se UPSERTAN, no se leen: en una base nueva solo están los del
    // seed (CLIENTE, BARBERO, ADMINISTRADOR) y esta suite tiene que poder
    // correr sin depender de que otra corrida los haya dejado.
    const upsertRol = (nombre: string, ambito: string) =>
      prisma.rol.upsert({
        where: { nombre },
        update: {},
        create: { nombre, ambito },
        select: { id: true },
      });

    const rolAdmin = await upsertRol('ADMIN_BARBERIA', 'BARBERIA');
    const rolCliente = await upsertRol('CLIENTE', 'GLOBAL');
    const rolGlobal = await upsertRol('ADMINISTRADOR', 'GLOBAL');
    const rolBarbero = await upsertRol('BARBERO', 'BARBERIA');

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: admin.id, rolId: rolAdmin.id, barberiaId: sede.id },
        { usuarioId: cliente.id, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: global.id, rolId: rolGlobal.id, barberiaId: null },
        // D16 corregido: el barbero es quien escribe el catálogo.
        { usuarioId: barbero.id, rolId: rolBarbero.id, barberiaId: sede.id },
      ],
      skipDuplicates: true,
    });

    await prisma.clienteBarberia.create({
      data: { usuarioId: cliente.id, barberiaId: sede.id, estadoVinculacion: 'ACTIVO' },
    });

    // Jornada 00:00-23:59 los 7 días: cualquier hora cuadra (patrón E3-03).
    await prisma.horario.createMany({
      data: Array.from({ length: 7 }, (_, dia) => ({
        barberiaId: sede.id,
        diaSemana: dia + 1,
        horaInicio: new Date('1970-01-01T00:00:00.000Z'),
        horaFin: new Date('1970-01-01T23:59:00.000Z'),
      })),
    });

    datos.servicio = (
      await prisma.servicio.create({
        data: {
          barberiaId: sede.id,
          nombre: `Corte PSD34-${sufijo}`,
          precio: 10,
          duracionEstimada: 30,
          margenOperativo: 0,
          estado: 'ACTIVO',
        },
      })
    ).id;

    datos.combo = (
      await prisma.combo.create({
        data: {
          barberiaId: sede.id,
          nombre: `Combo PSD34-${sufijo}`,
          precioEspecial: 15,
          duracionPropia: 30,
          margenPropio: 0,
          estado: 'ACTIVO',
          comboItemsAsParent: { create: [{ servicioId: datos.servicio }] },
        },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    const sede = datos.sede;
    const reservas = await prisma.reserva.findMany({ where: { barberiaId: sede }, select: { id: true } });
    const idsReserva = reservas.map((r) => r.id);
    await prisma.pago.deleteMany({ where: { reservaId: { in: idsReserva } } });
    await prisma.participanteServicio.deleteMany({
      where: { participante: { reservaId: { in: idsReserva } } },
    });
    await prisma.participanteReserva.deleteMany({ where: { reservaId: { in: idsReserva } } });
    await prisma.reserva.deleteMany({ where: { id: { in: idsReserva } } });
    await prisma.auditoria.deleteMany({ where: { entidadId: sede } });
    await prisma.combo.deleteMany({ where: { barberiaId: sede } });
    await prisma.servicio.deleteMany({ where: { barberiaId: sede } });
    await prisma.horario.deleteMany({ where: { barberiaId: sede } });
    await prisma.configuracionBarberia.deleteMany({ where: { barberiaId: sede } });
    await prisma.clienteBarberia.deleteMany({ where: { barberiaId: sede } });
    await prisma.usuarioRol.deleteMany({ where: { barberiaId: sede } });
    await prisma.barberia.deleteMany({ where: { id: sede } });
    await prisma.usuario.deleteMany({
      where: { correo: { in: Object.values(correos) } },
    });
    await app.close();
  }, 60_000);

  it('control: con la sede ACTIVO el cliente reserva y lee disponibilidad (201 y 200)', async () => {
    const reserva = await altaDeReserva('09:00', '09:30');
    expect([200, 201], `POST /reservas → ${reserva.status} ${JSON.stringify(reserva.body)}`).toContain(reserva.status);

    const disp = await disponibilidad();
    expect(disp.status).toBe(200);
    expect(Array.isArray(disp.body)).toBe(true);

    const h = await huecos();
    expect(h.status).toBe(200);
  });

  it('suspender la sede deja BARBERIA_SUSPENDIDA con anterior y nuevo en auditoría', async () => {
    const res = await cambiarEstado('INACTIVO');

    expect(res.status, `PATCH /estado → ${res.status} ${JSON.stringify(res.body)}`).toBe(200);

    const enBd = await prisma.barberia.findUniqueOrThrow({ where: { id: datos.sede }, select: { estado: true } });
    expect(enBd.estado).toBe('INACTIVO');

    const eventos = await eventosDeEstado('BARBERIA_SUSPENDIDA');
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos[0].usuarioId).not.toBeNull();
    expect(eventos[0].contexto).toMatchObject({
      anterior: { estado: 'ACTIVO' },
      nuevo: { estado: 'INACTIVO' },
    });
  });

  it('la sede suspendida NO crea reservas: 422 SEDE_INACTIVA', async () => {
    const res = await altaDeReserva('10:00', '10:30');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'SEDE_INACTIVA' });

    // Nada se escribió: la suspensión corta la demanda nueva sin tocar datos.
    const creadas = await prisma.reserva.count({
      where: { barberiaId: datos.sede, fechaCita: new Date(`${datos.fecha}T00:00:00.000Z`), horaInicio: new Date('1970-01-01T10:00:00.000Z') },
    });
    expect(creadas).toBe(0);
  });

  it('la sede suspendida NO expone disponibilidad: 422 SEDE_INACTIVA', async () => {
    const res = await disponibilidad();

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'SEDE_INACTIVA' });
  });

  it('tampoco ofrece huecos por el carril proactivo: 422, nunca []', async () => {
    const res = await huecos();

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'SEDE_INACTIVA' });
  });

  it('reactivar vuelve a la normalidad y audita BARBERIA_REACTIVADA', async () => {
    const res = await cambiarEstado('ACTIVO');
    expect(res.status).toBe(200);

    const enBd = await prisma.barberia.findUniqueOrThrow({ where: { id: datos.sede }, select: { estado: true } });
    expect(enBd.estado).toBe('ACTIVO');

    const eventos = await eventosDeEstado('BARBERIA_REACTIVADA');
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos[0].contexto).toMatchObject({
      anterior: { estado: 'INACTIVO' },
      nuevo: { estado: 'ACTIVO' },
    });

    const disp = await disponibilidad();
    expect(disp.status).toBe(200);

    const reserva = await altaDeReserva('11:00', '11:30');
    expect([200, 201], `POST /reservas tras reactivar → ${reserva.status} ${JSON.stringify(reserva.body)}`).toContain(
      reserva.status,
    );
  });

  it('idempotente: pedir el estado que ya tiene no escribe ni audita', async () => {
    const antes = await prisma.auditoria.count({
      where: { entidad: 'barberias', entidadId: datos.sede },
    });

    const res = await cambiarEstado('ACTIVO');
    expect(res.status).toBe(200);

    const despues = await prisma.auditoria.count({
      where: { entidad: 'barberias', entidadId: datos.sede },
    });
    expect(despues).toBe(antes);
  });

  it('el CHECK de la base rechaza un estado de catálogo fuera de catálogo', async () => {
    // El nombre que aparece en el error es el de la restricción que declaró la
    // migración: el fallo viene de Postgres, no de una validación de la app.
    await expect(
      prisma.servicio.update({ where: { id: datos.servicio }, data: { estado: 'BORRADO' as never } }),
    ).rejects.toThrow(/servicios_estado_check/);

    await expect(
      prisma.combo.update({ where: { id: datos.combo }, data: { estado: 'BORRADO' as never } }),
    ).rejects.toThrow(/combos_estado_check/);

    // Y el control positivo: el valor en catálogo sí pasa.
    await expect(
      prisma.servicio.update({ where: { id: datos.servicio }, data: { estado: 'INACTIVO' } }),
    ).resolves.toMatchObject({ estado: 'INACTIVO' });
    await prisma.servicio.update({ where: { id: datos.servicio }, data: { estado: 'ACTIVO' } });
  });

  it('la API responde 400 antes que 500 si alguien manda un estado fuera de catálogo', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${api}/shops/${datos.sede}/services/${datos.servicio}`)
      .set(headers('barbero', datos.sede))
      .send({ estado: 'BORRADO' });

    expect(res.status, `PATCH /shops/${datos.sede}/services → ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
  });
});
