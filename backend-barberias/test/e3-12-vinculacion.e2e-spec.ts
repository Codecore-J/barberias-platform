import { Test, TestingModule } from '@nestjs/testing';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';
import { NotificacionService } from '../src/notificacion/application/notificacion.service.js';

const API = '/api/v1';

/**
 * E3-12 · punto 1 · la 6.ª vinculación y el flujo que la resuelve (D10).
 *
 * H67 dejó a la vista lo que este E2E cierra: `vincularCliente` asigna
 * `PENDIENTE_APROBACION` a la 6.ª vinculación y esa fila BLOQUEA el acceso a la
 * sede, pero no existía ninguna ruta que la resolviera, así que el cliente
 * quedaba esperando para siempre. El diseño (spec 01 §1.2 y §7.5) pide que la
 * resuelva el ADMINISTRADOR de la plataforma, no la sede.
 *
 * El caso comprueba el ciclo COMPLETO de los dos desenlaces posibles:
 *
 *   1. pendiente → no autoriza la sede (PATCH /barberias/:id/seleccionar = 403)
 *   2. la plataforma ve la bandeja y aprueba → el cliente ya opera
 *   3. el otro cliente es rechazado con motivo → sigue sin operar
 *
 * `NotificacionService` se reemplaza por un espía: lo que se prueba aquí es que
 * el aviso al cliente se DESPACHA, no el transporte por la cola (que tiene sus
 * propias pruebas y exige Redis). Es el mismo criterio con el que este tipo de
 * specs ya sustituye `ThrottlerStorage`.
 */
describe('E3-12 · aprobación de la 6.ª vinculación (D10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const notificaciones = {
    enviarNotificacion: vi.fn().mockResolvedValue({ id: 'notificacion-1', estado: 'PENDIENTE' }),
    programarRecordatorio: vi.fn(),
    listarNotificacionesUsuario: vi.fn(),
  };

  /** Cinco sedes de relleno: cada vínculo previo es una sede distinta (uk). */
  const sedesRelleno: string[] = [];
  let sedeObjetivoA: string;
  let sedeObjetivoB: string;
  let codigoObjetivoA: string;
  let codigoObjetivoB: string;

  let adminGlobalId: string;
  let adminSedeAId: string;
  let clienteAId: string;
  let clienteBId: string;

  let tokenGlobal: string;
  let tokenAdminSedeA: string;
  let tokenClienteA: string;
  let tokenClienteB: string;

  /** Ids de las dos vinculaciones pendientes (una por cliente). */
  let pendienteA: string;
  let pendienteB: string;

  const sufijo = Date.now();
  const PASSWORD = 'ClaveE312123';

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
      .overrideProvider(NotificacionService)
      .useValue(notificaciones)
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

    const [rolAdministrador, rolAdminBarberia, rolCliente] = await Promise.all([
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

    const hash = await bcrypt.hash(PASSWORD, 10);

    const crearUsuario = async (etiqueta: string, telefono: string) =>
      (
        await prisma.usuario.create({
          data: {
            nombreCompleto: `${etiqueta} E312 ${sufijo}`,
            correo: `${etiqueta}.e312.${sufijo}@test.com`,
            telefono,
            passwordHash: hash,
          },
          select: { id: true },
        })
      ).id;

    adminGlobalId = await crearUsuario('global', `1${String(sufijo).slice(-9)}`);
    adminSedeAId = await crearUsuario('admin.sede.a', `2${String(sufijo).slice(-9)}`);
    clienteAId = await crearUsuario('cliente.a', `3${String(sufijo).slice(-9)}`);
    clienteBId = await crearUsuario('cliente.b', `4${String(sufijo).slice(-9)}`);

    const crearSede = async (etiqueta: string, codigo: string, enlace: string) =>
      (
        await prisma.barberia.create({
          data: {
            nombre: `Barbería ${etiqueta} ${sufijo}`,
            telefono: '955555555',
            ubicacion: `Sede ${etiqueta}`,
            codigoAcceso: codigo,
            enlaceUnico: enlace,
            responsableId: adminGlobalId,
          },
          select: { id: true },
        })
      ).id;

    codigoObjetivoA = `V12A${String(sufijo).slice(-4)}`;
    codigoObjetivoB = `V12B${String(sufijo).slice(-4)}`;

    // Cinco sedes de relleno: el límite de D10 se cuenta por USUARIO, así que
    // los cinco vínculos previos de cada cliente tienen que ser cinco sedes.
    for (let i = 1; i <= 5; i += 1) {
      sedesRelleno.push(
        await crearSede(`relleno ${i}`, `V12R${i}${String(sufijo).slice(-3)}`, `e312-r${i}-${sufijo}`),
      );
    }

    sedeObjetivoA = await crearSede('objetivo A', codigoObjetivoA, `e312-a-${sufijo}`);
    sedeObjetivoB = await crearSede('objetivo B', codigoObjetivoB, `e312-b-${sufijo}`);

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminGlobalId, rolId: rolAdministrador.id, barberiaId: null },
        { usuarioId: adminSedeAId, rolId: rolAdminBarberia.id, barberiaId: sedeObjetivoA },
        { usuarioId: clienteAId, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: clienteBId, rolId: rolCliente.id, barberiaId: null },
      ],
    });

    // Cinco vínculos ACTIVO por cliente: es el estado del que parte D10. Se
    // siembran por Prisma porque el límite se ejerce en la 6.ª, que sí pasa por
    // la ruta real en la primera prueba.
    await prisma.clienteBarberia.createMany({
      data: [clienteAId, clienteBId].flatMap((usuarioId) =>
        sedesRelleno.map((barberiaId, indice) => ({
          usuarioId,
          barberiaId,
          estadoVinculacion: 'ACTIVO',
          esBarberiaActiva: indice === 0,
        })),
      ),
    });

    const correos = await prisma.usuario.findMany({
      where: { id: { in: [adminGlobalId, adminSedeAId, clienteAId, clienteBId] } },
      select: { id: true, correo: true },
    });
    const correoDe = (id: string) => correos.find((u) => u.id === id)!.correo;

    tokenGlobal = await jwtService.signAsync({
      sub: adminGlobalId,
      correo: correoDe(adminGlobalId),
      roles: ['ADMINISTRADOR'],
    });
    tokenAdminSedeA = await jwtService.signAsync({
      sub: adminSedeAId,
      correo: correoDe(adminSedeAId),
      roles: ['ADMIN_BARBERIA'],
    });
    tokenClienteA = await jwtService.signAsync({
      sub: clienteAId,
      correo: correoDe(clienteAId),
      roles: ['CLIENTE'],
    });
    tokenClienteB = await jwtService.signAsync({
      sub: clienteBId,
      correo: correoDe(clienteBId),
      roles: ['CLIENTE'],
    });

    notificaciones.enviarNotificacion.mockClear();
  }, 120_000);

  afterAll(async () => {
    const idsSede = [...sedesRelleno, sedeObjetivoA, sedeObjetivoB];
    const idsUsuario = [adminGlobalId, adminSedeAId, clienteAId, clienteBId];

    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.usuarioRol.deleteMany({
      where: { OR: [{ usuarioId: { in: idsUsuario } }, { barberiaId: { in: idsSede } }] },
    });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.configuracionBarberia.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });

    await app.close();
  }, 60_000);

  // ── Fase 1 · la 6.ª vinculación nace pendiente y no autoriza la sede ───────

  describe('la 6.ª vinculación queda PENDIENTE_APROBACION (D10)', () => {
    it('201: con cinco vínculos previos, la sexta nace pendiente y sin sede activa', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/vincular`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: codigoObjetivoA })
        .expect(201);

      expect(res.body).toMatchObject({
        usuarioId: clienteAId,
        barberiaId: sedeObjetivoA,
        estadoVinculacion: 'PENDIENTE_APROBACION',
        esBarberiaActiva: false,
      });

      pendienteA = res.body.id;
    });

    it('201: el segundo cliente entra igual en la misma situación', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/vincular`)
        .set('Authorization', `Bearer ${tokenClienteB}`)
        .send({ codigoAcceso: codigoObjetivoB })
        .expect(201);

      expect(res.body).toMatchObject({
        usuarioId: clienteBId,
        estadoVinculacion: 'PENDIENTE_APROBACION',
      });

      pendienteB = res.body.id;
    });

    it('el vínculo pendiente NO autoriza la sede: seleccionar responde 403', async () => {
      await request(app.getHttpServer())
        .patch(`${API}/barberias/${sedeObjetivoA}/seleccionar`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(403);
    });

    it('el cliente ve su vinculación pendiente en mi-estado', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/barberias/${sedeObjetivoA}/mi-estado`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(200);

      expect(res.body.estadoVinculacion).toBe('PENDIENTE_APROBACION');
    });
  });

  // ── Fase 2 · bandeja de plataforma (fail-closed) ───────────────────────────

  describe('GET /plataforma/vinculaciones/pendientes', () => {
    it('el ADMINISTRADOR ve las vinculaciones en espera, con cliente, sede y conteo', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/plataforma/vinculaciones/pendientes`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(200);

      expect(res.body).toMatchObject({ page: 1, pageSize: 20 });

      const nuestra = res.body.data.find(
        (fila: { vinculacionId: string }) => fila.vinculacionId === pendienteA,
      );

      expect(nuestra).toMatchObject({
        vinculacionId: pendienteA,
        clienteId: clienteAId,
        barberiaId: sedeObjetivoA,
        estadoVinculacion: 'PENDIENTE_APROBACION',
        // D10: el motivo de que esté pendiente es que ya acumula cinco vínculos.
        vinculacionesDelCliente: 6,
      });
      expect(nuestra.correo).toContain(`cliente.a.e312.${sufijo}@test.com`);
      expect(nuestra.barberiaNombre).toContain('objetivo A');
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('filtra por sede cuando la plataforma lo pide', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/plataforma/vinculaciones/pendientes`)
        .query({ barberiaId: sedeObjetivoB })
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.data[0]).toMatchObject({
        vinculacionId: pendienteB,
        barberiaId: sedeObjetivoB,
      });
    });

    it('el ADMIN_BARBERIA de la sede NO entra en la bandeja de plataforma (403)', async () => {
      await request(app.getHttpServer())
        .get(`${API}/plataforma/vinculaciones/pendientes`)
        .set('Authorization', `Bearer ${tokenAdminSedeA}`)
        .expect(403);
    });

    it('el CLIENTE tampoco (403)', async () => {
      await request(app.getHttpServer())
        .get(`${API}/plataforma/vinculaciones/pendientes`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(403);
    });

    it('sin sesión responde 401', async () => {
      await request(app.getHttpServer())
        .get(`${API}/plataforma/vinculaciones/pendientes`)
        .expect(401);
    });
  });

  // ── Fase 3 · aprobar ──────────────────────────────────────────────────────

  describe('POST /plataforma/vinculaciones/:id/aprobar', () => {
    it('el ADMIN_BARBERIA de la sede no puede aprobar (403) y la fila sigue pendiente', async () => {
      await request(app.getHttpServer())
        .post(`${API}/plataforma/vinculaciones/${pendienteA}/aprobar`)
        .set('Authorization', `Bearer ${tokenAdminSedeA}`)
        .expect(403);

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { id: pendienteA },
        select: { estadoVinculacion: true },
      });
      expect(fila.estadoVinculacion).toBe('PENDIENTE_APROBACION');
    });

    it('404 si la vinculación no existe', async () => {
      await request(app.getHttpServer())
        .post(`${API}/plataforma/vinculaciones/99999999-9999-4999-8999-999999999999/aprobar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(404);
    });

    it('el ADMINISTRADOR aprueba: la vinculación pasa a ACTIVO y queda auditada', async () => {
      notificaciones.enviarNotificacion.mockClear();

      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/vinculaciones/${pendienteA}/aprobar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(200);

      expect(res.body).toMatchObject({
        vinculacionId: pendienteA,
        clienteId: clienteAId,
        barberiaId: sedeObjetivoA,
        estadoVinculacion: 'ACTIVO',
        resueltoPor: adminGlobalId,
      });

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { id: pendienteA },
        select: { estadoVinculacion: true, esBarberiaActiva: true },
      });
      expect(fila.estadoVinculacion).toBe('ACTIVO');

      const evento = await prisma.auditoria.findFirst({
        where: { accion: 'VINCULACION_APROBADA', entidadId: pendienteA },
      });
      expect(evento).not.toBeNull();
      expect(evento?.usuarioId).toBe(adminGlobalId);
      expect(evento?.contexto).toMatchObject({
        barberiaId: sedeObjetivoA,
        clienteId: clienteAId,
        anterior: { estadoVinculacion: 'PENDIENTE_APROBACION' },
        nuevo: { estadoVinculacion: 'ACTIVO' },
      });

      expect(notificaciones.enviarNotificacion).toHaveBeenCalledTimes(1);
      expect(notificaciones.enviarNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: clienteAId, tipo: 'VINCULACION_APROBADA' }),
      );
    });

    it('una vez ACTIVO el cliente ya opera: selecciona la sede y su estado es ACTIVO', async () => {
      await request(app.getHttpServer())
        .patch(`${API}/barberias/${sedeObjetivoA}/seleccionar`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(200);

      const estado = await request(app.getHttpServer())
        .get(`${API}/barberias/${sedeObjetivoA}/mi-estado`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(200);

      expect(estado.body.estadoVinculacion).toBe('ACTIVO');
    });

    it('409 ESTADO_INVALIDO al aprobar dos veces la misma vinculación', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/vinculaciones/${pendienteA}/aprobar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, codigo: 'ESTADO_INVALIDO' });
    });

    it('la vinculación aprobada ya no aparece en la bandeja', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/plataforma/vinculaciones/pendientes`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(200);

      expect(res.body.data.map((fila: { vinculacionId: string }) => fila.vinculacionId)).not.toContain(
        pendienteA,
      );
    });
  });

  // ── Fase 4 · rechazar ─────────────────────────────────────────────────────

  describe('POST /plataforma/vinculaciones/:id/rechazar', () => {
    it('422 MOTIVO_REQUERIDO sin motivo: el rechazo tiene que estar justificado', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/vinculaciones/${pendienteB}/rechazar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({})
        .expect(422);

      expect(res.body).toMatchObject({ statusCode: 422, codigo: 'MOTIVO_REQUERIDO' });
    });

    it('422 MOTIVO_REQUERIDO si el motivo es una palabra suelta', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/vinculaciones/${pendienteB}/rechazar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ motivo: 'no' })
        .expect(422);

      expect(res.body).toMatchObject({ statusCode: 422, codigo: 'MOTIVO_REQUERIDO' });
    });

    it('el ADMINISTRADOR rechaza con motivo: DESVINCULADO, auditado y avisado', async () => {
      notificaciones.enviarNotificacion.mockClear();

      const motivo = 'El cliente ya superó el límite de cinco barberías activas.';

      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/vinculaciones/${pendienteB}/rechazar`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ motivo })
        .expect(200);

      expect(res.body).toMatchObject({
        vinculacionId: pendienteB,
        clienteId: clienteBId,
        barberiaId: sedeObjetivoB,
        estadoVinculacion: 'DESVINCULADO',
        motivo,
      });

      const fila = await prisma.clienteBarberia.findUniqueOrThrow({
        where: { id: pendienteB },
        select: { estadoVinculacion: true, esBarberiaActiva: true },
      });
      expect(fila.estadoVinculacion).toBe('DESVINCULADO');
      expect(fila.esBarberiaActiva).toBe(false);

      const evento = await prisma.auditoria.findFirst({
        where: { accion: 'VINCULACION_RECHAZADA', entidadId: pendienteB },
      });
      expect(evento?.contexto).toMatchObject({ motivo });
      expect(evento?.usuarioId).toBe(adminGlobalId);

      expect(notificaciones.enviarNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: clienteBId, tipo: 'VINCULACION_RECHAZADA' }),
      );
    });

    it('el vínculo rechazado sigue sin autorizar la sede (403)', async () => {
      await request(app.getHttpServer())
        .patch(`${API}/barberias/${sedeObjetivoB}/seleccionar`)
        .set('Authorization', `Bearer ${tokenClienteB}`)
        .expect(403);
    });
  });
});
