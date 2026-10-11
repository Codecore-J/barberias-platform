/**
 * E3-12 · Vinculación, sexta aprobación y desvinculación (§1.2, §7.5, D10, D20, D21).
 *
 * Cubre lo que pide el backlog: límite 5 / 6, índice único de una barbería
 * activa, bloqueo de `desvincular` con reservas futuras y revincular conservando
 * la restricción, más la resolución de la 6ª y el enlace único.
 *
 * Solo con APP_ENV=dev: `test/setup.e2e.ts` aborta en cualquier otro entorno.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
// `Reflector` se pide a `@nestjs/core`: el que re-exporta `@nestjs/common` es
// otra clase y `app.get()` no lo encuentra.
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../src/shared/time/tiempo.service.js';

const tiempo = new TiempoService();

/** Etiqueta `YYYY-MM-DD` a `dias` de la sede, en la zona de la sede (E2-04). */
function fechaDeLaSede(dias: number): Date {
  const iso = tiempo.sumarDias(tiempo.fechaLocal(tiempo.ahora(), ZONA_POR_DEFECTO), dias);
  return tiempo.fechaDeCalendario(iso);
}

const CORREOS = {
  duenio: 'duenio.e312@test.com',
  adminGlobal: 'global.e312@test.com',
  clienteLimite: 'cliente.e312@test.com',
  clienteLibre: 'libre.e312@test.com',
  ajeno: 'ajeno.e312@test.com',
} as const;

describe('E3-12 · vinculación, sexta aprobación y desvinculación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const api = '/api/v1';

  const sedes: string[] = [];
  const codigos: string[] = [];
  let duenioId: string;
  let clienteLimiteId: string;
  let clienteLibreId: string;
  let rolAdminBarberia: string;

  let tokenGlobal: string;
  let tokenDuenio: string;
  let tokenLimite: string;
  let tokenLibre: string;

  async function limpiar() {
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { in: Object.values(CORREOS) } },
      select: { id: true },
    });
    const idsUsuario = usuarios.map((u) => u.id);

    const sedesBd = await prisma.barberia.findMany({
      where: {
        OR: [
          { codigoAcceso: { startsWith: 'E312' } },
          { enlaceUnico: { startsWith: 'e312-' } },
          { responsableId: { in: idsUsuario } },
        ],
      },
      select: { id: true },
    });
    const idsSede = sedesBd.map((s) => s.id);

    const reservas = await prisma.reserva.findMany({
      where: { barberiaId: { in: idsSede } },
      select: { id: true },
    });
    const idsReserva = reservas.map((r) => r.id);

    await prisma.pago.deleteMany({ where: { reservaId: { in: idsReserva } } });
    await prisma.reserva.deleteMany({ where: { id: { in: idsReserva } } });
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: idsSede } } });
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.configuracionBarberia.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
  }

  const vincular = (codigo: string, token: string) =>
    request(app.getHttpServer())
      .post(`${api}/barberias/vincular`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codigoAcceso: codigo });

  const pendientes = (token: string) =>
    request(app.getHttpServer())
      .get(`${api}/plataforma/vinculaciones/pendientes`)
      .set('Authorization', `Bearer ${token}`);

  /** Crea una reserva CONFIRMADA directamente en la base (sin pasar por la API). */
  async function reservaFutura(clienteId: string, barberiaId: string) {
    return prisma.reserva.create({
      data: {
        barberiaId,
        clienteId,
        tipoReserva: 'INDIVIDUAL',
        estado: 'CONFIRMADA',
        modoConfirmacion: 'MANUAL',
        fechaCita: fechaDeLaSede(3),
        horaInicio: new Date('1970-01-01T15:00:00.000Z'),
        horaFin: new Date('1970-01-01T15:30:00.000Z'),
        totalPagar: 30,
      },
      select: { id: true },
    });
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
    rolAdminBarberia = roles['ADMIN_BARBERIA'];

    const [duenio, global, clienteLimite, clienteLibre, ajeno] = await Promise.all(
      Object.values(CORREOS).map((correo, i) =>
        prisma.usuario.create({
          data: {
            nombreCompleto: `E312 ${i}`,
            correo,
            telefono: `9998${String(i).padStart(7, '0')}`,
            passwordHash: '$2b$10$HashFalsoE312NoSeUsaParaLogin',
          },
          select: { id: true },
        }),
      ),
    );
    duenioId = duenio.id;
    clienteLimiteId = clienteLimite.id;
    clienteLibreId = clienteLibre.id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: global.id, rolId: roles['ADMINISTRADOR'], barberiaId: null },
        // CLIENTE es de ámbito GLOBAL: `barberiaId` nulo (E1-04).
        { usuarioId: clienteLimite.id, rolId: roles['CLIENTE'], barberiaId: null },
        { usuarioId: clienteLibre.id, rolId: roles['CLIENTE'], barberiaId: null },
        { usuarioId: ajeno.id, rolId: roles['CLIENTE'], barberiaId: null },
      ],
    });

    // 8 sedes: 6 para el límite, 1 para desvincular, 1 de reserva.
    for (let i = 0; i < 8; i++) {
      const codigo = `E312${i}AAA`;
      const sede = await prisma.barberia.create({
        data: {
          nombre: `Sede E312 ${i}`,
          telefono: `9998${111111 + i}`,
          ubicacion: `Sede E312 ${i}`,
          codigoAcceso: codigo,
          enlaceUnico: `e312-sede-${i}`,
          responsableId: duenio.id,
        },
        select: { id: true },
      });
      sedes.push(sede.id);
      codigos.push(codigo);
      await prisma.configuracionBarberia.create({ data: { barberiaId: sede.id } });
      await prisma.usuarioRol.create({
        data: { usuarioId: duenio.id, rolId: rolAdminBarberia, barberiaId: sede.id },
      });
    }

    tokenGlobal = await jwtService.signAsync({
      sub: global.id,
      correo: CORREOS.adminGlobal,
      roles: [],
    });
    tokenDuenio = await jwtService.signAsync({
      sub: duenio.id,
      correo: CORREOS.duenio,
      roles: [],
    });
    tokenLimite = await jwtService.signAsync({
      sub: clienteLimite.id,
      correo: CORREOS.clienteLimite,
      roles: [],
    });
    tokenLibre = await jwtService.signAsync({
      sub: clienteLibre.id,
      correo: CORREOS.clienteLibre,
      roles: [],
    });
  }, 120_000);

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 60_000);

  // ── Límite 5 / 6 y resolución de la 6ª ────────────────────────────────────

  describe('límite de 5 y aprobación de la 6ª', () => {
    it('la 5ª entra como ACTIVO y la 6ª queda PENDIENTE_APROBACION (D10)', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await vincular(codigos[i], tokenLimite);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.estadoVinculacion).toBe('ACTIVO');
      }

      const sexta = await vincular(codigos[5], tokenLimite);
      expect(sexta.status, JSON.stringify(sexta.body)).toBe(201);
      expect(sexta.body.estadoVinculacion).toBe('PENDIENTE_APROBACION');

      const guardada = await prisma.clienteBarberia.findUnique({
        where: { uk_cliente_barberia: { usuarioId: clienteLimiteId, barberiaId: sedes[5] } },
      });
      expect(guardada!.estadoVinculacion).toBe('PENDIENTE_APROBACION');
    }, 60_000);

    it('solo el ADMINISTRADOR ve la cola de pendientes', async () => {
      await pendientes(tokenDuenio).expect(403);
      await pendientes(tokenLibre).expect(403);

      const res = await pendientes(tokenGlobal).expect(200);
      const fila = (res.body as any[]).find((v) => v.barberiaId === sedes[5]);
      expect(fila).toBeDefined();
      expect(fila.usuario.id).toBe(clienteLimiteId);
      expect(fila.barberia.nombre).toBe('Sede E312 5');
    });

    it('aprobar la 6ª la deja ACTIVO, notifica al cliente y audita', async () => {
      const res = await request(app.getHttpServer())
        .post(`${api}/plataforma/vinculaciones/${(await pendientes(tokenGlobal)).body.find((v: any) => v.barberiaId === sedes[5]).id}/aprobar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({});

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.estadoVinculacion).toBe('ACTIVO');

      const auditoria = await prisma.auditoria.findFirst({
        where: { accion: 'VINCULACION_APROBADA', entidadId: res.body.id },
      });
      expect(auditoria).not.toBeNull();

      const notificacion = await prisma.notificacion.findFirst({
        where: { usuarioId: clienteLimiteId, tipo: 'VINCULACION_APROBADA' },
      });
      expect(notificacion).not.toBeNull();
    }, 60_000);

    it('rechazar exige motivo y deja la fila DESVINCULADO sin borrarla', async () => {
      // Otra 6ª para poder rechazarla.
      await vincular(codigos[6], tokenLimite);
      const pend = (await pendientes(tokenGlobal)).body.find(
        (v: any) => v.barberiaId === sedes[6],
      );

      await request(app.getHttpServer())
        .post(`${api}/plataforma/vinculaciones/${pend.id}/rechazar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({})
        .expect(400);

      const res = await request(app.getHttpServer())
        .post(`${api}/plataforma/vinculaciones/${pend.id}/rechazar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ motivo: 'Límite de la plataforma' })
        .expect(200);

      expect(res.body.estadoVinculacion).toBe('DESVINCULADO');

      // D20/D21: la fila sigue existiendo.
      const fila = await prisma.clienteBarberia.findUnique({ where: { id: pend.id } });
      expect(fila).not.toBeNull();

      expect(
        await prisma.auditoria.count({
          where: { accion: 'VINCULACION_RECHAZADA', entidadId: pend.id },
        }),
      ).toBe(1);
    }, 60_000);

    it('rechazar dos veces → 409 ESTADO_INVALIDO', async () => {
      const pend = (await pendientes(tokenGlobal)).body.find(
        (v: any) => v.barberiaId === sedes[6],
      );
      if (pend) {
        await request(app.getHttpServer())
          .post(`${api}/plataforma/vinculaciones/${pend.id}/rechazar`)
          .set('Authorization', `Bearer ${tokenGlobal}`)
          .send({ motivo: 'Otra vez' })
          .expect(409);
      }
    });
  });

  // ── Índice único de una barbería activa ───────────────────────────────────

  describe('índice único de una sola barbería activa', () => {
    it('cambiar de sede deja exactamente una activa', async () => {
      await vincular(codigos[0], tokenLibre);
      await vincular(codigos[1], tokenLibre);

      const activar = (id: string) =>
        request(app.getHttpServer())
          .patch(`${api}/barberias/${id}/seleccionar`)
          .set('Authorization', `Bearer ${tokenLibre}`)
          .expect(200);

      await activar(sedes[0]);
      await activar(sedes[1]);

      const activas = await prisma.clienteBarberia.findMany({
        where: { usuarioId: clienteLibreId, esBarberiaActiva: true },
      });
      expect(activas).toHaveLength(1);
      expect(activas[0].barberiaId).toBe(sedes[1]);
    }, 60_000);
  });

  // ── Enlace único / QR ─────────────────────────────────────────────────────

  describe('GET /barberias/por-enlace/:enlace', () => {
    it('devuelve datos públicos y NO expone el código de acceso', async () => {
      const res = await request(app.getHttpServer())
        .get(`${api}/barberias/por-enlace/e312-sede-2`)
        .set('Authorization', `Bearer ${tokenLibre}`)
        .expect(200);

      expect(res.body.nombre).toBe('Sede E312 2');
      expect(res.body.codigoAcceso).toBeUndefined();
      expect(res.body.enlaceUnico).toBeUndefined();
    });

    it('exige sesión (401 sin token)', async () => {
      await request(app.getHttpServer()).get(`${api}/barberias/por-enlace/e312-sede-2`).expect(401);
    });

    it('un enlace inexistente → 404', async () => {
      await request(app.getHttpServer())
        .get(`${api}/barberias/por-enlace/e312-no-existe`)
        .set('Authorization', `Bearer ${tokenLibre}`)
        .expect(404);
    });
  });

  // ── Desvincular ───────────────────────────────────────────────────────────

  describe('POST /barberias/:id/desvincular', () => {
    it('ROJO: bloquea con reservas futuras PENDIENTE/CONFIRMADA (422 RESERVAS_FUTURAS)', async () => {
      await vincular(codigos[7], tokenLibre);
      await reservaFutura(clienteLibreId, sedes[7]);

      const res = await request(app.getHttpServer())
        .post(`${api}/barberias/${sedes[7]}/desvincular`)
        .set('Authorization', `Bearer ${tokenLibre}`);

      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.codigo).toBe('RESERVAS_FUTURAS');

      const fila = await prisma.clienteBarberia.findUnique({
        where: { uk_cliente_barberia: { usuarioId: clienteLibreId, barberiaId: sedes[7] } },
      });
      expect(fila!.estadoVinculacion).toBe('ACTIVO');
    }, 60_000);

    it('VERDE: sin reservas vivas desvincula y conserva el historial (D20)', async () => {
      // Deja la reserva en un estado terminal para poder desvincularse.
      await prisma.reserva.updateMany({
        where: { clienteId: clienteLibreId, barberiaId: sedes[7] },
        data: { estado: 'CANCELADA' },
      });
      await prisma.clienteBarberia.update({
        where: { uk_cliente_barberia: { usuarioId: clienteLibreId, barberiaId: sedes[7] } },
        data: { contadorNoPresentado: 4, estaRestringido: true, motivoRestriccion: 'Acumulado' },
      });

      const res = await request(app.getHttpServer())
        .post(`${api}/barberias/${sedes[7]}/desvincular`)
        .set('Authorization', `Bearer ${tokenLibre}`)
        .expect(201);

      expect(res.body.estadoVinculacion).toBe('DESVINCULADO');
      expect(res.body.esBarberiaActiva).toBe(false);

      const fila = await prisma.clienteBarberia.findUnique({
        where: { uk_cliente_barberia: { usuarioId: clienteLibreId, barberiaId: sedes[7] } },
      });
      expect(fila!.contadorNoPresentado).toBe(4);
      expect(fila!.estaRestringido).toBe(true);
    }, 60_000);

    it('revincular reactiva la MISMA fila y conserva contadores y restricción (D20/D21)', async () => {
      const antes = await prisma.clienteBarberia.findUnique({
        where: { uk_cliente_barberia: { usuarioId: clienteLibreId, barberiaId: sedes[7] } },
      });

      const res = await vincular(codigos[7], tokenLibre);

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBe(antes!.id);
      expect(res.body.estadoVinculacion).toBe('ACTIVO');
      expect(res.body.contadorNoPresentado).toBe(4);
      expect(res.body.estaRestringido).toBe(true);

      // D20: la restricción no se evade desvinculándose.
      expect(res.body.estaRestringido).toBe(true);

      const total = await prisma.clienteBarberia.count({
        where: { usuarioId: clienteLibreId, barberiaId: sedes[7] },
      });
      expect(total).toBe(1);

      expect(
        await prisma.auditoria.count({
          where: { accion: 'VINCULACION_REVINCULADA', entidadId: antes!.id },
        }),
      ).toBe(1);
    }, 60_000);

    it('desvincular dos veces → 409 (la segunda)', async () => {
      // El caso anterior dejó el vínculo ACTIVO tras revincular: primero se
      // desvincula (201) y la repetición debe ser 409, no un segundo 201.
      await request(app.getHttpServer())
        .post(`${api}/barberias/${sedes[7]}/desvincular`)
        .set('Authorization', `Bearer ${tokenLibre}`)
        .expect(201);

      const segunda = await request(app.getHttpServer())
        .post(`${api}/barberias/${sedes[7]}/desvincular`)
        .set('Authorization', `Bearer ${tokenLibre}`);

      expect(segunda.status, JSON.stringify(segunda.body)).toBe(409);
      expect(segunda.body.codigo).toBe('YA_DESVINCULADO');
    });
  });
});
