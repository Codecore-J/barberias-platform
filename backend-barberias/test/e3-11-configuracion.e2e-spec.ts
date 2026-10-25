import { Test, TestingModule } from '@nestjs/testing';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

const API = '/api/v1';

describe('E3-11 · configuración de la barbería', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let barberiaId: string;
  let adminId: string;
  let clienteId: string;
  let tokenAdmin: string;
  let tokenCliente: string;

  const sufijo = Date.now();
  const fechaReserva = new Date('2026-10-20T00:00:00.000Z');
  const horaInicio = new Date('1970-01-01T10:00:00.000Z');
  const horaFin = new Date('1970-01-01T10:30:00.000Z');

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

    const roles = await Promise.all([
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
        where: { nombre: 'CLIENTE' },
        update: {},
        create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
      }),
    ]);

    const [admin, cliente] = await Promise.all([
      prisma.usuario.create({
        data: {
          nombreCompleto: `Admin E311 ${sufijo}`,
          correo: `admin.e311.${sufijo}@test.com`,
          telefono: `9${String(sufijo).slice(-9)}`,
          passwordHash: '$2b$10$HashFalso',
        },
        select: { id: true },
      }),
      prisma.usuario.create({
        data: {
          nombreCompleto: `Cliente E311 ${sufijo}`,
          correo: `cliente.e311.${sufijo}@test.com`,
          telefono: `8${String(sufijo).slice(-9)}`,
          passwordHash: '$2b$10$HashFalso',
        },
        select: { id: true },
      }),
    ]);

    adminId = admin.id;
    clienteId = cliente.id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminId, rolId: roles[0].id, barberiaId: null },
        { usuarioId: clienteId, rolId: roles[2].id, barberiaId: null },
      ],
    });

    const barberia = await prisma.barberia.create({
      data: {
        nombre: `Barbería E311 ${sufijo}`,
        telefono: '9999999999',
        ubicacion: 'Ubicación E311',
        codigoAcceso: `E3${String(sufijo).slice(-4)}`,
        enlaceUnico: `e311-sede-${sufijo}`,
        responsableId: adminId,
      },
      select: { id: true },
    });

    barberiaId = barberia.id;

    await prisma.configuracionBarberia.upsert({
      where: { barberiaId },
      create: {
        barberiaId,
        modoReserva: 'MANUAL',
        aceptaIndividual: true,
        aceptaGrupal: true,
        maxPendientes: 3,
        horizonteReservaDias: 30,
        nuevasReservasActivas: true,
        margenGrupalMinutos: 10,
        permiteCancelacionEspecial: false,
        maxNinos: 10,
        maxPersonasTotal: 20,
      },
      update: {
        modoReserva: 'MANUAL',
        aceptaIndividual: true,
        aceptaGrupal: true,
        maxPendientes: 3,
        horizonteReservaDias: 30,
        nuevasReservasActivas: true,
        maxNinos: 10,
        maxPersonasTotal: 20,
        motivoPausa: null,
        pausaDesde: null,
        reactivacionProgramada: null,
      },
    });

    await prisma.usuarioRol.create({
      data: { usuarioId: adminId, rolId: roles[1].id, barberiaId },
    });

    tokenAdmin = await jwtService.signAsync({
      sub: adminId,
      correo: `admin.e311.${sufijo}@test.com`,
      roles: ['ADMINISTRADOR'],
    });

    tokenCliente = await jwtService.signAsync({
      sub: clienteId,
      correo: `cliente.e311.${sufijo}@test.com`,
      roles: ['CLIENTE'],
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.reserva.deleteMany({ where: { barberiaId } });
    await prisma.usuarioRol.deleteMany({
      where: { usuarioId: { in: [adminId, clienteId] } },
    });
    await prisma.configuracionBarberia.deleteMany({ where: { barberiaId } });
    await prisma.barberia.deleteMany({ where: { id: barberiaId } });
    await prisma.usuario.deleteMany({ where: { id: { in: [adminId, clienteId] } } });
    await app.close();
  }, 60_000);

  async function crearReserva(estado: 'PENDIENTE' | 'PROPUESTA_PENDIENTE') {
    return prisma.reserva.create({
      data: {
        barberiaId,
        clienteId,
        tipoReserva: 'INDIVIDUAL',
        estado,
        modoConfirmacion: 'MANUAL',
        fechaCita: fechaReserva,
        horaInicio,
        horaFin,
        totalPagar: 30,
        ...(estado === 'PENDIENTE'
          ? { expiraAt: new Date(Date.now() + 10 * 60 * 1000) }
          : {}),
      },
      select: { id: true },
    });
  }

  it('ADMINISTRADOR lee la configuración', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body).toMatchObject({
      barberiaId,
      modoReserva: 'MANUAL',
      aceptaIndividual: true,
      aceptaGrupal: true,
      maxPendientes: 3,
      maxNinos: 10,
      maxPersonasTotal: 20,
      nuevasReservasActivas: true,
    });
  });

  it('un CLIENTE no puede leer ni modificar la configuración (403)', async () => {
    await request(app.getHttpServer())
      .get(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenCliente}`)
      .send({ modoReserva: 'AUTOMATICO' })
      .expect(403);
  });

  it('ADMINISTRADOR actualiza un campo no sensible sin reservas en curso', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ horizonteReservaDias: 15 })
      .expect(200);

    expect(res.body.horizonteReservaDias).toBe(15);
  });

  it('409 CONFLICT CONFIG_CON_PENDIENTES con conteo al cambiar modoReserva con una reserva PENDIENTE', async () => {
    await crearReserva('PENDIENTE');

    const res = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ modoReserva: 'AUTOMATICO' })
      .expect(409);

    expect(res.body).toMatchObject({
      statusCode: 409,
      codigo: 'CONFIG_CON_PENDIENTES',
      conteo: 1,
    });
    expect(res.body.mensaje).toContain('1 reserva(s) pendiente(s)');
  });

  it('409 CONFLICT CONFIG_CON_PENDIENTES con conteo al cambiar aceptaIndividual con dos reservas en curso', async () => {
    await crearReserva('PROPUESTA_PENDIENTE');

    const res = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ aceptaIndividual: false })
      .expect(409);

    expect(res.body).toMatchObject({
      statusCode: 409,
      codigo: 'CONFIG_CON_PENDIENTES',
      conteo: 2,
    });
  });

  it('409 CONFLICT CONFIG_CON_PENDIENTES con conteo al cambiar aceptaGrupal y maxPendientes', async () => {
    const porGrupal = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ aceptaGrupal: false })
      .expect(409);

    expect(porGrupal.body).toMatchObject({
      codigo: 'CONFIG_CON_PENDIENTES',
      conteo: 2,
    });

    const porMax = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ maxPendientes: 5 })
      .expect(409);

    expect(porMax.body).toMatchObject({
      codigo: 'CONFIG_CON_PENDIENTES',
      conteo: 2,
    });
  });

  it('permite cambiar campos no bloqueados aunque haya reservas en curso', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ margenGrupalMinutos: 15 })
      .expect(200);

    expect(res.body.margenGrupalMinutos).toBe(15);

    await prisma.reserva.deleteMany({ where: { barberiaId } });
  });

  it('422 VALIDACION si max_personas_total < max_ninos + 1', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ maxNinos: 5, maxPersonasTotal: 5 })
      .expect(422);

    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'VALIDACION' });
  });

  it('422 VALIDACION estricta al enviar solo maxPersonasTotal frente al max_ninos persistido', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ maxPersonasTotal: 5 })
      .expect(422);

    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'VALIDACION' });
  });

  it('acepta max_personas_total = max_ninos + 1', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ maxNinos: 5, maxPersonasTotal: 6 })
      .expect(200);

    expect(res.body.maxNinos).toBe(5);
    expect(res.body.maxPersonasTotal).toBe(6);
  });

  it('la pausa guarda motivo y pausa_desde, y la reactivación los limpia', async () => {
    const pausada = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nuevasReservasActivas: false, motivoPausa: 'Mantenimiento de cabinas' })
      .expect(200);

    expect(pausada.body.nuevasReservasActivas).toBe(false);
    expect(pausada.body.motivoPausa).toBe('Mantenimiento de cabinas');
    expect(pausada.body.pausaDesde).not.toBeNull();

    const reactivada = await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nuevasReservasActivas: true })
      .expect(200);

    expect(reactivada.body.nuevasReservasActivas).toBe(true);
    expect(reactivada.body.motivoPausa).toBeNull();
    expect(reactivada.body.pausaDesde).toBeNull();
  });

  it('la pausa es visible para el resto de la lectura de configuración', async () => {
    await request(app.getHttpServer())
      .patch(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nuevasReservasActivas: false, motivoPausa: 'Pausa visible' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`${API}/shops/${barberiaId}/settings`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body.nuevasReservasActivas).toBe(false);
    expect(res.body.motivoPausa).toBe('Pausa visible');

    // Reactivar para no contaminar el resto de la suite.
    await prisma.configuracionBarberia.update({
      where: { barberiaId },
      data: {
        nuevasReservasActivas: true,
        motivoPausa: null,
        pausaDesde: null,
        reactivacionProgramada: null,
      },
    });
  });
});
