import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

/**
 * H76 · §7.3 — el ciclo HTTP COMPLETO de la anulación de un cobro.
 *
 * H68 dejó la anulación certificada con tests de servicio y con el contrato HTTP
 * del frontend, pero esa es la mitad del camino: los mocks no prueban que la ruta
 * exista con el rol correcto, ni que la fila de `pagos` quede como `ANULADO` con
 * su motivo en Postgres, ni que el pago se pueda volver a cobrar DESPUÉS de haber
 * movido el dinero. Este fichero recorre el flujo entero por HTTP, contra la base
 * real, y comprueba el estado resultante en la base y en la auditoría.
 *
 * Orden del ciclo (el mismo que hará un cajero):
 *
 *   1. el CLIENTE crea su reserva (§ alta E3-03) y nace CONFIRMADA
 *   2. la SEDE la cobra (`POST /cobros`) → `pagos` en PAGADA, reserva COMPLETADA
 *   3. anular sin motivo → 422 `MOTIVO_REQUERIDO` (y 400 si el campo ni llega)
 *   4. anular con motivo → 200, `pagos` en ANULADO con autor, fecha y motivo
 *   5. el historial de la sede (`GET /cobros/historial`) muestra el recibo ANULADO
 *   6. volver a cobrar → 200 sobre la MISMA fila, sin rastro de la anulación
 *   7. BARBERO y CLIENTE intentan anular → 403; otra sede → 404; dos veces → 409
 *
 * Dos decisiones que el test hace explícitas:
 *
 *  - La cita se crea HOY y en una hora que ya pasó. Es la única forma de
 *    recorrer el ciclo completo por HTTP: §5.2 fila 11 prohíbe cobrar una cita
 *    que no ha empezado, así que una reserva futura no puede llegar a caja. Las
 *    etiquetas `DATE`/`TIME` se calculan en el reloj de la SEDE (E2-04), aquí
 *    `America/Santo_Domingo`, la única zona que admite el CHECK de D15. Que el
 *    alta acepte un hueco ya pasado es una observación aparte (ver reporte).
 *  - El motivo "sin motivo" se envía con espacios, NO ausente: un campo ausente
 *    lo corta el DTO con 400, y el 422 `MOTIVO_REQUERIDO` es la regla de negocio
 *    de `PagoService.anularPago`. Se comprueban los dos, porque son contratos
 *    distintos y el frontend puede caer en cualquiera.
 *
 * Solo con APP_ENV=dev (test/setup.e2e.ts aborta si no).
 */
describe('H76 · ciclo HTTP completo de la anulación de un cobro', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';

  const correos = [
    'duenio.h76@test.com',
    'admin.h76@test.com',
    'barbero.h76@test.com',
    'cliente.h76@test.com',
    'ajeno.h76@test.com',
    'duenio.b.h76@test.com',
  ];

  let sedeA: string;
  let sedeB: string;
  let servicioA: string;

  let adminSedeId: string;
  let clienteId: string;

  let tokenAdmin: string;
  let tokenBarbero: string;
  let tokenCliente: string;
  let tokenAjeno: string;

  /**
   * D15: el CHECK de `barberias.zona_horaria` solo admite `America/Santo_Domingo`
   * (no hay soporte multi-zona todavía), así que el test trabaja en ese reloj.
   * La República Dominicana no tiene horario de verano: el desfase es UTC-4 todo
   * el año y por eso se puede «mover» una fecha con aritmética simple, sin
   * depender de `Intl` ni de la zona del servidor de CI.
   */
  const DESFASE_SEDE_MS = 4 * 3600_000;
  const aRelojSede = (instante: Date) => new Date(instante.getTime() - DESFASE_SEDE_MS);
  const aInstanteUtc = (relojSede: Date) => new Date(relojSede.getTime() + DESFASE_SEDE_MS);

  /**
   * Hueco de la cita: hoy en la sede, dos horas atrás como mucho y nunca antes
   * de las 00:00 locales (así la fecha es siempre la de HOY aunque el run
   * empiece a las 00:30 de la sede).
   */
  const ahoraEnSede = aRelojSede(new Date());
  const medianocheSede = new Date(
    Date.UTC(
      ahoraEnSede.getUTCFullYear(),
      ahoraEnSede.getUTCMonth(),
      ahoraEnSede.getUTCDate(),
    ),
  );
  const inicioCita = new Date(
    Math.max(ahoraEnSede.getTime() - 2 * 3600_000, medianocheSede.getTime()),
  );
  inicioCita.setUTCMinutes(0, 0, 0);

  const dosDigitos = (n: number) => String(n).padStart(2, '0');

  /**
   * Cita de 30 min que empieza en `inicioSede` (reloj de la sede): etiquetas
   * `DATE`/`TIME` para el DTO y el instante UTC para comparar con la base.
   */
  function cita(inicioSede: Date) {
    const finSede = new Date(inicioSede.getTime() + 30 * 60_000);
    return {
      inicioUtc: aInstanteUtc(inicioSede),
      fecha: inicioSede.toISOString().slice(0, 10),
      horaInicio: `${dosDigitos(inicioSede.getUTCHours())}:00`,
      horaFin: `${dosDigitos(finSede.getUTCHours())}:${dosDigitos(finSede.getUTCMinutes())}`,
    };
  }

  async function crearUsuario(correo: string, nombre: string, telefono: string) {
    return prisma.usuario.create({
      data: {
        nombreCompleto: nombre,
        correo,
        telefono,
        passwordHash: await bcrypt.hash('Password1!', 10),
      },
    });
  }

  const header = (token: string, barberiaId: string) => ({
    Authorization: `Bearer ${token}`,
    'x-barberia-id': barberiaId,
  });

  /** Alta de reserva por el wizard del CLIENTE (E3-03). `inicioSede` va en el reloj de la sede. */
  function crearReserva(token: string, inicioSede: Date) {
    const { fecha, horaInicio, horaFin } = cita(inicioSede);
    return request(app.getHttpServer())
      .post(`${api}/shops/${sedeA}/appointments`)
      .set(header(token, sedeA))
      .send({
        fecha,
        horaInicio,
        horaFin,
        serviciosIds: [servicioA],
        precioTotalEsperado: 30,
        tipo: 'INDIVIDUAL',
      });
  }

  function cobrar(token: string, reservaId: string, extra: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post(`${api}/shops/${sedeA}/payments`)
      .set(header(token, sedeA))
      .send({ reservaId, monto: 30, metodoPago: 'EFECTIVO', ...extra });
  }

  function anular(token: string, pagoId: string, body: Record<string, unknown>, sede = sedeA) {
    return request(app.getHttpServer())
      .post(`${api}/shops/${sede}/payments/${pagoId}/void`)
      .set(header(token, sede))
      .send(body);
  }

  /**
   * Limpieza idempotente en orden de FK: pagos → reservas → auditoría →
   * usuario_roles → vinculos → configuración/horarios/servicios → sedes →
   * usuarios. Se ejecuta al entrar y al salir, así un run rojo no contamina el
   * siguiente (el `afterAll` de una suite que falla sí corre, pero no siempre
   * cuando el proceso muere a mitad).
   */
  async function limpiar() {
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { in: correos } },
      select: { id: true },
    });
    const idsUsuario = usuarios.map((u) => u.id);

    const sedes = await prisma.barberia.findMany({
      where: {
        OR: [{ nombre: { contains: 'H76' } }, { responsableId: { in: idsUsuario } }],
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
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.reporte.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // El storage del throttler es el mismo para toda la suite: sin este
      // override los logins y los POST de este fichero se comerían el límite
      // global de 120/min y un 429 falsearía el resultado.
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    // Mismo cableado que `main.ts` y que el resto de specs: sin el
    // ValidationPipe el DTO de la anulación no se valida y el `whitelist` que
    // protege el contrato no existe.
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    prisma = app.get(PrismaService);

    await limpiar();

    const roles: Record<string, { id: string }> = {};
    for (const [nombre, ambito] of [
      ['ADMINISTRADOR', 'GLOBAL'],
      ['ADMIN_BARBERIA', 'BARBERIA'],
      ['BARBERO', 'BARBERIA'],
      ['CLIENTE', 'GLOBAL'],
    ] as [string, string][]) {
      roles[nombre] = await prisma.rol.upsert({
        where: { nombre },
        update: {},
        create: { nombre, ambito },
        select: { id: true },
      });
    }

    const duenio = await crearUsuario(correos[0], 'Dueño H76', '9997600001');
    const adminSede = await crearUsuario(correos[1], 'Admin Sede H76', '9997600002');
    const barbero = await crearUsuario(correos[2], 'Barbero H76', '9997600003');
    const cliente = await crearUsuario(correos[3], 'Cliente H76', '9997600004');
    const ajeno = await crearUsuario(correos[4], 'Admin Ajeno H76', '9997600005');
    const duenioB = await crearUsuario(correos[5], 'Dueño B H76', '9997600006');

    adminSedeId = adminSede.id;
    clienteId = cliente.id;

    // La sede A es del `duenio`: así el admin de la sede entra por su ROL y el
    // test no confunde la rama del responsable con la del ADMIN_BARBERIA. La
    // zona horaria se deja en el valor por defecto porque el CHECK de D15 solo
    // admite una (ver `DESFASE_SEDE_MS`).
    sedeA = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia H76 Anulacion',
          telefono: '9997611111',
          ubicacion: 'Sede H76 A',
          codigoAcceso: 'H76ANULA',
          enlaceUnico: 'https://h76.anulacion.test/a',
          responsableId: duenio.id,
        },
      })
    ).id;

    sedeB = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia H76 Vecina',
          telefono: '9997622222',
          ubicacion: 'Sede H76 B',
          codigoAcceso: 'H76VECINA',
          enlaceUnico: 'https://h76.anulacion.test/b',
          responsableId: duenioB.id,
        },
      })
    ).id;

    // Modo AUTOMATICA: la reserva nace CONFIRMADA y sin job de expiración, que
    // es lo que el mostrador necesita para poder cobrarla en el acto.
    for (const sede of [sedeA, sedeB]) {
      await prisma.configuracionBarberia.create({
        data: {
          barberiaId: sede,
          modoReserva: 'AUTOMATICA',
          nuevasReservasActivas: true,
          aceptaIndividual: true,
          aceptaGrupal: true,
          horizonteReservaDias: 30,
        },
      });
      await prisma.horario.createMany({
        data: Array.from({ length: 7 }, (_, dia) => ({
          barberiaId: sede,
          diaSemana: dia + 1,
          horaInicio: new Date('1970-01-01T00:00:00.000Z'),
          horaFin: new Date('1970-01-01T23:59:00.000Z'),
        })),
      });
    }

    servicioA = (
      await prisma.servicio.create({
        data: {
          barberiaId: sedeA,
          nombre: 'Corte H76',
          precio: 30,
          duracionEstimada: 30,
          margenOperativo: 0,
        },
        select: { id: true },
      })
    ).id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminSede.id, rolId: roles['ADMIN_BARBERIA'].id, barberiaId: sedeA },
        { usuarioId: barbero.id, rolId: roles['BARBERO'].id, barberiaId: sedeA },
        // CLIENTE es un rol de ámbito GLOBAL: barberiaId nulo (E1-04).
        { usuarioId: cliente.id, rolId: roles['CLIENTE'].id, barberiaId: null },
        { usuarioId: ajeno.id, rolId: roles['ADMIN_BARBERIA'].id, barberiaId: sedeB },
      ],
    });

    // Sin vínculo ACTIVO el wizard responde 403 NO_VINCULADO (E3-03).
    await prisma.clienteBarberia.create({
      data: { usuarioId: cliente.id, barberiaId: sedeA, estadoVinculacion: 'ACTIVO' },
    });

    const login = async (correo: string) => {
      const res = await request(app.getHttpServer())
        .post(`${api}/auth/login`)
        .send({ correo, password: 'Password1!' });
      expect([200, 201], `login de ${correo} → ${res.status}`).toContain(res.status);
      return res.body.accessToken as string;
    };

    tokenAdmin = await login(correos[1]);
    tokenBarbero = await login(correos[2]);
    tokenCliente = await login(correos[3]);
    tokenAjeno = await login(correos[4]);
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 60_000);

  it('ciclo completo: reserva → cobro → anular sin motivo (422) → anular (200) → base ANULADO → historial → recobro', async () => {
    // 1. El CLIENTE crea la reserva por HTTP (no se siembra la fila a mano).
    const creada = await crearReserva(tokenCliente, inicioCita);
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    expect(creada.body.estado).toBe('CONFIRMADA');
    const reservaId = creada.body.id as string;

    // 2. La sede la cobra: `pagos` en PAGADA y la reserva pasa a COMPLETADA.
    const cobro = await cobrar(tokenAdmin, reservaId);
    expect([200, 201], JSON.stringify(cobro.body)).toContain(cobro.status);
    const pagoId = cobro.body.pago.id as string;

    const trasCobro = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    expect(trasCobro.estadoPago).toBe('PAGADA');
    const reservaTrasCobro = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaId } });
    expect(reservaTrasCobro.estado).toBe('COMPLETADA');
    expect(reservaTrasCobro.completadaAt).toBeInstanceOf(Date);

    // 3a. Sin motivo NO hay anulación: 422 de la regla de negocio.
    const conEspacios = await anular(tokenAdmin, pagoId, { motivo: '   ' });
    expect(conEspacios.status).toBe(422);
    expect(conEspacios.body.codigo).toBe('MOTIVO_REQUERIDO');

    // 3b. Y sin el campo, el DTO corta antes con 400: son dos contratos
    //     distintos y el frontend puede tropezar con cualquiera de los dos.
    const sinCampo = await anular(tokenAdmin, pagoId, {});
    expect(sinCampo.status).toBe(400);
    expect(Array.isArray(sinCampo.body.message)).toBe(true);

    // Nada de lo intentado tocó el dinero: el cobro sigue vivo.
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).estadoPago).toBe('PAGADA');

    // 4. Anulación correcta: 200 y la FILA queda marcada, no borrada.
    const motivo = 'Cobro duplicado en caja: se devolvió el efectivo al cliente';
    const anulacion = await anular(tokenAdmin, pagoId, { motivo });
    expect(anulacion.status).toBe(200);
    expect(anulacion.body.estadoPago).toBe('ANULADO');

    const anulada = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    expect(anulada.estadoPago).toBe('ANULADO');
    expect(anulada.motivoAnulacion).toBe(motivo);
    expect(anulada.anuladoPor).toBe(adminSedeId);
    expect(anulada.anuladoAt).toBeInstanceOf(Date);

    // La reserva conserva su COMPLETADA: el servicio se prestó, lo que se
    // corrige es el cobro (§7.3).
    const reserva = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaId } });
    expect(reserva.estado).toBe('COMPLETADA');
    expect(reserva.completadaAt?.toISOString()).toBe(reservaTrasCobro.completadaAt?.toISOString());

    // D28/§8.3: el motivo y el estado previo real quedan en la auditoría.
    const evento = await prisma.auditoria.findFirst({
      where: { entidad: 'PAGO', entidadId: pagoId, accion: 'PAGO_ANULADO' },
      orderBy: { creadoAt: 'desc' },
    });
    expect(evento).not.toBeNull();
    expect(evento?.usuarioId).toBe(adminSedeId);
    expect(evento?.contexto).toMatchObject({
      reservaId,
      barberiaId: sedeA,
      motivo,
      monto: 30,
      estadoPrevioPago: 'PAGADA',
      nuevoEstadoPago: 'ANULADO',
    });

    // 5. El recibo de la sede refleja el estado vivo, con su motivo y autor.
    const historial = await request(app.getHttpServer())
      .get(`${api}/shops/${sedeA}/payments/history?pageSize=100`)
      .set(header(tokenAdmin, sedeA));
    expect(historial.status, JSON.stringify(historial.body)).toBe(200);
    const recibo = (historial.body.data as any[]).find((fila) => fila.id === pagoId);
    expect(recibo).toMatchObject({
      reservaId,
      estadoPago: 'ANULADO',
      estadoReserva: 'COMPLETADA',
      monto: 30,
      metodoPago: 'EFECTIVO',
      motivoAnulacion: motivo,
      cliente: { id: clienteId },
      servicios: [{ nombre: 'Corte H76', precio: 30 }],
    });
    expect(recibo.anuladoPor).toMatchObject({ id: adminSedeId });
    expect(recibo.registradoPor).toMatchObject({ id: adminSedeId });

    // 6. Y se puede volver a cobrar: la anulación no es un callejón sin salida.
    const recobro = await cobrar(tokenAdmin, reservaId, { metodoPago: 'TARJETA' });
    expect([200, 201]).toContain(recobro.status);

    const recobrada = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    expect(recobrada.estadoPago).toBe('PAGADA');
    expect(recobrada.metodoPago).toBe('TARJETA');
    // El recobro reescribe la MISMA fila (reserva_id es único) y limpia el
    // rastro de la anulación: el historial de anulaciones vive en auditoría.
    expect(recobrada.anuladoAt).toBeNull();
    expect(recobrada.anuladoPor).toBeNull();
    expect(recobrada.motivoAnulacion).toBeNull();
    expect(await prisma.pago.count({ where: { reservaId } })).toBe(1);

    const reservaFinal = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaId } });
    expect(reservaFinal.estado).toBe('COMPLETADA');
    // Reanudar un cobro anulado NO mueve `completada_at`: la cita cerró cuando
    // se prestó el servicio.
    expect(reservaFinal.completadaAt?.toISOString()).toBe(reservaTrasCobro.completadaAt?.toISOString());
  });

  it('403: el BARBERO y el CLIENTE no anulan — cobrar no es corregir el cobro', async () => {
    // Un cobro propio, para no depender del estado que deje el ciclo anterior.
    const creada = await crearReserva(tokenCliente, new Date(inicioCita.getTime() - 3600_000));
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    const cobro = await cobrar(tokenAdmin, creada.body.id);
    expect([200, 201], JSON.stringify(cobro.body)).toContain(cobro.status);
    const pagoId = cobro.body.pago.id as string;

    for (const [quien, token] of [
      ['BARBERO', tokenBarbero],
      ['CLIENTE', tokenCliente],
    ] as const) {
      const res = await anular(token, pagoId, { motivo: `Intento de ${quien}` });
      expect(res.status, `${quien} no debería poder anular`).toBe(403);
    }

    // Ni el pago ni su auditoría se movieron.
    const pago = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    expect(pago.estadoPago).toBe('PAGADA');
    expect(pago.motivoAnulacion).toBeNull();
    expect(
      await prisma.auditoria.count({ where: { entidad: 'PAGO', entidadId: pagoId, accion: 'PAGO_ANULADO' } }),
    ).toBe(0);
  });

  it('404: el cobro de OTRA sede no se alcanza con el alias de esta sede (no se filtra la sede ajena)', async () => {
    const creada = await crearReserva(tokenCliente, new Date(inicioCita.getTime() - 7200_000));
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    const cobro = await cobrar(tokenAdmin, creada.body.id);
    expect([200, 201]).toContain(cobro.status);
    const pagoId = cobro.body.pago.id as string;

    // `ajeno` es ADMIN_BARBERIA de la sede B: el guard lo deja pasar con la
    // cabecera de B, y el servicio responde 404 (no 403) para no confirmar que
    // ese cobro existe en otra sede.
    const res = await anular(tokenAjeno, pagoId, { motivo: 'Cobro de otra sede' }, sedeB);
    expect(res.status).toBe(404);
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).estadoPago).toBe('PAGADA');
  });

  it('409: anular dos veces no es idempotente, y la fila conserva el PRIMER motivo', async () => {
    const creada = await crearReserva(tokenCliente, new Date(inicioCita.getTime() - 10_800_000));
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    const cobro = await cobrar(tokenAdmin, creada.body.id);
    expect([200, 201]).toContain(cobro.status);
    const pagoId = cobro.body.pago.id as string;

    const primera = await anular(tokenAdmin, pagoId, { motivo: 'Primera corrección' });
    expect(primera.status).toBe(200);

    const segunda = await anular(tokenAdmin, pagoId, { motivo: 'Segunda corrección' });
    expect(segunda.status).toBe(409);
    expect(segunda.body.codigo).toBe('ESTADO_INVALIDO');

    const pago = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    expect(pago.estadoPago).toBe('ANULADO');
    expect(pago.motivoAnulacion).toBe('Primera corrección');
  });
});
