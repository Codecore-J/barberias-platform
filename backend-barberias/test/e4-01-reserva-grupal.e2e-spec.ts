/**
 * E4-01 · Reserva grupal: la capacidad se calcula por participantes.
 *
 * Solo con APP_ENV=dev. Cubre los criterios de aceptación del backlog:
 *   1 adulto + 2 niños con max_personas_total = 3 y max_ninos = 2 → 201, bloque
 *   = Σ duraciones + UN margen (ejemplo del diseño: 35 + 30 + 30 + 10 = 105).
 *   1 adulto + 3 niños con max_ninos = 2 → 422 CAPACIDAD_EXCEDIDA sin escribir.
 *   margen aplicado UNA vez y `participante_servicios.margen_historico` = 0.
 *   Dos reservas solapadas siguen dando 409: la capacidad no abre un segundo
 *   carril (D45).
 *
 * La aplicación del e2e usa un ValidationPipe que mapea los fallos de validación
 * del DTO a 422, igual que el resto de los e2e; las reglas de dominio
 * (CAPACIDAD_EXCEDIDA, GRUPAL_NO_DISPONIBLE, PARTICIPANTES_INVALIDOS) viajan con
 * su `codigo` del contrato D40.
 */
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

/** El ValidationPipe de este módulo convierte la validación de DTO en 422. */
class ValidadorException extends BadRequestException {
  override getStatus() {
    return 422;
  }
}

describe('E4-01 · reserva grupal', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const CORREOS = [
    'admin.e401@test.com',
    'gA.e401@test.com', // CLIENTE (sede A) — ejemplo del diseño
    'gB.e401@test.com', // CLIENTE (sede B) — un niño de más
    'gC.e401@test.com', // CLIENTE (sede C) — la sede no acepta grupales
    'gD.e401@test.com', // CLIENTE (sede D) — tope duro de plataforma
  ];
  const api = '/api/v1';
  const tokens: Record<string, string> = {};
  const barberia: Record<string, string> = {};
  const servicio: Record<string, { adulto: string; nino: string }> = {};
  const rol: Record<string, string> = {};

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

  const configs: Record<string, Record<string, unknown>> = {
    // Sede A: el ejemplo del diseño (1 adulto + 2 niños caben justo).
    A: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: true, horizonteReservaDias: 30, margenGrupalMinutos: 10, maxPersonasTotal: 3, maxNinos: 2 },
    // Sede B: margen amplio de personas pero solo 2 niños.
    B: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: true, horizonteReservaDias: 30, margenGrupalMinutos: 10, maxPersonasTotal: 5, maxNinos: 2 },
    // Sede C: no acepta grupales (E3-03 sigue respondiendo GRUPAL_NO_DISPONIBLE).
    C: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: false, horizonteReservaDias: 30, margenGrupalMinutos: 10 },
    // Sede D: sin límites propios → solo manda el tope duro de plataforma (8).
    D: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: true, horizonteReservaDias: 30, margenGrupalMinutos: 10 },
  };

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

    // Limpieza idempotente: el afterAll solo desconecta, así que una segunda
    // ejecución no puede chocar con el `codigo_acceso` único de las sedes.
    const sedesPrevias = await prisma.barberia.findMany({
      where: { codigoAcceso: { startsWith: 'E401' } },
      select: { id: true },
    });
    const idsSede = sedesPrevias.map((s) => s.id);
    if (idsSede.length > 0) {
      const reservasPrevias = await prisma.reserva.findMany({
        where: { barberiaId: { in: idsSede } },
        select: { id: true },
      });
      await prisma.pago.deleteMany({ where: { reservaId: { in: reservasPrevias.map((r) => r.id) } } });
      await prisma.reserva.deleteMany({ where: { barberiaId: { in: idsSede } } });
      await prisma.usuarioRol.deleteMany({ where: { barberiaId: { in: idsSede } } });
      await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    }

    const usuarioIds = (await prisma.usuario.findMany({ where: { correo: { in: CORREOS } }, select: { id: true } })).map((u) => u.id);
    if (usuarioIds.length > 0) {
      await prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
      await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarioIds } } });
      await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: usuarioIds } } });
    }

    for (const nombre of ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE']) {
      rol[nombre] = (await prisma.rol.upsert({
        where: { nombre },
        update: { ambito: nombre === 'CLIENTE' ? 'GLOBAL' : 'BARBERIA' },
        create: { nombre, ambito: nombre === 'CLIENTE' ? 'GLOBAL' : 'BARBERIA' },
        select: { id: true },
      })).id;
    }

    for (const [correo, telefono] of [
      ['admin.e401@test.com', '6010000000'],
      // `RegisterDto` exige 10 dígitos exactos: los fixtures también.
      ['gA.e401@test.com', '6010100011'],
      ['gB.e401@test.com', '6010100012'],
      ['gC.e401@test.com', '6010100013'],
      ['gD.e401@test.com', '6010100014'],
    ] as [string, string][]) {
      await registrarYLogin(correo, telefono);
    }

    const admin = await prisma.usuario.findUniqueOrThrow({ where: { correo: 'admin.e401@test.com' }, select: { id: true } });
    for (const nombre of Object.keys(configs)) {
      const sede = await prisma.barberia.create({
        data: {
          nombre: `Sede ${nombre} E401`,
          telefono: `601${1000 + Number(nombre)}2222`,
          ubicacion: nombre,
          estado: 'ACTIVO',
          codigoAcceso: `E401${nombre}`,
          enlaceUnico: `https://${nombre.toLowerCase()}.e401.test`,
          responsableId: admin.id,
        },
      });
      barberia[nombre] = sede.id;
      await prisma.configuracionBarberia.create({ data: { barberiaId: sede.id, ...configs[nombre] } });

      const adulto = await prisma.servicio.create({
        data: { barberiaId: sede.id, nombre: `Corte Adulto E401${nombre}`, precio: 40, duracionEstimada: 35, margenOperativo: 0 },
      });
      const nino = await prisma.servicio.create({
        data: { barberiaId: sede.id, nombre: `Corte Niño E401${nombre}`, precio: 25, duracionEstimada: 30, margenOperativo: 0 },
      });
      servicio[nombre] = { adulto: adulto.id, nino: nino.id };

      await prisma.horario.createMany({
        data: Array.from({ length: 7 }, (_, dia) => ({
          barberiaId: sede.id,
          diaSemana: dia + 1,
          horaInicio: new Date('1970-01-01T00:00:00.000Z'),
          horaFin: new Date('1970-01-01T23:59:00.000Z'),
        })),
      });
    }

    for (const [correo, sede] of [
      ['admin.e401@test.com', null],
      ['gA.e401@test.com', 'A'],
      ['gB.e401@test.com', 'B'],
      ['gC.e401@test.com', 'C'],
      ['gD.e401@test.com', 'D'],
    ] as [string, string | null][]) {
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { correo }, select: { id: true } });
      for (const nombreRol of ['CLIENTE', 'ADMIN_BARBERIA', 'BARBERO'] as const) {
        await prisma.usuarioRol.create({
          data: { usuarioId: usuario.id, rolId: rol[nombreRol], barberiaId: nombreRol === 'CLIENTE' ? null : sede ? barberia[sede] : undefined },
        });
      }
      if (sede) {
        await prisma.clienteBarberia.create({
          data: { usuarioId: usuario.id, barberiaId: barberia[sede], estadoVinculacion: 'ACTIVO' },
        });
      }
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const headers = (correo: string, barberiaId: string) => ({
    Authorization: `Bearer ${tokens[correo]}`,
    'x-barberia-id': barberiaId,
  });

  /** Participantes del diseño: 1 adulto (35 min) + N niños (30 min cada uno). */
  const participantes = (sede: string, ninos: number, opciones: { sinServicios?: boolean } = {}) => {
    const lista = [
      { nombre: 'Adulto E401', esAdultoResponsable: true, servicios: [servicio[sede].adulto] },
    ];
    for (let i = 0; i < ninos; i++) {
      lista.push({
        nombre: `Niño E401 ${i + 1}`,
        esAdultoResponsable: false,
        servicios: opciones.sinServicios && i === ninos - 1 ? [] : [servicio[sede].nino],
      });
    }
    return lista;
  };

  const reservaGrupal = (
    correo: string,
    sede: string,
    cuerpo: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberia[sede]}/reservas`)
      .set(headers(correo, barberia[sede]))
      .send({
        fecha: fecha(1),
        horaInicio: '10:00',
        horaFin: '11:35',
        precioTotalEsperado: 90,
        tipo: 'GRUPAL',
        ...cuerpo,
      });

  const contarReservas = (sede: string) =>
    prisma.reserva.count({ where: { barberiaId: barberia[sede] } });

  it('VERDE: 1 adulto + 2 niños con max_personas_total = 3 y max_ninos = 2 → 201 con bloque 105', async () => {
    const res = await reservaGrupal('gA.e401@test.com', 'A', { participantes: participantes('A', 2) });

    expect(res.status).toBe(201);
    expect(res.body.tipoReserva).toBe('GRUPAL');
    expect(res.body.estado).toBe('PENDIENTE');
    // Σ duraciones = 35 + 30 + 30 = 95; el bloque completo es 95 + 10 (un margen).
    expect(res.body.horaFin).toBe('1970-01-01T11:35:00.000Z');
    expect(res.body.margenGrupalHistorico).toBe(10);
    expect(Number(res.body.totalPagar)).toBe(90);

    // Los registros de participantes se escriben al crear la reserva.
    const filas = await prisma.participanteReserva.findMany({
      where: { reservaId: res.body.id },
      include: { participanteServicios: true },
      orderBy: { esAdultoResponsable: 'desc' },
    });

    expect(filas).toHaveLength(3);
    expect(filas.filter((f) => f.esAdultoResponsable)).toHaveLength(1);
    expect(filas.filter((f) => !f.esAdultoResponsable)).toHaveLength(2);
    expect(filas.map((f) => f.nombreParticipante)).toContain('Niño E401 1');

    const snapshots = filas.flatMap((f) => f.participanteServicios);
    expect(snapshots).toHaveLength(3);
    expect(snapshots.map((s) => s.duracionHistorica).sort((a, b) => a - b)).toEqual([30, 30, 35]);
    // D42/§5.4: en grupales el margen por servicio es 0; el único margen va en la reserva.
    expect(snapshots.every((s) => s.margenHistorico === 0)).toBe(true);
    expect(snapshots.reduce((acc, s) => acc + Number(s.precioHistorico), 0)).toBe(90);

    // §E4-01/8: auditoría RESERVA_CREADA con el CONTEO de participantes…
    const auditoria = await prisma.auditoria.findFirst({
      where: { accion: 'RESERVA_CREADA', entidadId: res.body.id },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria!.contexto).toMatchObject({ tipoReserva: 'GRUPAL', participantes: 3 });
    // …y NUNCA con los nombres de los niños (privacidad, principio 2).
    expect(JSON.stringify(auditoria!.contexto)).not.toContain('Niño E401');
  });

  it('VERDE: la cotización grupal devuelve el MISMO bloque y precio sin persistir (D44)', async () => {
    const antes = await contarReservas('A');

    const res = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberia.A}/reservas/cotizar`)
      .set(headers('gA.e401@test.com', 'A'))
      .send({
        fecha: fecha(2),
        horaInicio: '10:00',
        horaFin: '11:35',
        precioTotalEsperado: 90,
        tipo: 'GRUPAL',
        participantes: participantes('A', 2),
      });

    expect(res.status).toBe(201);
    expect(res.body.horaFin).toBe('11:35');
    expect(res.body.bloqueTotal.duracionTotal).toBe(105);
    expect(res.body.bloqueTotal.margenTotal).toBe(10);
    expect(res.body.bloqueTotal.precioTotal).toBe(90);
    expect(res.body.desgloseServicios).toHaveLength(3);
    expect(res.body.desgloseServicios.map((s: any) => s.participanteIndex)).toEqual([0, 1, 2]);

    expect(await contarReservas('A')).toBe(antes);
  });

  it('ROJO: 1 adulto + 3 niños con max_ninos = 2 → 422 CAPACIDAD_EXCEDIDA sin escribir nada', async () => {
    const antes = await contarReservas('B');

    const res = await reservaGrupal('gB.e401@test.com', 'B', { participantes: participantes('B', 3) });

    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('CAPACIDAD_EXCEDIDA');
    expect(res.body.campo).toBe('maxNinos');
    expect(res.body.limite).toBe(2);
    expect(res.body.solicitado).toBe(3);
    expect(await contarReservas('B')).toBe(antes);
  });

  it('ROJO: 4 personas con max_personas_total = 3 → 422 CAPACIDAD_EXCEDIDA sobre maxPersonasTotal', async () => {
    const res = await reservaGrupal('gA.e401@test.com', 'A', {
      participantes: participantes('A', 3),
      fecha: fecha(5),
    });

    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('CAPACIDAD_EXCEDIDA');
    expect(res.body.campo).toBe('maxPersonasTotal');
    expect(res.body.limite).toBe(3);
    expect(res.body.solicitado).toBe(4);
  });

  it('ROJO: la sede sin límites propios sigue acotada por el tope duro de plataforma (8)', async () => {
    const res = await reservaGrupal('gD.e401@test.com', 'D', {
      participantes: participantes('D', 8),
      fecha: fecha(6),
    });

    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('CAPACIDAD_EXCEDIDA');
    expect(res.body.campo).toBe('MAX_PARTICIPANTES_POR_GRUPO');
    expect(res.body.limite).toBe(8);
    expect(res.body.solicitado).toBe(9);
  });

  it('ROJO: sede con acepta_grupal = false → 422 GRUPAL_NO_DISPONIBLE', async () => {
    const res = await reservaGrupal('gC.e401@test.com', 'C', {
      fecha: fecha(3),
      serviciosIds: [servicio.C.nino],
    });

    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('GRUPAL_NO_DISPONIBLE');
  });

  it('ROJO: dos adultos responsables → 400 PARTICIPANTES_INVALIDOS', async () => {
    const grupo = participantes('A', 1);
    grupo[1].esAdultoResponsable = true;

    const res = await reservaGrupal('gA.e401@test.com', 'A', { participantes: grupo, fecha: fecha(7) });

    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('PARTICIPANTES_INVALIDOS');
  });

  it('ROJO: grupo sin participantes → 400 PARTICIPANTES_INVALIDOS (no se inventa un grupo)', async () => {
    const res = await reservaGrupal('gA.e401@test.com', 'A', { fecha: fecha(8) });

    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('PARTICIPANTES_INVALIDOS');
  });

  it('ROJO: un participante sin servicios → 422 de validación del DTO', async () => {
    const res = await reservaGrupal('gA.e401@test.com', 'A', {
      fecha: fecha(9),
      participantes: participantes('A', 2, { sinServicios: true }),
    });

    expect(res.status).toBe(422);
  });

  it('ROJO: dos reservas grupales solapadas → 409: la capacidad no abre un segundo carril (D45)', async () => {
    const primera = await reservaGrupal('gB.e401@test.com', 'B', {
      fecha: fecha(10),
      participantes: participantes('B', 2),
    });
    expect(primera.status).toBe(201);

    const segunda = await reservaGrupal('gB.e401@test.com', 'B', {
      fecha: fecha(10),
      participantes: participantes('B', 2),
    });

    expect(segunda.status).toBe(409);
    expect(segunda.body.codigo).toBe('CONFLICTO_HORARIO');
  });
});
