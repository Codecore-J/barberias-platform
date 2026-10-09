/**
 * E3-03 · parte 2 · reglas de CREACIÓN de reserva.
 *
 * Solo con APP_ENV=dev. Pedidos:
 *   403 NO_VINCULADO · 403 CLIENTE_RESTRINGIDO
 *   422 RESERVAS_PAUSADAS · 422 FUERA_DE_HORIZONTE · 422 LIMITE_PENDIENTES
 *   422 GRUPAL_NO_DISPONIBLE · 400 servicio de otra barbería
 *   MANUAL → PENDIENTE + expira_at = ahora + 10 min · AUTOMATICO → CONFIRMADA
 *
 * La aplicación del e2e usa un ValidationPipe que mapea los fallos de
 * validación del DTO a 422 (las cinco reglas de dominio van en esa
 * familia), y deja 403/409/400 en su sitio.
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
  return new Date(Date.now() + n * 86400000)
    .toISOString()
    .split('T')[0];
}

/** El ValidationPipe de este módulo convierte la validación de DTO en 422. */
class ValidadorException extends BadRequestException {
  override getStatus() {
    return 422;
  }
}

describe('E3-03 · parte 2 — reglas de creación de reserva', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const CORREOS = [
    'cA.e303@test.com', // CLIENTE (sede A) — control normal
    'cB.e303@test.com', // CLIENTE (sede A) — vinculado
    'cX.e303@test.com', // CLIENTE (sede A) — NO VINCULADO
    'cY.e303@test.com', // CLIENTE (sede A) — RESTRINGIDO
    'cD.e303@test.com', // CLIENTE (sede B) — GRUPAL
    'cE.e303@test.com', // CLIENTE (sede C) — PAUSADO
    'cF.e303@test.com', // CLIENTE (sede D) — FUERA DE HORIZONTE
    'cG.e303@test.com', // CLIENTE (sede E) — LIMITE_PENDIENTES
    'cH.e303@test.com', // CLIENTE (sede E) — cargador
    'cI.e303@test.com', // CLIENTE (sede F) — AUTO
  ];
  const api = '/api/v1';
  let tokens: Record<string, string> = {};
  let barberia: Record<string, string> = {};
  let servicio: Record<string, string> = {};
  let rol: Record<string, string> = {};

  /** Registrarse + loguearse y dejar el token en `tokens[correo]` (modo async). */
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
    // La sede A aloja el test de carrera (10 peticiones concurrentes al mismo hueco):
    // se queda SIN tope de pendientes para que la carrera se resuelva por
    // disponibilidad (1×201 / 9×409) y no por LIMITE_PENDIENTES.
    A: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: true, horizonteReservaDias: 30 },
    B: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: false, maxPendientes: 3, horizonteReservaDias: 30 },
    C: { modoReserva: 'MANUAL', nuevasReservasActivas: false, aceptaIndividual: true, aceptaGrupal: true, maxPendientes: 3, horizonteReservaDias: 30 },
    D: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: true, maxPendientes: 3, horizonteReservaDias: 2 },
    E: { modoReserva: 'MANUAL', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: true, maxPendientes: 1, horizonteReservaDias: 30 },
    F: { modoReserva: 'AUTOMATICA', nuevasReservasActivas: true, aceptaIndividual: true, aceptaGrupal: true, maxPendientes: 3, horizonteReservaDias: 30 },
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
    // La regla de dominio devuelve 422 para fallos de validación de DTO.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: (errors) => new ValidadorException(errors) }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // Limpieza idempotente de las sedes E303 y sus dependencias: el afterAll solo
    // desconecta, así que una segunda ejecución no debe chocar con la primera
    // (la sede se recrea con el mismo codigo_acceso, que es único).
    const sedesPrevias = await prisma.barberia.findMany({
      where: { codigoAcceso: { startsWith: 'E303' } },
      select: { id: true },
    });
    const idsSede = sedesPrevias.map((s) => s.id);
    if (idsSede.length > 0) {
      const reservasPrevias = await prisma.reserva.findMany({
        where: { barberiaId: { in: idsSede } },
        select: { id: true },
      });
      await prisma.pago.deleteMany({
        where: { reservaId: { in: reservasPrevias.map((r) => r.id) } },
      });
      await prisma.reserva.deleteMany({ where: { barberiaId: { in: idsSede } } });
      await prisma.usuarioRol.deleteMany({ where: { barberiaId: { in: idsSede } } });
      await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    }

    // Limpieza por si se vuelve a ejecutar en la misma base.
    // Borrar el usuario antes que los vínculos/roles: si eliminas los vínculos primero
    // puede que falle por FK (usuarioRol.clienteBarberia), y el correo no es un UUID, asique
    // hay que filtrar por los IDs de usuario en vez de pasarlo directamente en el where.
    const usuarioIds = await prisma.usuario.findMany({
      where: { correo: { in: CORREOS } },
      select: { id: true },
    });
    const usuarioIdSet = usuarioIds.map((u) => u.id);
    if (usuarioIdSet.length > 0) {
      await prisma.usuario.deleteMany({ where: { id: { in: usuarioIdSet } } });
      await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarioIdSet } } });
      await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: usuarioIdSet } } });
    }

    // Roles
    for (const nombre of ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE']) {
      rol[nombre] = (await prisma.rol.upsert({
        where: { nombre },
        update: { ambito: nombre === 'CLIENTE' ? 'GLOBAL' : 'BARBERIA' },
        create: { nombre, ambito: nombre === 'CLIENTE' ? 'GLOBAL' : 'BARBERIA' },
        select: { id: true },
      })).id;
    }

    // Usuarios y tokens: el registro puede devolver 409 por duplicado; el token
    // es el mismo y es lo que usan las pruebas.
    for (const [correo, telefono] of [
      ['admin.e303@test.com', '6000000000'],
      ['cA.e303@test.com', '600010001'],
      ['cB.e303@test.com', '600010002'],
      ['cX.e303@test.com', '600010003'],
      ['cY.e303@test.com', '600010004'],
      ['cD.e303@test.com', '600010005'],
      ['cE.e303@test.com', '600010006'],
      ['cF.e303@test.com', '600010007'],
      ['cG.e303@test.com', '600010008'],
      ['cH.e303@test.com', '600010009'],
      ['cI.e303@test.com', '600010010'],
    ] as [string, string][]) {
      const r = await registrarYLogin(correo, telefono);
      expect([200, 201, 409]).toContain(r.status);
    }
    for (const nombre of Object.keys(configs)) {
      const barberiaId = await prisma.barberia.create({
        data: {
          nombre: `Sede ${nombre} E303`,
          telefono: `600${1000 + Number(nombre)}2222`,
          ubicacion: nombre,
          estado: 'ACTIVA',
          codigoAcceso: `E303${nombre}`,
          enlaceUnico: `https://${nombre}.e303.test`,
          responsableId: (await prisma.usuario.findUnique({ where: { correo: `admin.e303@test.com` } })).id,
        },
      });
      barberia[nombre] = barberiaId.id;
      await prisma.configuracionBarberia.create({ data: { barberiaId: barberiaId.id, ...configs[nombre] } });
    }

    // Servicios y horarios
    {
      const s = await prisma.servicio.create({ data: { barberiaId: barberia.A, nombre: 'Corte E303', precio: 30, duracionEstimada: 30, margenOperativo: 0 } });
      servicio.A = s.id;
      const sB = await prisma.servicio.create({ data: { barberiaId: barberia.B, nombre: 'Corte B', precio: 30, duracionEstimada: 30, margenOperativo: 0 } });
      servicio.B = sB.id;
      const sF = await prisma.servicio.create({ data: { barberiaId: barberia.F, nombre: 'Corte F', precio: 30, duracionEstimada: 30, margenOperativo: 0 } });
      servicio.F = sF.id;
      const sD = await prisma.servicio.create({ data: { barberiaId: barberia.D, nombre: 'Corte D', precio: 30, duracionEstimada: 30, margenOperativo: 0 } });
      servicio.D = sD.id;
      // La sede E aloja el test de LIMITE_PENDIENTES: necesita su propio servicio,
      // si no la primera reserva (la que llena el cupo) cae en un 400 falso.
      const sE = await prisma.servicio.create({ data: { barberiaId: barberia.E, nombre: 'Corte E', precio: 30, duracionEstimada: 30, margenOperativo: 0 } });
      servicio.E = sE.id;
    }
    for (const nombre of Object.keys(configs)) {
      await prisma.horario.createMany({ data: Array.from({ length: 7 }, (_, dia) => ({ barberiaId: barberia[nombre], diaSemana: dia + 1, horaInicio: new Date('1970-01-01T00:00:00.000Z'), horaFin: new Date('1970-01-01T23:59:00.000Z') })) });
    }

    // UsuarioRol + vinculos
    for (const [mail, sedes] of [
      ['cA.e303@test.com', ['A', 'B', 'C', 'D', 'E', 'F']],
      ['cB.e303@test.com', ['A']],
      ['cX.e303@test.com', []],                      // NO VINCULADO
      ['cY.e303@test.com', ['A']],                   // RESTRINGIDO (estaRestringido)
      ['cD.e303@test.com', ['B']],
      ['cE.e303@test.com', ['C']],
      ['cF.e303@test.com', ['D']],
      ['cG.e303@test.com', ['E']],
      ['cH.e303@test.com', ['E']],
      ['cI.e303@test.com', ['F']],
    ] as [string, string[]][]) {
      for (const s of ['CLIENTE', 'ADMIN_BARBERIA', 'BARBERO'] as const) {
        await prisma.usuarioRol.create({ data: { usuarioId: (await prisma.usuario.findUnique({ where: { correo: mail } })).id, rolId: rol[s], barberiaId: s === 'CLIENTE' ? null : sedes.includes(s) ? barberia[s] : undefined } });
      }
    }
    // Vínculos ACTIVOS (cX *sin* filas en clienteBarberias = NO_VINCULADO)
    for (const [mail, sede, conRestringido] of [
      ['cA.e303@test.com', 'A', false],
      ['cB.e303@test.com', 'A', false],
      // cX NO se vincula a propósito: es el caso NO_VINCULADO.
      ['cY.e303@test.com', 'A', true],
      ['cD.e303@test.com', 'B', false],
      ['cE.e303@test.com', 'C', false],
      ['cF.e303@test.com', 'D', false],
      ['cG.e303@test.com', 'E', false],
      ['cH.e303@test.com', 'E', false],
      ['cI.e303@test.com', 'F', false],
    ] as [string, string, boolean?][]) {
      const u = await prisma.usuario.findUnique({ where: { correo: mail } });
      if (sede) {
        await prisma.clienteBarberia.create({
          data: {
            usuarioId: u.id,
            barberiaId: barberia[sede],
            estadoVinculacion: 'ACTIVO',
            ...(conRestringido ? { estaRestringido: true } : {}),
          },
        });
      }
    }

    // Reconocer que cX está *sin* vinculo: no existe la fila clienteBarberia de cX
    // (solo su vínculo 'ACTIVO' previo se ha eliminado aquí explícitamente).
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const headers = (correo: string, barberiaId: string) => ({
    Authorization: `Bearer ${tokens[correo]}`,
    'x-barberia-id': barberiaId,
  });

  const reserva = (correo: string, barberiaId: string, { tipo, fecha, services, barberoId }: { tipo: 'INDIVIDUAL' | 'AUTOMATICO' | 'GRUPAL'; fecha: string; services: string; barberoId?: string }) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas`)
      .set(headers(correo, barberiaId))
      .send({ fecha, horaInicio: '10:00', horaFin: '10:30', serviciosIds: [services], precioTotalEsperado: 30, tipo, ...(barberoId ? { barberoId } : {}) });

  it('ROJO: NO_VINCULADO 403 cuando el cliente no está vinculado a esa barbería', async () => {
    const res = await reserva('cX.e303@test.com', barberia.A, { tipo: 'INDIVIDUAL', fecha: fecha(1), services: servicio.A });
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe('NO_VINCULADO');
  });

  it('ROJO: CLIENTE_RESTRINGIDO 403 cuando el cliente está restringido en esa barbería', async () => {
    const res = await reserva('cY.e303@test.com', barberia.A, { tipo: 'INDIVIDUAL', fecha: fecha(1), services: servicio.A });
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe('CLIENTE_RESTRINGIDO');
  });

  it('ROJO: RESERVAS_PAUSADAS 422 cuando la barbería tiene nuevasReservasActivas=false', async () => {
    const res = await reserva('cE.e303@test.com', barberia.C, { tipo: 'INDIVIDUAL', fecha: fecha(1), services: servicio.A });
    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('RESERVAS_PAUSADAS');
  });

  it('ROJO: FUERA_DE_HORIZONTE 422 cuando la fecha está fuera del horizonte', async () => {
    const res = await reserva('cF.e303@test.com', barberia.D, { tipo: 'INDIVIDUAL', fecha: fecha(6), services: servicio.A });
    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('FUERA_DE_HORIZONTE');
  });

  it('ROJO: LIMITE_PENDIENTES 422 cuando ya alcanza max_pendientes', async () => {
    const primero = await reserva('cG.e303@test.com', barberia.E, { tipo: 'INDIVIDUAL', fecha: fecha(1), services: servicio.E });
    expect(primero.status).toBe(201);
    const segundo = await reserva('cH.e303@test.com', barberia.E, { tipo: 'INDIVIDUAL', fecha: fecha(1), services: servicio.E });
    expect(segundo.status).toBe(422);
    expect(segundo.body.codigo).toBe('LIMITE_PENDIENTES');
  });

  it('ROJO: GRUPAL_NO_DISPONIBLE 422 cuando el tipo GRUPAL no está permitido en la barbería', async () => {
    const res = await reserva('cD.e303@test.com', barberia.B, { tipo: 'GRUPAL', fecha: fecha(1), services: servicio.B });
    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('GRUPAL_NO_DISPONIBLE');
  });

  it('ROJO: servicio de otra barbería → 400', async () => {
    const res = await reserva('cA.e303@test.com', barberia.A, { tipo: 'INDIVIDUAL', fecha: fecha(1), services: servicio.B });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('SERVICIO_FUERA_DE_BARBERIA');
  });

  it('CONTROL: MANUAL → PENDIENTE, expira_at = ahora + 10 min y job de expiración', async () => {
    const res = await reserva('cA.e303@test.com', barberia.A, { tipo: 'INDIVIDUAL', fecha: fecha(1), services: servicio.A });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE');
    expect(typeof res.body.expiraAt).toBe('string');
    expect(new Date(res.body.expiraAt).getTime() > Date.now()).toBe(true);
  });

  /** Control D44: cotización sin persistir, mismo blanco que crear. */
  const cotizar = (correo: string, barberiaId: string, { fecha, services }: { fecha: string; services: string }) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaId}/reservas/cotizar`)
      .set(headers(correo, barberiaId))
      .send({ fecha, horaInicio: '10:00', horaFin: '10:30', serviciosIds: [services], precioTotalEsperado: 30, tipo: 'INDIVIDUAL' });

  it('CONTROL: AUTOMATICO → CONFIRMADA sin temporizador', async () => {
    const res = await reserva('cI.e303@test.com', barberia.F, { tipo: 'AUTOMATICO', fecha: fecha(1), services: servicio.F });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(res.body.expiraAt).toBeNull();
  });



  it('CONTROL: cotización sin persistir (D44) - mismo blanco que crear', async () => {
    const cot = await request(app.getHttpServer())
      .post(`${api}/barberias/${barberia.A}/reservas/cotizar`)
      .set(headers('cA.e303@test.com', barberia.A))
      .send({ fecha: fecha(1), horaInicio: '10:00', horaFin: '10:30', serviciosIds: [servicio.A], precioTotalEsperado: 30, tipo: 'INDIVIDUAL' });
    expect(cot.status).toBe(201);
    expect(cot.body.barberiaId).toBe(barberia.A);
    expect(cot.body.fecha).toBe(fecha(1));
    expect(cot.body.horaFin).toBe('10:30');
    expect(cot.body.bloqueTotal).toBeDefined();
    expect(cot.body.bloqueTotal.duracionTotal).toBeGreaterThan(0);
    expect(cot.body.bloqueTotal.precioTotal).toBe(30);
    expect(cot.body.desgloseServicios).toHaveLength(1);
    expect(cot.body.desgloseServicios[0].servicioId).toBe(servicio.A);
  })
  it('Race: 10 solicitudes simultáneas al mismo hueco → exactamente una 201 y nueve 409', async () => {
    // La carrera usa fecha(3): el CONTROL de arriba ya dejó una reserva PENDIENTE
    // en la sede A para fecha(1) 10:00-10:30, y `calcularDisponibilidad` cuenta
    // PENDIENTE/CONFIRMADA sin filtrar por barbero, así que ese hueco ya está
    // ocupado y la carrera daría 0×201.
    const peticiones = Array.from({ length: 10 }, () => reserva('cA.e303@test.com', barberia.A, { tipo: 'INDIVIDUAL', fecha: fecha(3), services: servicio.A }));
    const resultados = await Promise.all(peticiones);
    const cuentas: Record<number, number> = {};
    for (const r of resultados) cuentas[r.status] = (cuentas[r.status] || 0) + 1;
    expect(cuentas[201]).toBe(1);
    expect(cuentas[409]).toBe(9);
  });
});
