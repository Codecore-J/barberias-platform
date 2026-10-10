/**
 * E3-05 · Expiración automática y cancelación manual (BACKLOG §E3-05).
 *
 * Solo con APP_ENV=dev.
 *
 * Pedidos de la tarea:
 *   1. Deuda de constantes: el job se encola y se consume con el MISMO nombre
 *      (`reservas-pendientes` / `expirar-reserva`) leído de queue.constants.ts.
 *   2. Worker: si la reserva sigue PENDIENTE y ya venció, pasa a EXPIRADA,
 *      libera el horario y audita.
 *   3. POST /barberias/:barberiaId/reservas/:id/cancelar para el CLIENTE dueño,
 *      ADMIN_BARBERIA y ADMINISTRADOR: pasa a CANCELADA, borra el job de
 *      BullMQ y audita.
 *   4. Reconciliación al arrancar: expira las vencidas y reencola las vigentes
 *      que perdieron su job.
 *
 * El arnés usa el MISMO pipe y filtro que `main.ts`, así que los códigos de
 * estado que se miden aquí son los de producción.
 *
 * NOTA DE EJECUCIÓN: necesita Redis (el módulo registra la cola real) y una
 * base de datos alcanzable. En la máquina de desarrollo sin Redis este fichero
 * no se puede ejecutar; la evidencia local es la suite unitaria
 * (`expiracion-reserva.service.spec.ts`, `reserva.processor.spec.ts`,
 * `queue.constants.spec.ts` y el describe E3-05 de `reserva.service.spec.ts`).
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
import { ReservaProcessor } from '../src/reserva/application/reserva.processor.js';
import { ExpiracionReservaService } from '../src/reserva/application/expiracion-reserva.service.js';
import { JOBS, QUEUES, jobIdExpiracionReserva } from '../src/shared/queues/queue.constants.js';

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

describe('E3-05 · expiración automática y cancelación manual', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let colaReservas: Queue;
  let processor: ReservaProcessor;
  let expiracionService: ExpiracionReservaService;

  const api = '/api/v1';
  const correos = [
    'duenio.e305@test.com',
    'adminsede.e305@test.com',
    'adminajena.e305@test.com',
    'cliente.e305@test.com',
    'cliente2.e305@test.com',
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
        OR: [{ codigoAcceso: { startsWith: 'E305' } }, { responsableId: { in: idsUsuario } }],
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
    colaReservas = app.get<Queue>(getQueueToken(QUEUES.RESERVAS));
    processor = app.get(ReservaProcessor);
    expiracionService = app.get(ExpiracionReservaService);

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
            nombreCompleto: `E305 ${i}`,
            correo,
            telefono: `9998${String(i).padStart(7, '0')}`,
            passwordHash: '$2b$10$HashFalsoE305NoSeUsaParaLogin',
          },
          select: { id: true },
        }),
      ),
    );

    sede = (
      await prisma.barberia.create({
        data: {
          nombre: 'Sede E305',
          telefono: '9998111111',
          ubicacion: 'Sede E305',
          codigoAcceso: 'E305A',
          enlaceUnico: 'https://e305.test',
          responsableId: duenio.id,
        },
        select: { id: true },
      })
    ).id;

    sedeAjena = (
      await prisma.barberia.create({
        data: {
          nombre: 'Sede E305 ajena',
          telefono: '9998222222',
          ubicacion: 'Sede E305 ajena',
          codigoAcceso: 'E305B',
          enlaceUnico: 'https://e305-ajena.test',
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
        { usuarioId: cliente2.id, rolId: roles['CLIENTE'], barberiaId: null },
      ],
    });

    // La creación de la reserva exige vínculo ACTIVO entre el cliente y la sede.
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
          nombre: 'Corte E305',
          precio: 30,
          duracionEstimada: 30,
          margenOperativo: 0,
        },
        select: { id: true },
      })
    ).id;

    // Horario de sede 00:00-23:59 todos los días. `diaSemana` del dominio es
    // 1=Lunes … 7=Domingo (el DTO lo valida con @Min(1) @Max(7)), así que el
    // rango es 1..7 y no 0..6: con 0..6 el domingo se queda sin horario.
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

  /** Crea una solicitud MANUAL legítima y devuelve su id (asserta el 201). */
  async function crearPendiente(horaInicio: string, token = tokenCliente, dia = 1): Promise<string> {
    const [h, m] = horaInicio.split(':').map(Number);
    const fin = new Date(2000, 0, 1, h, m + 30);
    const horaFin = `${String(fin.getHours()).padStart(2, '0')}:${String(fin.getMinutes()).padStart(2, '0')}`;

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
      `crear solicitud ${horaInicio}: ${res.status} ${JSON.stringify(res.body)}`,
    ).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE');
    return res.body.id;
  }

  /** Fuerza el vencimiento sin esperar los 10 minutos del `delay`. */
  const vencerEnBd = (reservaId: string) =>
    prisma.reserva.update({
      where: { id: reservaId },
      data: { expiraAt: new Date(Date.now() - 60_000) },
    });

  /** Ejecuta el consumidor real con el payload real del job. */
  const ejecutarJob = (reservaId: string) =>
    processor.process({
      id: jobIdExpiracionReserva(reservaId),
      name: JOBS.EXPIRAR_RESERVA,
      data: { reservaId, barberiaId: sede },
    } as any);

  const cancelar = (reservaId: string, token: string, barberiaId = sede) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/${reservaId}/cancelar`)
      .set('Authorization', `Bearer ${token}`);

  const auditoriasDe = (reservaId: string, accion: string) =>
    prisma.auditoria.count({ where: { entidadId: reservaId, accion } });

  // ── Expiración automática ────────────────────────────────────────────────

  it('ROJO: el job de expiración reconoce su nombre real y deja en paz una reserva vigente', async () => {
    const reservaId = await crearPendiente('08:00');

    expect(await ejecutarJob(reservaId)).toBe('AUN_VIGENTE');

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('PENDIENTE');
    expect(await auditoriasDe(reservaId, 'RESERVA_EXPIRADA')).toBe(0);
  });

  it('VERDE: una reserva vencida pasa a EXPIRADA, se audita y el job es idempotente', async () => {
    const reservaId = await crearPendiente('09:00');
    await vencerEnBd(reservaId);

    expect(await ejecutarJob(reservaId)).toBe('EXPIRADA');

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('EXPIRADA');
    expect(await auditoriasDe(reservaId, 'RESERVA_EXPIRADA')).toBe(1);

    // Ejecutar el processor DOS veces no cambia nada (criterio de aceptación).
    expect(await ejecutarJob(reservaId)).toBe('NO_APLICA');
    expect(await auditoriasDe(reservaId, 'RESERVA_EXPIRADA')).toBe(1);
  });

  it('VERDE: al expirar, el horario se libera para otro cliente', async () => {
    const reservaId = await crearPendiente('13:00');

    // Con la reserva PENDIENTE el hueco está ocupado: otro cliente recibe 409.
    const ocupado = await request(app.getHttpServer())
      .post(`${api}/barberias/${sede}/reservas`)
      .set('Authorization', `Bearer ${tokenCliente2}`)
      .send({
        fecha: fecha(1),
        horaInicio: '13:00',
        horaFin: '13:30',
        serviciosIds: [servicio],
        precioTotalEsperado: 30,
        tipo: 'INDIVIDUAL',
      });
    expect(ocupado.status, JSON.stringify(ocupado.body)).toBe(409);

    await vencerEnBd(reservaId);
    expect(await ejecutarJob(reservaId)).toBe('EXPIRADA');

    // El espacio vuelve a estar libre: el mismo intento ahora entra.
    const libre = await request(app.getHttpServer())
      .post(`${api}/barberias/${sede}/reservas`)
      .set('Authorization', `Bearer ${tokenCliente2}`)
      .send({
        fecha: fecha(1),
        horaInicio: '13:00',
        horaFin: '13:30',
        serviciosIds: [servicio],
        precioTotalEsperado: 30,
        tipo: 'INDIVIDUAL',
      });
    expect(libre.status, JSON.stringify(libre.body)).toBe(201);
  });

  it('VERDE: la reconciliación de arranque expira las vencidas y reencola las vigentes sin job', async () => {
    const vencida = await crearPendiente('10:00');
    const vigente = await crearPendiente('15:00');

    // Simula la caída de Redis: los dos jobs se pierden.
    const jobVencida = await colaReservas.getJob(jobIdExpiracionReserva(vencida));
    await jobVencida?.remove();
    const jobVigente = await colaReservas.getJob(jobIdExpiracionReserva(vigente));
    await jobVigente?.remove();

    await vencerEnBd(vencida);

    await expiracionService.reconciliar();

    const trasVencida = await prisma.reserva.findUnique({ where: { id: vencida } });
    expect(trasVencida?.estado).toBe('EXPIRADA');

    expect(await colaReservas.getJob(jobIdExpiracionReserva(vencida))).toBeFalsy();
    expect(await colaReservas.getJob(jobIdExpiracionReserva(vigente))).toBeTruthy();
  });

  // ── Cancelación manual ───────────────────────────────────────────────────

  it('ROJO: cancelar una reserva ajena con un CLIENTE → 403 RESERVA_AJENA', async () => {
    const reservaId = await crearPendiente('16:00');

    const res = await cancelar(reservaId, tokenCliente2);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.codigo).toBe('RESERVA_AJENA');

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('PENDIENTE');
  });

  it('ROJO: un admin de otra sede no puede cancelar (403 del guard)', async () => {
    const reservaId = await crearPendiente('17:00');

    const res = await cancelar(reservaId, tokenAdminAjena);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('VERDE: el CLIENTE dueño cancela su solicitud, se audita y se borra el job de expiración', async () => {
    const reservaId = await crearPendiente('18:00');
    expect(await colaReservas.getJob(jobIdExpiracionReserva(reservaId))).toBeTruthy();

    const res = await cancelar(reservaId, tokenCliente);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('CANCELADA');

    const enBd = await prisma.reserva.findUnique({ where: { id: reservaId } });
    expect(enBd?.estado).toBe('CANCELADA');
    expect(await auditoriasDe(reservaId, 'RESERVA_CANCELADA')).toBe(1);
    expect(await colaReservas.getJob(jobIdExpiracionReserva(reservaId))).toBeFalsy();
  });

  it('ROJO: cancelar dos veces → 409 ESTADO_INVALIDO', async () => {
    const reservaId = await crearPendiente('19:00');
    expect((await cancelar(reservaId, tokenCliente)).status).toBe(201);

    const segunda = await cancelar(reservaId, tokenCliente);

    expect(segunda.status, JSON.stringify(segunda.body)).toBe(409);
    expect(segunda.body.codigo).toBe('ESTADO_INVALIDO');
    expect(await auditoriasDe(reservaId, 'RESERVA_CANCELADA')).toBe(1);
  });

  it('VERDE: el admin de la sede cancela una reserva ya CONFIRMADA', async () => {
    const reservaId = await crearPendiente('20:00');

    const aceptada = await request(app.getHttpServer())
      .post(`${api}/barberias/${sede}/reservas/${reservaId}/aceptar`)
      .set('Authorization', `Bearer ${tokenAdminSede}`);
    expect(aceptada.status, JSON.stringify(aceptada.body)).toBe(201);

    const res = await cancelar(reservaId, tokenAdminSede);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.estado).toBe('CANCELADA');

    const auditoria = await prisma.auditoria.findFirst({
      where: { entidadId: reservaId, accion: 'RESERVA_CANCELADA' },
    });
    expect(auditoria?.usuarioId).toBeTruthy();
  });
});
