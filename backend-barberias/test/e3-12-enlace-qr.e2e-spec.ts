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
 * E3-12/2 · punto 2 · la puerta de entrada del cliente (regla 1.10).
 *
 * Hasta aquí la vinculación solo existía por el código de acceso que el staff
 * dictaba a mano (`POST /shops/link`) y el `enlace_unico` de la sede
 * —columna que existe desde la migración base— no lo consumía NADIE: no había
 * forma de que el dueño de una sede compartiera su puerta de entrada ni de que
 * un cliente entrara por un enlace o un QR.
 *
 * Este E2E comprueba el ciclo COMPLETO, en el orden en que lo vive la gente:
 *
 *   1. el staff (ADMIN_BARBERIA de la sede o ADMINISTRADOR global) LEE su
 *      invitación (`GET /barberias/:id/invitacion`) y con ella puede compartir
 *      el código y el enlace único;
 *   2. el cliente la CONSUME (`POST /mi-estado/unirse`) —por código o por
 *      enlace, con el `enlaceUnico` tal y como viaja en el QR—;
 *   3. el vínculo nace `ACTIVO` y la sede aparece en `GET /mi-estado/barberias`
 *      (el listado que la pantalla recarga tras el 200), y con cinco vínculos
 *      previos la sexta nace `PENDIENTE_APROBACION` (D10).
 *
 * Las dos puertas son la MISMA ruta y la MISMA lógica blindada: `unirse` no
 * reimplementa el conteo ni la reapertura de H71, solo resuelve la sede por el
 * enlace cuando el cliente no trae el código.
 *
 * `NotificacionService` se sustituye por un espía, como en el resto de specs de
 * este flujo: lo que se prueba aquí es la vinculación, no el transporte por la
 * cola (que exige Redis y tiene sus propias pruebas).
 */
describe('E3-12/2 · enlace único y QR: la puerta de entrada del cliente (regla 1.10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const notificaciones = {
    enviarNotificacion: vi.fn().mockResolvedValue({ id: 'notificacion-1', estado: 'PENDIENTE' }),
    programarRecordatorio: vi.fn(),
    listarNotificacionesUsuario: vi.fn(),
  };

  /** Cinco sedes de relleno: el límite de D10 se cuenta por USUARIO. */
  const sedesRelleno: string[] = [];
  let sedeA: string;
  let sedeB: string;
  let sedeInactiva: string;
  let codigoA: string;
  let enlaceA: string;
  const codigoB = `QRB${String(Date.now()).slice(-5)}`;
  const enlaceB = `e312qr-b-${Date.now()}`;
  const codigoInactiva = `QRI${String(Date.now()).slice(-5)}`;

  let adminGlobalId: string;
  let adminSedeAId: string;
  let adminSedeBId: string;
  let barberoAId: string;
  let clienteAId: string;
  let clienteBId: string;

  let tokenGlobal: string;
  let tokenAdminSedeA: string;
  let tokenAdminSedeB: string;
  let tokenBarberoA: string;
  let tokenClienteA: string;
  let tokenClienteB: string;

  const sufijo = Date.now();
  // Clave de USO EXCLUSIVO de esta prueba: se hashea con bcrypt al crear los
  // usuarios del caso y no existe en ningún entorno, ni se lee de ninguno. No es
  // un secreto, pero se parece lo bastante a uno como para que el escáner de
  // secretos del CI (`gitleaks`, paso «Scan for Secrets») lo marque como
  // `generic-api-key` y detenga el pipeline. El comentario `gitleaks:allow` es la
  // excepción oficial del escáner para un falso positivo confirmado, y va en la
  // MISMA línea del hallazgo a propósito: así el perdón viaja con el valor y no
  // depende de una huella (commit + regla + línea) que deja de valer en cuanto el
  // archivo se mueve.
  const PASSWORD = 'ClaveQr12345'; // gitleaks:allow

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

    const [rolAdministrador, rolAdminBarberia, rolBarbero, rolCliente] = await Promise.all([
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
        where: { nombre: 'BARBERO' },
        update: {},
        create: { nombre: 'BARBERO', ambito: 'BARBERIA' },
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
            telefonoVerificado: true,
            nombreCompleto: `${etiqueta} E312QR ${sufijo}`,
            correo: `${etiqueta}.e312qr.${sufijo}@test.com`,
            telefono,
            passwordHash: hash,
          },
          select: { id: true },
        })
      ).id;

    adminGlobalId = await crearUsuario('global', `1${String(sufijo).slice(-9)}`);
    adminSedeAId = await crearUsuario('admin.sede.a', `2${String(sufijo).slice(-9)}`);
    adminSedeBId = await crearUsuario('admin.sede.b', `3${String(sufijo).slice(-9)}`);
    barberoAId = await crearUsuario('barbero.a', `4${String(sufijo).slice(-9)}`);
    clienteAId = await crearUsuario('cliente.a', `5${String(sufijo).slice(-9)}`);
    clienteBId = await crearUsuario('cliente.b', `6${String(sufijo).slice(-9)}`);

    const crearSede = async (
      etiqueta: string,
      codigo: string,
      enlace: string,
      estado = 'ACTIVO',
    ) =>
      (
        await prisma.barberia.create({
          data: {
            nombre: `Barbería ${etiqueta} ${sufijo}`,
            telefono: '955555555',
            ubicacion: `Sede ${etiqueta}`,
            codigoAcceso: codigo,
            enlaceUnico: enlace,
            estado,
            responsableId: adminGlobalId,
          },
          select: { id: true },
        })
      ).id;

    codigoA = `QRA${String(sufijo).slice(-5)}`;
    enlaceA = `e312qr-a-${sufijo}`;

    for (let i = 1; i <= 5; i += 1) {
      sedesRelleno.push(
        await crearSede(`relleno ${i}`, `QRR${i}${String(sufijo).slice(-4)}`, `e312qr-r${i}-${sufijo}`),
      );
    }

    sedeA = await crearSede('objetivo A', codigoA, enlaceA);
    sedeB = await crearSede('objetivo B', codigoB, enlaceB);
    // E2-07: una sede suspendida no vende y su puerta de entrada no puede
    // entregar un vínculo.
    sedeInactiva = await crearSede('inactiva', codigoInactiva, `e312qr-off-${sufijo}`, 'INACTIVO');

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminGlobalId, rolId: rolAdministrador.id, barberiaId: null },
        { usuarioId: adminSedeAId, rolId: rolAdminBarberia.id, barberiaId: sedeA },
        { usuarioId: adminSedeBId, rolId: rolAdminBarberia.id, barberiaId: sedeB },
        { usuarioId: barberoAId, rolId: rolBarbero.id, barberiaId: sedeA },
        { usuarioId: clienteAId, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: clienteBId, rolId: rolCliente.id, barberiaId: null },
      ],
    });

    // El cliente B llega con CINCO vínculos vivos: es el estado del que parte
    // D10, y su sexta vinculación —por enlace— tiene que nacer pendiente.
    await prisma.clienteBarberia.createMany({
      data: sedesRelleno.map((barberiaId, indice) => ({
        usuarioId: clienteBId,
        barberiaId,
        estadoVinculacion: 'ACTIVO',
        esBarberiaActiva: indice === 0,
      })),
    });

    const correos = await prisma.usuario.findMany({
      where: {
        id: {
          in: [adminGlobalId, adminSedeAId, adminSedeBId, barberoAId, clienteAId, clienteBId],
        },
      },
      select: { id: true, correo: true },
    });
    const correoDe = (id: string) => correos.find((u) => u.id === id)!.correo;

    const firmar = (id: string, roles: string[]) =>
      jwtService.signAsync({ sub: id, correo: correoDe(id), roles });

    tokenGlobal = await firmar(adminGlobalId, ['ADMINISTRADOR']);
    tokenAdminSedeA = await firmar(adminSedeAId, ['ADMIN_BARBERIA']);
    tokenAdminSedeB = await firmar(adminSedeBId, ['ADMIN_BARBERIA']);
    tokenBarberoA = await firmar(barberoAId, ['BARBERO']);
    tokenClienteA = await firmar(clienteAId, ['CLIENTE']);
    tokenClienteB = await firmar(clienteBId, ['CLIENTE']);

    notificaciones.enviarNotificacion.mockClear();
  }, 120_000);

  afterAll(async () => {
    const idsSede = [...sedesRelleno, sedeA, sedeB, sedeInactiva];
    const idsUsuario = [adminGlobalId, adminSedeAId, adminSedeBId, barberoAId, clienteAId, clienteBId];

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

  // ── Fase 1 · el staff lee su puerta de entrada ────────────────────────────

  describe('GET /barberias/:id/invitacion', () => {
    it('el ADMIN_BARBERIA de la sede recibe su código y su enlace único', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/shops/${sedeA}/invitation`)
        .set('Authorization', `Bearer ${tokenAdminSedeA}`)
        .expect(200);

      expect(res.body).toMatchObject({
        barberiaId: sedeA,
        codigoAcceso: codigoA,
        enlaceUnico: enlaceA,
      });
      expect(res.body.nombre).toContain('objetivo A');
    });

    it('el ADMINISTRADOR global también la lee, en cualquier sede (E1-04)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/shops/${sedeB}/invitation`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(200);

      expect(res.body).toMatchObject({ barberiaId: sedeB, codigoAcceso: codigoB });
    });

    it('el ADMIN_BARBERIA de OTRA sede recibe 403: la puerta de entrada no se presta', async () => {
      await request(app.getHttpServer())
        .get(`${API}/shops/${sedeA}/invitation`)
        .set('Authorization', `Bearer ${tokenAdminSedeB}`)
        .expect(403);
    });

    it('un BARBERO de la misma sede recibe 403: no es quien comparte la entrada', async () => {
      await request(app.getHttpServer())
        .get(`${API}/shops/${sedeA}/invitation`)
        .set('Authorization', `Bearer ${tokenBarberoA}`)
        .expect(403);
    });

    it('un CLIENTE de la sede recibe 403', async () => {
      await request(app.getHttpServer())
        .get(`${API}/shops/${sedeA}/invitation`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(403);
    });

    it('sin token responde 401 (fail-closed)', async () => {
      await request(app.getHttpServer()).get(`${API}/shops/${sedeA}/invitation`).expect(401);
    });

    it('una sede inexistente responde 404', async () => {
      await request(app.getHttpServer())
        .get(`${API}/barberias/11111111-1111-4111-8111-111111111111/invitacion`)
        .set('Authorization', `Bearer ${tokenAdminSedeA}`)
        .expect(404);
    });
  });

  // ── Fase 2 · el cliente consume la invitación ─────────────────────────────

  describe('POST /mi-estado/unirse', () => {
    it('ciclo completo: el cliente usa el código que el staff le entregó y queda ACTIVO', async () => {
      const invitacion = await request(app.getHttpServer())
        .get(`${API}/shops/${sedeA}/invitation`)
        .set('Authorization', `Bearer ${tokenAdminSedeA}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: invitacion.body.codigoAcceso })
        .expect(200);

      expect(res.body).toMatchObject({
        usuarioId: clienteAId,
        barberiaId: sedeA,
        estadoVinculacion: 'ACTIVO',
      });

      // El listado que la pantalla recarga tras el 200 ya trae la sede nueva.
      const listado = await request(app.getHttpServer())
        .get(`${API}/mi-estado/barberias`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .expect(200);

      const sedes = Array.isArray(listado.body) ? listado.body : listado.body.data;
      expect(sedes.map((s: any) => s.id)).toContain(sedeA);
    });

    it('es idempotente: volver a introducir el código devuelve el MISMO vínculo', async () => {
      const primera = await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: codigoA })
        .expect(200);

      const segunda = await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: codigoA })
        .expect(200);

      expect(segunda.body.id).toBe(primera.body.id);
      expect(segunda.body.estadoVinculacion).toBe('ACTIVO');

      const filas = await prisma.clienteBarberia.count({
        where: { usuarioId: clienteAId, barberiaId: sedeA },
      });
      expect(filas).toBe(1);
    });

    it('el enlace único del QR entra igual, y con cinco vínculos previos nace PENDIENTE_APROBACION (D10)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteB}`)
        .send({ enlaceUnico: enlaceB })
        .expect(200);

      expect(res.body).toMatchObject({
        usuarioId: clienteBId,
        barberiaId: sedeB,
        estadoVinculacion: 'PENDIENTE_APROBACION',
        esBarberiaActiva: false,
      });
    });

    it('el enlace del QR se acepta tal y como lo pega un humano: con espacios y en mayúsculas', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ enlaceUnico: `  ${enlaceB.toUpperCase()}  ` })
        .expect(200);

      expect(res.body).toMatchObject({ barberiaId: sedeB, estadoVinculacion: 'ACTIVO' });
    });

    it('una sede INACTIVA no entrega vínculo: 404 (E2-07)', async () => {
      await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: codigoInactiva })
        .expect(404);
    });

    it('un código o un enlace inexistente responde 404', async () => {
      await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: 'NOEXISTE' })
        .expect(404);

      await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ enlaceUnico: 'enlace-que-no-existe' })
        .expect(404);
    });

    it('sin código ni enlace responde 422 INVITACION_REQUERIDA (contrato D40)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({})
        .expect(422);

      expect(res.body).toMatchObject({ statusCode: 422, codigo: 'INVITACION_REQUERIDA' });
    });

    it('con las DOS puertas a la vez responde 422 INVITACION_AMBIGUA', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenClienteA}`)
        .send({ codigoAcceso: codigoA, enlaceUnico: enlaceA })
        .expect(422);

      expect(res.body).toMatchObject({ statusCode: 422, codigo: 'INVITACION_AMBIGUA' });
    });

    it('un BARBERO no entra por aquí: la ruta es del CLIENTE (403)', async () => {
      await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .set('Authorization', `Bearer ${tokenBarberoA}`)
        .send({ codigoAcceso: codigoA })
        .expect(403);
    });

    it('sin token responde 401', async () => {
      await request(app.getHttpServer())
        .post(`${API}/mi-estado/unirse`)
        .send({ codigoAcceso: codigoA })
        .expect(401);
    });
  });
});
