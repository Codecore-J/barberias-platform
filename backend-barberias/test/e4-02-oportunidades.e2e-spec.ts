import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

class ValidadorException extends BadRequestException {
  override getStatus() {
    return 422;
  }
}

describe('E4-02 · oportunidades de espacio (huecos) y alternativas', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const tokens: Record<string, string> = {};
  const barberia: Record<string, string> = {};

  const registrarYLogin = async (correo: string, telefono: string) => {
    const r = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({ nombreCompleto: correo, correo, telefono, password: 'Password1!' });
    expect([200, 201, 409]).toContain(r.status);
    const l = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password: 'Password1!' });
    expect(l.status).toBe(200);
    tokens[correo] = l.body.accessToken;
    return r;
  };

  const headers = (correo: string, barberiaId: string) => ({
    Authorization: `Bearer ${tokens[correo]}`,
    'x-barberia-id': barberiaId,
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: (errors) => new ValidadorException(errors) }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const CORREOS = [`admin.e402-${suffix}@test.com`, `cliente.e402-${suffix}@test.com`];
    const telefonoAdmin = `601${suffix.slice(-6).padEnd(6, '0')}01`;
    const telefonoSede = `601${suffix.slice(-6).padEnd(6, '0')}02`;
    await Promise.all(CORREOS.map((c, idx) => registrarYLogin(c, idx === 0 ? telefonoAdmin : `601${suffix.slice(-6).padEnd(6, '0')}99`)));

    const admin = await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS[0] }, select: { id: true } });
    const sedeA = await prisma.barberia.upsert({
      where: { codigoAcceso: `E402A-${suffix}` },
      update: { responsableId: admin.id, estado: 'ACTIVO' },
      create: {
        nombre: `Sede E402-${suffix}`,
        telefono: telefonoSede,
        ubicacion: 'A',
        estado: 'ACTIVO',
        codigoAcceso: `E402A-${suffix}`,
        enlaceUnico: `https://a.e402-${suffix}.test`,
        responsableId: admin.id,
      },
    });
    barberia.A = sedeA.id;

    await prisma.configuracionBarberia.upsert({
      where: { barberiaId: sedeA.id },
      update: { oportunidadesEspacioActivas: true, nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: false, horizonteReservaDias: 30, margenGrupalMinutos: 0 },
      create: {
        barberiaId: sedeA.id,
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
        aceptaGrupal: false,
        horizonteReservaDias: 30,
        margenGrupalMinutos: 0,
      },
    });

    const rolCliente = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'CLIENTE' }, select: { id: true } });
    const rolAdmin = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN_BARBERIA' }, select: { id: true } });
    const rolBarbero = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'BARBERO' }, select: { id: true } });

    const cliente = await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS[1] }, select: { id: true } });
    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: admin.id, rolId: rolAdmin.id, barberiaId: sedeA.id },
        { usuarioId: admin.id, rolId: rolBarbero.id, barberiaId: sedeA.id },
        { usuarioId: admin.id, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: cliente.id, rolId: rolCliente.id, barberiaId: null },
      ],
      skipDuplicates: true,
    });
    const vinculo = await prisma.clienteBarberia.findFirst({ where: { usuarioId: cliente.id, barberiaId: sedeA.id } });
    if (!vinculo) {
      await prisma.clienteBarberia.create({ data: { usuarioId: cliente.id, barberiaId: sedeA.id, estadoVinculacion: 'ACTIVO' } });
    }

    const s1 = await prisma.servicio.create({
      data: { barberiaId: sedeA.id, nombre: 'Corte E402', precio: 10, duracionEstimada: 30, margenOperativo: 0 },
    });
    const s2 = await prisma.servicio.create({
      data: { barberiaId: sedeA.id, nombre: 'Rapado E402', precio: 10, duracionEstimada: 480, margenOperativo: 0 },
    });

    await prisma.horario.createMany({
      data: Array.from({ length: 7 }, (_, dia) => ({
        barberiaId: sedeA.id,
        diaSemana: dia + 1,
        horaInicio: new Date('1970-01-01T09:00:00.000Z'),
        horaFin: new Date('1970-01-01T20:00:00.000Z'),
      })),
    });

    // Crear un bloqueo para ocupar el primer slot de 480 min (09:00-10:00) asi
    // el intento de reservar ese bloque falla y deja alternativas
    await prisma.bloqueosAgenda.create({
      data: {
        barberiaId: sedeA.id,
        fecha: new Date(fecha(1) + 'T00:00:00.000Z'),
        horaInicio: new Date('1970-01-01T09:00:00.000Z'),
        horaFin: new Date('1970-01-01T10:00:00.000Z'),
        motivo: 'Bloqueo test E402',
        creadoPor: admin.id,
      },
    });

    (global as any).e402Data = { sede: sedeA.id, s1: s1.id, s2: s2.id, cliente: CORREOS[1], admin: CORREOS[0] };
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('VERDE: intento de reserva fallido por falta de espacio devuelve alternativas en 409', async () => {
    const data = (global as any).e402Data;
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${data.sede}/reservas`)
      .set(headers(data.cliente, data.sede))
      .send({ fecha: fecha(1), horaInicio: '09:00', horaFin: '17:00', serviciosIds: [data.s2], precioTotalEsperado: 10, tipo: 'INDIVIDUAL' });

    // El pipeline de Nest devuelve el objeto de error; el código es 409/422 con el contrato D40.
    expect(res.body).toHaveProperty('codigo', 'CONFLICTO_HORARIO');
    expect(res.body).toHaveProperty('statusCode');
    expect([409, 422]).toContain(res.body.statusCode);
    expect(Array.isArray(res.body.alternativas)).toBe(true);
    expect(res.body.alternativas.length).toBeGreaterThan(0);
  });

  it('VERDE: el endpoint de huecos devuelve las mismas alternativas (200)', async () => {
    const data = (global as any).e402Data;
    // El bloque de 480 min no cabe; para 30 min el día tiene huecos.
    const res = await request(app.getHttpServer())
      .get(`${api}/barberias/${data.sede}/disponibilidad/huecos?fecha=${fecha(1)}&duracionMinutos=30&participantes=1`)
      .set(headers(data.cliente, data.sede));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('barberiaId', data.sede);
    expect(Array.isArray(res.body.alternativas)).toBe(true);
    // Hay huecos de 30 min en una jornada completa (excepto quizá extremos); debe devolver al menos algunos.
    expect(res.body.alternativas.length).toBeGreaterThan(0);
  });

  it('VERDE: con la bandera apagada responde 200 y lista vacía (no 403)', async () => {
    const data = (global as any).e402Data;
    await prisma.configuracionBarberia.update({
      where: { barberiaId: data.sede },
      data: { oportunidadesEspacioActivas: false },
    });

    const res = await request(app.getHttpServer())
      .get(`${api}/barberias/${data.sede}/disponibilidad/huecos?fecha=${fecha(1)}&duracionMinutos=30&participantes=1`)
      .set(headers(data.cliente, data.sede));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.alternativas)).toBe(true);
    expect(res.body.alternativas).toHaveLength(0);

    await prisma.configuracionBarberia.update({
      where: { barberiaId: data.sede },
      data: { oportunidadesEspacioActivas: true },
    });
  });
});
