import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E4-03 · Fidelización: restricción local por inasistencias y reactivación.
 *
 * Recorre el ciclo completo del §5.8 y de D48:
 *   5 inasistencias → restringido en ESA sede → la reserva falla (403) →
 *   el ADMIN_BARBERIA lo perdona → vuelve a reservar → y en la otra sede
 *   nunca estuvo bloqueado.
 *
 * D48 se comprueba de forma explícita: ningún camino del ciclo toca
 * `usuarios.estado_cuenta` (la cuenta global sigue ACTIVA).
 */

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

class ValidadorException extends BadRequestException {
  override getStatus() {
    return 422;
  }
}

describe('E4-03 · fidelización por inasistencias y reactivación', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const correos = {
    adminA: `admin.a.e403-${sufijo}@test.com`,
    adminB: `admin.b.e403-${sufijo}@test.com`,
    cliente: `cliente.e403-${sufijo}@test.com`,
    barbero: `barbero.e403-${sufijo}@test.com`,
  };

  const tokens: Record<string, string> = {};
  const usuarios: Record<string, string> = {};
  const sede: Record<string, string> = {};
  const servicios: Record<string, string> = {};
  /** Las 5 reservas CONFIRMADA del ciclo (fechas pasadas: no ocupan la agenda futura). */
  let reservasDelCiclo: string[] = [];

  // 10 dígitos numéricos exactos: lo exige `RegisterDto` y el sufijo base36
  // podía contener letras.
  const serie = String(Math.floor(Math.random() * 9000) + 1000);
  const telefono = (n: number) => `809${serie}${String(n).padStart(3, '0')}`;

  const registrar = async (correo: string, n: number) => {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({ nombreCompleto: correo, correo, telefono: telefono(n), password: 'Password1!' });
    expect([200, 201, 409]).toContain(res.status);
    // V2.1 · el fixture se da de alta con el teléfono VERIFICADO: sin esto
    // `VerificacionGuard` respondería 403 en la creación de reserva y este
    // test no mide la verificación OTP.
    await prisma.usuario.update({ where: { correo }, data: { telefonoVerificado: true } });

  };

  const login = async (correo: string) => {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password: 'Password1!' });
    expect(res.status).toBe(200);
    tokens[correo] = res.body.accessToken;
  };

  const headers = (correo: string, barberiaId?: string) => ({
    Authorization: `Bearer ${tokens[correo]}`,
    ...(barberiaId ? { 'x-barberia-id': barberiaId } : {}),
  });

  const payloadIndividual = (sedeId: string) => ({
    fecha: fecha(1),
    horaInicio: '10:00',
    horaFin: '10:30',
    serviciosIds: [servicios[sedeId]],
    precioTotalEsperado: 10,
    tipo: 'INDIVIDUAL',
  });

  const payloadGrupal = (sedeId: string) => ({
    fecha: fecha(1),
    horaInicio: '11:00',
    horaFin: '12:00',
    serviciosIds: [servicios[sedeId]],
    precioTotalEsperado: 20,
    tipo: 'GRUPAL',
    participantes: [
      { nombre: 'Ana', esAdultoResponsable: true, servicios: [servicios[sedeId]] },
      { nombre: 'Nico', esAdultoResponsable: false, servicios: [servicios[sedeId]] },
    ],
  });

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

    await registrar(correos.adminA, 1);
    await registrar(correos.adminB, 2);
    await registrar(correos.cliente, 3);
    await registrar(correos.barbero, 4);

    for (const correo of Object.values(correos)) {
      const usuario = await prisma.usuario.findUniqueOrThrow({
        where: { correo },
        select: { id: true },
      });
      usuarios[correo] = usuario.id;
    }

    const rolCliente = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'CLIENTE' } });
    const rolAdmin = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN_BARBERIA' } });
    const rolBarbero = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'BARBERO' } });

    // Dos sedes del mismo dueño/administrador distinto: el aislamiento por sede
    // (D48) se mide entre A y B con el MISMO cliente.
    for (const [clave, adminCorreo, telefonoSede] of [
      ['A', correos.adminA, telefono(11)],
      ['B', correos.adminB, telefono(12)],
    ] as const) {
      const barberia = await prisma.barberia.upsert({
        where: { codigoAcceso: `E403${clave}-${sufijo}`.slice(0, 20) },
        update: { responsableId: usuarios[adminCorreo], estado: 'ACTIVO' },
        create: {
          nombre: `Sede E403-${clave}-${sufijo}`,
          telefono: telefonoSede,
          ubicacion: `Zona ${clave}`,
          estado: 'ACTIVO',
          codigoAcceso: `E403${clave}-${sufijo}`.slice(0, 20),
          enlaceUnico: `https://e403-${clave}-${sufijo}.test`,
          responsableId: usuarios[adminCorreo],
        },
      });
      sede[clave] = barberia.id;

      await prisma.configuracionBarberia.upsert({
        where: { barberiaId: barberia.id },
        update: {
          nuevasReservasActivas: true,
          aceptaIndividual: true,
          aceptaGrupal: true,
          margenGrupalMinutos: 0,
          horizonteReservaDias: 30,
        },
        create: {
          barberiaId: barberia.id,
          modoReserva: 'MANUAL',
          nuevasReservasActivas: true,
          aceptaIndividual: true,
          aceptaGrupal: true,
          margenGrupalMinutos: 0,
          horizonteReservaDias: 30,
        },
      });

      const servicio = await prisma.servicio.create({
        data: {
          barberiaId: barberia.id,
          nombre: `Corte E403-${clave}`,
          precio: 10,
          duracionEstimada: 30,
          margenOperativo: 0,
        },
      });
      servicios[barberia.id] = servicio.id;

      await prisma.horario.createMany({
        data: Array.from({ length: 7 }, (_, dia) => ({
          barberiaId: barberia.id,
          diaSemana: dia + 1,
          horaInicio: new Date('1970-01-01T09:00:00.000Z'),
          horaFin: new Date('1970-01-01T20:00:00.000Z'),
        })),
      });
    }

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: usuarios[correos.adminA], rolId: rolAdmin.id, barberiaId: sede.A },
        { usuarioId: usuarios[correos.adminB], rolId: rolAdmin.id, barberiaId: sede.B },
        { usuarioId: usuarios[correos.barbero], rolId: rolBarbero.id, barberiaId: sede.A },
        { usuarioId: usuarios[correos.cliente], rolId: rolCliente.id, barberiaId: null },
        { usuarioId: usuarios[correos.barbero], rolId: rolCliente.id, barberiaId: null },
        { usuarioId: usuarios[correos.adminA], rolId: rolCliente.id, barberiaId: null },
      ],
      skipDuplicates: true,
    });

    // El cliente está vinculado y ACTIVO en las DOS sedes.
    for (const sedeId of [sede.A, sede.B]) {
      await prisma.clienteBarberia.upsert({
        where: {
          uk_cliente_barberia: { usuarioId: usuarios[correos.cliente], barberiaId: sedeId },
        },
        update: { estadoVinculacion: 'ACTIVO' },
        create: {
          usuarioId: usuarios[correos.cliente],
          barberiaId: sedeId,
          estadoVinculacion: 'ACTIVO',
        },
      });
    }

    // Cinco citas CONFIRMADA ya pasadas: el ciclo las marcará como no presentado.
    reservasDelCiclo = [];
    for (let i = 0; i < 5; i++) {
      const reserva = await prisma.reserva.create({
        data: {
          barberiaId: sede.A,
          clienteId: usuarios[correos.cliente],
          tipoReserva: 'INDIVIDUAL',
          estado: 'CONFIRMADA',
          modoConfirmacion: 'MANUAL',
          fechaCita: new Date(`${fecha(-1 - i)}T00:00:00.000Z`),
          horaInicio: new Date('1970-01-01T10:00:00.000Z'),
          horaFin: new Date('1970-01-01T10:30:00.000Z'),
          totalPagar: 10,
        },
      });
      reservasDelCiclo.push(reserva.id);
    }

    for (const correo of Object.values(correos)) {
      await login(correo);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('VERDE: ciclo completo — límite, bloqueo, perdón y vuelta a reservar', async () => {
    const clienteId = usuarios[correos.cliente];

    // 1. Cinco inasistencias: el contador de ESA sede sube una a una.
    for (let i = 0; i < reservasDelCiclo.length; i++) {
      const res = await request(app.getHttpServer())
        .post(`${api}/shops/${sede.A}/appointments/${reservasDelCiclo[i]}/no-show`)
        .set(headers(correos.adminA, sede.A));

      expect([200, 201]).toContain(res.status);
      expect(res.body.contadorNoPresentado).toBe(i + 1);
      expect(res.body.estaRestringido).toBe(i === 4);
    }

    // 2. La fila de la SEDE A queda restringida con su motivo.
    const enA = await prisma.clienteBarberia.findUniqueOrThrow({
      where: { uk_cliente_barberia: { usuarioId: clienteId, barberiaId: sede.A } },
    });
    expect(enA.contadorNoPresentado).toBe(5);
    expect(enA.estaRestringido).toBe(true);
    expect(enA.motivoRestriccion).toContain('5 inasistencias');

    // D48: la penalización no toca la cuenta global.
    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { id: clienteId },
      select: { estadoCuenta: true },
    });
    expect(cuenta.estadoCuenta).toBe('ACTIVO');

    // 3. El cliente está restringido en A pero NO en B.
    const enB = await prisma.clienteBarberia.findUniqueOrThrow({
      where: { uk_cliente_barberia: { usuarioId: clienteId, barberiaId: sede.B } },
    });
    expect(enB.estaRestringido).toBe(false);
    expect(enB.contadorNoPresentado).toBe(0);

    // 4. La bandeja de la sede lista al cliente con su motivo.
    const listado = await request(app.getHttpServer())
      .get(`${api}/shops/${sede.A}/restricted-clients`)
      .set(headers(correos.adminA, sede.A));

    expect(listado.status).toBe(200);
    expect(listado.body).toHaveLength(1);
    expect(listado.body[0]).toMatchObject({
      clienteId,
      contadorNoPresentado: 5,
      motivoRestriccion: expect.stringContaining('5 inasistencias'),
    });

    // 5. Intentar reservar en A falla con 403 CLIENTE_RESTRINGIDO (individual y grupal).
    for (const payload of [payloadIndividual(sede.A), payloadGrupal(sede.A)]) {
      const intento = await request(app.getHttpServer())
        .post(`${api}/shops/${sede.A}/appointments`)
        .set(headers(correos.cliente, sede.A))
        .send(payload);

      expect(intento.status).toBe(403);
      expect(intento.body).toMatchObject({ statusCode: 403, codigo: 'CLIENTE_RESTRINGIDO' });
    }

    // 6. Aislamiento por sede: en B reserva sin problema.
    const enBReserva = await request(app.getHttpServer())
      .post(`${api}/shops/${sede.B}/appointments`)
      .set(headers(correos.cliente, sede.B))
      .send(payloadIndividual(sede.B));

    expect(enBReserva.status).toBe(201);

    // 7. El ADMIN_BARBERIA de A lo perdona: contador a 0 y sin restricción.
    const reactivacion = await request(app.getHttpServer())
      .post(`${api}/shops/${sede.A}/restricted-clients/${clienteId}/reactivate`)
      .set(headers(correos.adminA, sede.A))
      .send({ motivo: 'Primera vez: se le perdona la racha' });

    expect(reactivacion.status).toBe(200);
    expect(reactivacion.body).toMatchObject({
      clienteId,
      barberiaId: sede.A,
      estaRestringido: false,
      motivoRestriccion: null,
      contadorNoPresentado: 0,
    });

    const trasReactivar = await prisma.clienteBarberia.findUniqueOrThrow({
      where: { uk_cliente_barberia: { usuarioId: clienteId, barberiaId: sede.A } },
    });
    expect(trasReactivar.contadorNoPresentado).toBe(0);
    expect(trasReactivar.estaRestringido).toBe(false);
    expect(trasReactivar.motivoRestriccion).toBeNull();

    // 8. Y el perdón queda auditado con el valor anterior y el nuevo (D28).
    const auditoria = await prisma.auditoria.findFirst({
      where: { accion: 'RESTRICCION_LEVANTADA', entidadId: trasReactivar.id },
      orderBy: { creadoAt: 'desc' },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.contexto).toMatchObject({
      barberiaId: sede.A,
      clienteId,
      motivo: 'Primera vez: se le perdona la racha',
      anterior: { contadorNoPresentado: 5, estaRestringido: true },
      nuevo: { contadorNoPresentado: 0, estaRestringido: false },
    });

    // 9. El cliente vuelve a reservar en A.
    const reservaFinal = await request(app.getHttpServer())
      .post(`${api}/shops/${sede.A}/appointments`)
      .set(headers(correos.cliente, sede.A))
      .send({ ...payloadIndividual(sede.A), horaInicio: '15:00', horaFin: '15:30' });

    expect(reservaFinal.status).toBe(201);

    // 10. La lista de la sede ya está vacía: nadie más está restringido.
    const listadoFinal = await request(app.getHttpServer())
      .get(`${api}/shops/${sede.A}/restricted-clients`)
      .set(headers(correos.adminA, sede.A));
    expect(listadoFinal.body).toHaveLength(0);

    // 11. Y la cuenta global nunca se tocó (D48).
    const cuentaFinal = await prisma.usuario.findUniqueOrThrow({
      where: { id: clienteId },
      select: { estadoCuenta: true },
    });
    expect(cuentaFinal.estadoCuenta).toBe('ACTIVO');
  }, 120_000);

  it('ROJO/VERDE: la bandeja es de la sede — el staff ajeno y el cliente reciben 403', async () => {
    const clienteId = usuarios[correos.cliente];

    const comoBarbero = await request(app.getHttpServer())
      .get(`${api}/shops/${sede.A}/restricted-clients`)
      .set(headers(correos.barbero, sede.A));
    expect(comoBarbero.status).toBe(403);

    const comoCliente = await request(app.getHttpServer())
      .get(`${api}/shops/${sede.A}/restricted-clients`)
      .set(headers(correos.cliente, sede.A));
    expect(comoCliente.status).toBe(403);

    // El admin de la sede B no manda en la A (mismo error de pertenencia que E3-13).
    const adminAjeno = await request(app.getHttpServer())
      .get(`${api}/shops/${sede.A}/restricted-clients`)
      .set(headers(correos.adminB, sede.A));
    expect(adminAjeno.status).toBe(403);

    const reactivarAjeno = await request(app.getHttpServer())
      .post(`${api}/shops/${sede.A}/restricted-clients/${clienteId}/reactivate`)
      .set(headers(correos.adminB, sede.A))
      .send({ motivo: 'No devería poder' });
    expect(reactivarAjeno.status).toBe(403);

    const reactivarComoCliente = await request(app.getHttpServer())
      .post(`${api}/shops/${sede.A}/restricted-clients/${clienteId}/reactivate`)
      .set(headers(correos.cliente, sede.A))
      .send({ motivo: 'Yo mismo me perdono' });
    expect(reactivarComoCliente.status).toBe(403);
  }, 60_000);

  it('sin restricción vigente el perdón responde 422 SIN_RESTRICCION', async () => {
    const clienteId = usuarios[correos.cliente];

    const res = await request(app.getHttpServer())
      .post(`${api}/shops/${sede.A}/restricted-clients/${clienteId}/reactivate`)
      .set(headers(correos.adminA, sede.A))
      .send({ motivo: 'Perdón repetido' });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, codigo: 'SIN_RESTRICCION' });
  }, 60_000);

  it('un cliente sin vinculación con la sede responde 404 (nunca 500)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/shops/${sede.A}/restricted-clients/11111111-1111-4111-8111-111111111111/reactivate`)
      .set(headers(correos.adminA, sede.A))
      .send({ motivo: 'Cliente inexistente en la sede' });

    expect(res.status).toBe(404);
    // El 404 es del VÍNCULO, no de una ruta inexistente: se comprueba el
    // mensaje para que la prueba no pase por accidente sin implementación.
    expect(res.body.message).toBe('El cliente no está vinculado a esta barbería.');
  }, 60_000);

  // ── H54 (E4-03/2) · el cliente VE su estado ────────────────────────────
  it('H54: el cliente ve su contador, su advertencia y su restricción (y solo la suya)', async () => {
    const clienteId = usuarios[correos.cliente];
    const ruta = `${api}/shops/${sede.A}/membership`;

    const fijarVinculo = (data: Record<string, unknown>) =>
      prisma.clienteBarberia.update({
        where: { uk_cliente_barberia: { usuarioId: clienteId, barberiaId: sede.A } },
        data,
      });

    // 1. Estado limpio: el ciclo anterior terminó con el perdón (contador a 0).
    const limpio = await request(app.getHttpServer())
      .get(ruta)
      .set(headers(correos.cliente, sede.A));

    expect(limpio.status).toBe(200);
    expect(limpio.body).toMatchObject({
      barberiaId: sede.A,
      clienteId,
      estadoVinculacion: 'ACTIVO',
      contadorNoPresentado: 0,
      estaRestringido: false,
      motivoRestriccion: null,
      advertencia: false,
      mensaje: null,
      limiteInasistencias: 5,
      inasistenciasParaRestriccion: 5,
    });

    // 2. Tres inasistencias: advertencia visible y el aviso de cuántas faltan.
    await fijarVinculo({ contadorNoPresentado: 3, estaRestringido: false, motivoRestriccion: null });

    const advertido = await request(app.getHttpServer())
      .get(ruta)
      .set(headers(correos.cliente, sede.A));

    expect(advertido.status).toBe(200);
    expect(advertido.body).toMatchObject({
      advertencia: true,
      estaRestringido: false,
      contadorNoPresentado: 3,
      inasistenciasParaRestriccion: 2,
    });
    expect(advertido.body.mensaje).toBe(
      'Estás a 2 inasistencias de ser suspendido en esta barbería.',
    );

    // 3. A una del límite, en singular.
    await fijarVinculo({ contadorNoPresentado: 4 });

    const alLimite = await request(app.getHttpServer())
      .get(ruta)
      .set(headers(correos.cliente, sede.A));

    expect(alLimite.body.mensaje).toBe(
      'Estás a 1 inasistencia de ser suspendido en esta barbería.',
    );

    // 4. Restringido: el mensaje es el motivo que guardó la sede.
    const motivo = 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.';
    await fijarVinculo({
      contadorNoPresentado: 5,
      estaRestringido: true,
      motivoRestriccion: motivo,
    });

    const restringido = await request(app.getHttpServer())
      .get(ruta)
      .set(headers(correos.cliente, sede.A));

    expect(restringido.status).toBe(200);
    expect(restringido.body).toMatchObject({
      estaRestringido: true,
      advertencia: true,
      motivoRestriccion: motivo,
      mensaje: motivo,
      inasistenciasParaRestriccion: 0,
    });

    // 5. Y nadie más usa esta ruta para espiar: el staff de la sede y el admin
    //    de OTRA sede quedan fuera (el guard acota por el `:barberiaId`).
    const comoBarbero = await request(app.getHttpServer())
      .get(ruta)
      .set(headers(correos.barbero, sede.A));
    expect(comoBarbero.status).toBe(403);

    const comoAdminAjeno = await request(app.getHttpServer())
      .get(ruta)
      .set(headers(correos.adminB, sede.A));
    expect(comoAdminAjeno.status).toBe(403);

    // 6. La sede B no ve nada de esto: allí el contador sigue en 0.
    const enB = await request(app.getHttpServer())
      .get(`${api}/shops/${sede.B}/membership`)
      .set(headers(correos.cliente, sede.B));

    expect(enB.status).toBe(200);
    expect(enB.body).toMatchObject({
      barberiaId: sede.B,
      contadorNoPresentado: 0,
      estaRestringido: false,
      mensaje: null,
    });

    // Se deja la fila como estaba: el perdón del ciclo dejó todo en cero.
    await fijarVinculo({ contadorNoPresentado: 0, estaRestringido: false, motivoRestriccion: null });
  }, 120_000);

  it('H54: sin vinculación con la sede → 403 NO_VINCULADO, sin filtrar nada', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/shops/11111111-1111-4111-8111-111111111111/membership`)
      .set(headers(correos.cliente));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, codigo: 'NO_VINCULADO' });
  }, 60_000);
});
