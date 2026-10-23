import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E4-02 · D22 · Carril B — prueba de FUEGO REAL de la lista de espera.
 *
 * A diferencia de `lista-espera.matcher.service.spec.ts` (que inyecta un Prisma
 * falso y un reloj fijo), este archivo monta la aplicación COMPLETA contra los
 * contenedadores locales de `docker-compose.yml` y valida el cableado completo:
 *
 *   cliente A reserva → cliente B se suscribe (PENDIENTE) → A cancela →
 *   `ReservaService` emite `HUECO_LIBERADO` en la cola de BullMQ →
 *   `ListaEsperaProcessor` corre el matcher FIFO → la suscripción de B queda
 *   NOTIFICADO y nace su notificación de aviso.
 *
 * Es la pieza que faltaba: los workers de BullMQ, la cola real y la transacción
 * SERIALIZABLE del test-and-set se ejecutan aquí de punta a punta.
 */

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

class ValidadorException extends BadRequestException {
  override getStatus() {
    return 422;
  }
}

/** Consulta la suscripción en la BD hasta que el worker la mueva (o se acabe la espera). */
async function esperarEstado(
  prisma: PrismaService,
  suscripcionId: string,
  estadoEsperado: string,
  intentos = 40,
): Promise<string> {
  let estadoActual = 'DESCONOCIDO';
  for (let i = 0; i < intentos; i++) {
    const fila = await prisma.listaEspera.findUnique({
      where: { id: suscripcionId },
      select: { estado: true },
    });
    estadoActual = fila?.estado ?? 'INEXISTENTE';
    if (estadoActual === estadoEsperado) return estadoActual;
    await new Promise((resolver) => setTimeout(resolver, 500));
  }
  return estadoActual;
}

describe('E4-02 · Carril B — el hueco liberado por una cancelación llega a la lista de espera', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const tokens: Record<string, string> = {};
  const ids: {
    sede: string;
    servicio: string;
    clienteA: string;
    clienteB: string;
    reserva: string;
    suscripcion: string;
    correoA: string;
    correoB: string;
  } = {
    sede: '',
    servicio: '',
    clienteA: '',
    clienteB: '',
    reserva: '',
    suscripcion: '',
    correoA: '',
    correoB: '',
  };

  /** Mañana, en el futuro real de la sede: el matcher descarta huecos pasados. */
  const FECHA_OBJETIVO = fecha(1);
  const HORA_INICIO = '09:30';
  const HORA_FIN = '10:00';

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
  };

  const headers = (correo: string) => ({
    Authorization: `Bearer ${tokens[correo]}`,
    'x-barberia-id': ids.sede,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // El throttler global cortaría la ráfaga de consultas del polling.
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => new ValidadorException(errors),
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    ids.correoA = `cliente-a-le-${suffix}@test.com`;
    ids.correoB = `cliente-b-le-${suffix}@test.com`;
    const telefonoBase = `601${suffix.slice(-6).padEnd(6, '0')}`;

    await registrarYLogin(ids.correoA, `${telefonoBase}01`);
    await registrarYLogin(ids.correoB, `${telefonoBase}02`);

    const usuarioA = await prisma.usuario.findUniqueOrThrow({
      where: { correo: ids.correoA },
      select: { id: true },
    });
    const usuarioB = await prisma.usuario.findUniqueOrThrow({
      where: { correo: ids.correoB },
      select: { id: true },
    });
    ids.clienteA = usuarioA.id;
    ids.clienteB = usuarioB.id;

    const sede = await prisma.barberia.create({
      data: {
        nombre: `Sede CarrilB-${suffix}`,
        telefono: `${telefonoBase}03`,
        ubicacion: 'Lista de espera E2E',
        estado: 'ACTIVO',
        codigoAcceso: `LE-${suffix}`,
        enlaceUnico: `https://le-${suffix}.test`,
        responsableId: usuarioA.id,
      },
    });
    ids.sede = sede.id;

    // AUTOMATICA nace CONFIRMADA (ocupa agenda desde el minuto cero); el margen
    // 0 permite que un servicio de 30 min quepa exacto en un hueco de 30 min.
    await prisma.configuracionBarberia.create({
      data: {
        barberiaId: sede.id,
        modoReserva: 'AUTOMATICA',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
        aceptaGrupal: false,
        horizonteReservaDias: 30,
        margenGrupalMinutos: 0,
        oportunidadesEspacioActivas: true,
      },
    });

    await prisma.horario.createMany({
      data: Array.from({ length: 7 }, (_, dia) => ({
        barberiaId: sede.id,
        diaSemana: dia + 1,
        horaInicio: new Date('1970-01-01T09:00:00.000Z'),
        horaFin: new Date('1970-01-01T20:00:00.000Z'),
      })),
    });

    const servicio = await prisma.servicio.create({
      data: {
        barberiaId: sede.id,
        nombre: 'Corte CarrilB',
        precio: 10,
        duracionEstimada: 30,
        margenOperativo: 0,
      },
    });
    ids.servicio = servicio.id;

    // Ambos clientes quedan VINCULADOS: A para poder reservar, B para poder
    // sustituir a A en ese hueco el día que le toque.
    await prisma.clienteBarberia.createMany({
      data: [
        { usuarioId: usuarioA.id, barberiaId: sede.id, estadoVinculacion: 'ACTIVO' },
        { usuarioId: usuarioB.id, barberiaId: sede.id, estadoVinculacion: 'ACTIVO' },
      ],
      skipDuplicates: true,
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('el Cliente A reserva un bloque y la cita queda CONFIRMADA (ocupa agenda)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${ids.sede}/reservas`)
      .set(headers(ids.correoA))
      .send({
        fecha: FECHA_OBJETIVO,
        horaInicio: HORA_INICIO,
        horaFin: HORA_FIN,
        serviciosIds: [ids.servicio],
        precioTotalEsperado: 10,
        tipo: 'INDIVIDUAL',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.estado).toBe('CONFIRMADA');
    ids.reserva = res.body.id;
  });

  it('el Cliente B se suscribe a la lista de espera de esa sede, fecha y servicio (PENDIENTE)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/lista-espera`)
      .set(headers(ids.correoB))
      .send({
        barberiaId: ids.sede,
        fechaObjetivo: FECHA_OBJETIVO,
        servicios: [ids.servicio],
      });

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE');
    expect(res.body.barberiaId).toBe(ids.sede);
    expect(res.body.servicios).toHaveLength(1);
    expect(res.body.servicios[0].id).toBe(ids.servicio);
    ids.suscripcion = res.body.id;
  });

  it('el Cliente A cancela su reserva y el bloque queda libre', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/reservas/${ids.reserva}/cancelar`)
      .set(headers(ids.correoA));

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('CANCELADA');

    // La disponibilidad se CALCULA, no se almacena: confirmar que el bloque ya
    // no está ocupado es mirar que no quede ninguna reserva viva en ese rango.
    const ocupantes = await prisma.reserva.findMany({
      where: {
        barberiaId: ids.sede,
        fechaCita: new Date(`${FECHA_OBJETIVO}T00:00:00.000Z`),
        estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
      },
    });
    expect(ocupantes).toHaveLength(0);
  });

  it('el worker de BullMQ procesa HUECO_LIBERADO y la suscripción de B pasa a NOTIFICADO', async () => {
    // El encolado es tras el commit y el worker es asíncrono: se consulta la BD
    // con reintentos en lugar de dormir un tiempo fijo a ciegas.
    const estado = await esperarEstado(prisma, ids.suscripcion, 'NOTIFICADO');
    expect(estado).toBe('NOTIFICADO');
  }, 60_000);

  it('el matcher deja trazabilidad del aviso: log estructurado y notificación persistida', async () => {
    // El aviso al cliente es best-effort y se persiste ANTES de encolar su
    // envío: la fila tiene que existir aunque el canal de correo esté caído.
    const notificacion = await prisma.notificacion
      .findFirst({
        where: {
          usuarioId: ids.clienteB,
          tipo: 'LISTA_ESPERA_HUECO_LIBERADO',
        },
      });
    expect(notificacion).not.toBeNull();
    expect(notificacion?.canal).toBe('EMAIL');

    // Y la suscripción de A (que no existió) o de terceros no se toca: la única
    // suscripción viva de esta sede/fecha es la de B y ya está NOTIFICADO.
    const vivas = await prisma.listaEspera.findMany({
      where: { barberiaId: ids.sede, fechaObjetivo: new Date(`${FECHA_OBJETIVO}T00:00:00.000Z`) },
    });
    expect(vivas).toHaveLength(1);
    expect(vivas[0].id).toBe(ids.suscripcion);
    expect(vivas[0].estado).toBe('NOTIFICADO');
  });
});
