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

const API = '/api/v1';

/**
 * E3-13 · Solicitudes de cambio de nombre y responsable (D26/D27).
 *
 * Comprueba dos cosas que la ruta no puede decidir sola:
 *
 *  1. `PATCH /barberias/:id` ya NO renombra: el nombre solo cambia por una
 *     solicitud aprobada por el ADMINISTRADOR, y el teléfono exige la contraseña
 *     actual (D27).
 *  2. Al aprobar un cambio de responsable, la transacción mueve el rol
 *     `ADMIN_BARBERIA` del anterior al nuevo y deja la auditoría.
 *
 * Se usan dos sedes para aislar el estado: la A para las reglas de edición
 * directa y el cambio de nombre; la B para el cambio de responsable.
 */
describe('E3-13 · solicitudes de cambio de nombre y responsable', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let barberiaA: string;
  let barberiaB: string;

  let adminAId: string;
  let adminBId: string;
  let nuevoResponsableId: string;
  let adminGlobalId: string;
  let clienteId: string;

  let tokenAdminA: string;
  let tokenAdminB: string;
  let tokenGlobal: string;
  let tokenCliente: string;

  let rolAdminBarberiaId: string;

  const sufijo = Date.now();
  const PASSWORD_ADMIN_A = 'ClaveAdminA123';

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

    rolAdminBarberiaId = rolAdminBarberia.id;

    const hashAdminA = await bcrypt.hash(PASSWORD_ADMIN_A, 10);

    const crearUsuario = async (etiqueta: string, telefono: string, passwordHash: string) =>
      (
        await prisma.usuario.create({
          data: {
            nombreCompleto: `${etiqueta} E313 ${sufijo}`,
            correo: `${etiqueta}.e313.${sufijo}@test.com`,
            telefono,
            passwordHash,
          },
          select: { id: true, correo: true },
        })
      ).id;

    adminAId = await crearUsuario('admin.a', `1${String(sufijo).slice(-9)}`, hashAdminA);
    adminBId = await crearUsuario('admin.b', `2${String(sufijo).slice(-9)}`, hashAdminA);
    nuevoResponsableId = await crearUsuario(
      'nuevo.responsable',
      `3${String(sufijo).slice(-9)}`,
      hashAdminA,
    );
    adminGlobalId = await crearUsuario('global', `4${String(sufijo).slice(-9)}`, hashAdminA);
    clienteId = await crearUsuario('cliente', `5${String(sufijo).slice(-9)}`, hashAdminA);

    const nombreA = `Barbería E313 A ${sufijo}`;
    const nombreB = `Barbería E313 B ${sufijo}`;

    barberiaA = (
      await prisma.barberia.create({
        data: {
          nombre: nombreA,
          telefono: '911111111',
          ubicacion: 'Sede A E313',
          codigoAcceso: `E3A${String(sufijo).slice(-4)}`,
          enlaceUnico: `e313-a-${sufijo}`,
          responsableId: adminAId,
        },
        select: { id: true },
      })
    ).id;

    barberiaB = (
      await prisma.barberia.create({
        data: {
          nombre: nombreB,
          telefono: '922222222',
          ubicacion: 'Sede B E313',
          codigoAcceso: `E3B${String(sufijo).slice(-4)}`,
          enlaceUnico: `e313-b-${sufijo}`,
          responsableId: adminBId,
        },
        select: { id: true },
      })
    ).id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminAId, rolId: rolAdminBarberia.id, barberiaId: barberiaA },
        { usuarioId: adminBId, rolId: rolAdminBarberia.id, barberiaId: barberiaB },
        { usuarioId: nuevoResponsableId, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: adminGlobalId, rolId: rolAdministrador.id, barberiaId: null },
        { usuarioId: clienteId, rolId: rolCliente.id, barberiaId: null },
      ],
    });

    const correos = await prisma.usuario.findMany({
      where: { id: { in: [adminAId, adminBId, nuevoResponsableId, adminGlobalId, clienteId] } },
      select: { id: true, correo: true },
    });
    const correoDe = (id: string) => correos.find((u) => u.id === id)!.correo;

    tokenAdminA = await jwtService.signAsync({
      sub: adminAId,
      correo: correoDe(adminAId),
      roles: ['ADMIN_BARBERIA'],
    });
    tokenAdminB = await jwtService.signAsync({
      sub: adminBId,
      correo: correoDe(adminBId),
      roles: ['ADMIN_BARBERIA'],
    });
    tokenGlobal = await jwtService.signAsync({
      sub: adminGlobalId,
      correo: correoDe(adminGlobalId),
      roles: ['ADMINISTRADOR'],
    });
    tokenCliente = await jwtService.signAsync({
      sub: clienteId,
      correo: correoDe(clienteId),
      roles: ['CLIENTE'],
    });
  }, 120_000);

  afterAll(async () => {
    const idsSede = [barberiaA, barberiaB];
    const idsUsuario = [adminAId, adminBId, nuevoResponsableId, adminGlobalId, clienteId];

    await prisma.solicitudCambioBarberia.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.auditoria.deleteMany({
      where: {
        OR: [{ entidadId: { in: idsSede } }, { usuarioId: { in: idsUsuario } }],
      },
    });
    await prisma.usuarioRol.deleteMany({
      where: { OR: [{ usuarioId: { in: idsUsuario } }, { barberiaId: { in: idsSede } }] },
    });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.configuracionBarberia.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
    await app.close();
  }, 60_000);

  // ── Fase 2 · limitación de la edición directa (PATCH /barberias/:id) ───────
  describe('PATCH /barberias/:id solo admite descripción, ubicación, logo y teléfono', () => {
    it('422 NOMBRE_REQUIERE_SOLICITUD al intentar cambiar el nombre y la sede no cambia', async () => {
      const antes = await prisma.barberia.findUniqueOrThrow({
        where: { id: barberiaA },
        select: { nombre: true },
      });

      const res = await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ nombre: 'Nombre por la puerta de atrás' })
        .expect(422);

      expect(res.body).toMatchObject({
        statusCode: 422,
        codigo: 'NOMBRE_REQUIERE_SOLICITUD',
      });

      const despues = await prisma.barberia.findUniqueOrThrow({
        where: { id: barberiaA },
        select: { nombre: true },
      });
      expect(despues.nombre).toBe(antes.nombre);
    });

    it('permite descripcion, ubicacion y logoUrl sin contraseña', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          descripcion: 'Descripción E3-13',
          ubicacion: 'Ubicación E3-13',
          logoUrl: 'https://cdn.test.com/logo-e313.png',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        descripcion: 'Descripción E3-13',
        ubicacion: 'Ubicación E3-13',
        logoUrl: 'https://cdn.test.com/logo-e313.png',
      });
    });

    it('422 PASSWORD_REQUERIDA si se intenta cambiar el teléfono sin la contraseña actual (D27)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ telefono: '933333333' })
        .expect(422);

      expect(res.body).toMatchObject({ statusCode: 422, codigo: 'PASSWORD_REQUERIDA' });

      const sede = await prisma.barberia.findUniqueOrThrow({
        where: { id: barberiaA },
        select: { telefono: true },
      });
      expect(sede.telefono).toBe('911111111');
    });

    it('422 PASSWORD_INCORRECTA si la contraseña actual no coincide', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ telefono: '933333333', passwordActual: 'NoEsMiClave123' })
        .expect(422);

      expect(res.body).toMatchObject({ statusCode: 422, codigo: 'PASSWORD_INCORRECTA' });
    });

    it('cambia el teléfono con la contraseña actual correcta', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaA}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ telefono: '933333333', passwordActual: PASSWORD_ADMIN_A })
        .expect(200);

      expect(res.body.telefono).toBe('933333333');
    });

    it('el CLIENTE sigue recibiendo 403 en la edición directa', async () => {
      await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaA}`)
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ descripcion: 'No debería' })
        .expect(403);
    });
  });

  // ── Fase 2 · solicitud de NOMBRE y resolución por el ADMINISTRADOR ────────
  describe('solicitud de cambio de nombre', () => {
    let solicitudId: string;

    it('201: el ADMIN_BARBERIA de la sede crea la solicitud en PENDIENTE', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/${barberiaA}/solicitudes-cambio`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ tipo: 'NOMBRE', valorNuevo: `Barbería Renombrada ${sufijo}` })
        .expect(201);

      expect(res.body).toMatchObject({
        barberiaId: barberiaA,
        tipo: 'NOMBRE',
        estado: 'PENDIENTE',
        solicitadoPor: adminAId,
        resueltoPor: null,
      });

      solicitudId = res.body.id;
    });

    it('409 SOLICITUD_PENDIENTE si se repite el mismo tipo pendiente', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/${barberiaA}/solicitudes-cambio`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ tipo: 'NOMBRE', valorNuevo: `Otro Nombre ${sufijo}` })
        .expect(409);

      expect(res.body).toMatchObject({ codigo: 'SOLICITUD_PENDIENTE' });
    });

    it('403 SOLO_ADMIN_BARBERIA: el admin de OTRA sede no puede solicitar en esta', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/${barberiaA}/solicitudes-cambio`)
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({ tipo: 'NOMBRE', valorNuevo: 'Nombre ajeno' })
        .expect(403);

      expect(res.body).toMatchObject({ codigo: 'SOLO_ADMIN_BARBERIA' });
    });

    it('el ADMINISTRADOR lista las solicitudes y los demás roles reciben 403', async () => {
      const listado = await request(app.getHttpServer())
        .get(`${API}/plataforma/solicitudes-cambio?estado=PENDIENTE`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .expect(200);

      expect(listado.body.total).toBeGreaterThanOrEqual(1);

      const mia = listado.body.data.find((s: any) => s.id === solicitudId);
      expect(mia).toBeDefined();
      expect(mia.barberia.nombre).toContain('E313');

      for (const token of [tokenAdminA, tokenCliente]) {
        await request(app.getHttpServer())
          .get(`${API}/plataforma/solicitudes-cambio`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
    });

    it('aprobar el nombre actualiza la sede, la solicitud y deja auditoría', async () => {
      const nuevoNombre = `Barbería Renombrada ${sufijo}`;

      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/solicitudes-cambio/${solicitudId}/resolver`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ aprobar: true })
        .expect(201);

      expect(res.body).toMatchObject({
        id: solicitudId,
        estado: 'APROBADA',
        resueltoPor: adminGlobalId,
      });

      const sede = await prisma.barberia.findUniqueOrThrow({
        where: { id: barberiaA },
        select: { nombre: true },
      });
      expect(sede.nombre).toBe(nuevoNombre);

      const auditoria = await prisma.auditoria.findFirst({
        where: {
          entidad: 'barberia',
          entidadId: barberiaA,
          accion: 'SOLICITUD_CAMBIO_NOMBRE_APROBADA',
        },
      });
      expect(auditoria).not.toBeNull();
    });

    it('409 ESTADO_INVALIDO al intentar resolver dos veces la misma solicitud', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/solicitudes-cambio/${solicitudId}/resolver`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ aprobar: true })
        .expect(409);

      expect(res.body).toMatchObject({ codigo: 'ESTADO_INVALIDO' });
    });

    it('422 MOTIVO_REQUERIDO y rechazo con motivo en una segunda solicitud', async () => {
      const creada = await request(app.getHttpServer())
        .post(`${API}/barberias/${barberiaA}/solicitudes-cambio`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ tipo: 'NOMBRE', valorNuevo: `Barbería Que No Será ${sufijo}` })
        .expect(201);

      const sinMotivo = await request(app.getHttpServer())
        .post(`${API}/plataforma/solicitudes-cambio/${creada.body.id}/resolver`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ aprobar: false })
        .expect(422);

      expect(sinMotivo.body).toMatchObject({ codigo: 'MOTIVO_REQUERIDO' });

      const rechazada = await request(app.getHttpServer())
        .post(`${API}/plataforma/solicitudes-cambio/${creada.body.id}/resolver`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ aprobar: false, motivoRechazo: 'El nombre propuesto ya está en uso' })
        .expect(201);

      expect(rechazada.body).toMatchObject({
        estado: 'RECHAZADA',
        motivoRechazo: 'El nombre propuesto ya está en uso',
      });

      const sede = await prisma.barberia.findUniqueOrThrow({
        where: { id: barberiaA },
        select: { nombre: true },
      });
      expect(sede.nombre).toBe(`Barbería Renombrada ${sufijo}`);
    });
  });

  // ── Fase 2 · cambio de RESPONSABLE (transacción atómica + rol + auditoría) ─
  describe('solicitud de cambio de responsable', () => {
    let solicitudId: string;

    it('201: el responsable solicita el cambio a un usuario existente', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/${barberiaB}/solicitudes-cambio`)
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({ tipo: 'RESPONSABLE', valorNuevo: nuevoResponsableId })
        .expect(201);

      expect(res.body).toMatchObject({
        tipo: 'RESPONSABLE',
        estado: 'PENDIENTE',
        valorNuevo: nuevoResponsableId,
      });

      solicitudId = res.body.id;
    });

    it('422 RESPONSABLE_INEXISTENTE si el usuario propuesto no existe', async () => {
      // La existencia del nuevo responsable se comprueba ANTES que el duplicado:
      // proponer un uuid que no es de nadie nunca crea una solicitud ambigua.
      const res = await request(app.getHttpServer())
        .post(`${API}/barberias/${barberiaB}/solicitudes-cambio`)
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({ tipo: 'RESPONSABLE', valorNuevo: '99999999-9999-4999-8999-999999999999' })
        .expect(422);

      expect(res.body).toMatchObject({ codigo: 'RESPONSABLE_INEXISTENTE' });
    });

    it('aprobar mueve responsable_id y el rol ADMIN_BARBERIA al nuevo responsable', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/plataforma/solicitudes-cambio/${solicitudId}/resolver`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ aprobar: true })
        .expect(201);

      expect(res.body).toMatchObject({ estado: 'APROBADA', resueltoPor: adminGlobalId });

      // 1. la sede apunta al nuevo responsable
      const sede = await prisma.barberia.findUniqueOrThrow({
        where: { id: barberiaB },
        select: { responsableId: true },
      });
      expect(sede.responsableId).toBe(nuevoResponsableId);

      // 2. el rol ADMIN_BARBERIA ya no está en el anterior
      const rolAnterior = await prisma.usuarioRol.findFirst({
        where: { usuarioId: adminBId, rolId: rolAdminBarberiaId, barberiaId: barberiaB },
      });
      expect(rolAnterior).toBeNull();

      // 3. y sí en el nuevo, con la misma barbería
      const rolNuevo = await prisma.usuarioRol.findFirst({
        where: {
          usuarioId: nuevoResponsableId,
          rolId: rolAdminBarberiaId,
          barberiaId: barberiaB,
        },
      });
      expect(rolNuevo).not.toBeNull();

      // 4. auditado
      const auditoria = await prisma.auditoria.findFirst({
        where: {
          entidad: 'barberia',
          entidadId: barberiaB,
          accion: 'SOLICITUD_CAMBIO_RESPONSABLE_APROBADA',
        },
      });
      expect(auditoria).not.toBeNull();
    });

    it('el antiguo responsable pierde la edición directa de esa sede (403)', async () => {
      await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaB}`)
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({ descripcion: 'Ahora ya no soy el responsable' })
        .expect(403);
    });

    it('el nuevo responsable puede editar la sede', async () => {
      const tokenNuevo = await jwtService.signAsync({
        sub: nuevoResponsableId,
        correo: `nuevo.responsable.e313.${sufijo}@test.com`,
        roles: ['ADMIN_BARBERIA'],
      });

      const res = await request(app.getHttpServer())
        .patch(`${API}/barberias/${barberiaB}`)
        .set('Authorization', `Bearer ${tokenNuevo}`)
        .set('x-barberia-id', barberiaB)
        .send({ descripcion: 'Gestionada por el nuevo responsable' })
        .expect(200);

      expect(res.body.descripcion).toBe('Gestionada por el nuevo responsable');
    });
  });

  // ── Validación de entrada (D30, fail-closed) ─────────────────────────────
  describe('validación de la solicitud', () => {
    it('400 al enviar un tipo fuera del catálogo D26', async () => {
      await request(app.getHttpServer())
        .post(`${API}/barberias/${barberiaA}/solicitudes-cambio`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ tipo: 'COLOR_LOGO', valorNuevo: 'rojo' })
        .expect(400);
    });

    it('400 al enviar campos desconocidos en la resolución (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post(`${API}/plataforma/solicitudes-cambio/${'11111111-1111-4111-8111-111111111111'}/resolver`)
        .set('Authorization', `Bearer ${tokenGlobal}`)
        .send({ aprobar: true, decidir: 'sí' })
        .expect(400);
    });
  });
});
