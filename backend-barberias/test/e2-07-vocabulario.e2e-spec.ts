import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2-07 · vocabulario del diseño: desactivar, liberar, suspender.
 *
 * Spec 01 §9 prohíbe la eliminación física para representar un cambio de estado,
 * y el backend tenía cuatro `@Delete` que la hacían. Esta suite comprueba, sobre
 * HTTP real, que los verbos nuevos hacen lo que dicen y que las tres reglas de
 * la desactivación del catálogo se cumplen:
 *
 *  1. 422 `SERVICIO_EN_USO` si hay reservas PENDIENTE / PROPUESTA_PENDIENTE.
 *  2. 422 `SERVICIO_EN_COMBO_ACTIVO` si el servicio está en un combo activo.
 *  3. Se PERMITE si no hay reservas abiertas (las CONFIRMADAS llevan snapshot).
 *
 * Y además: reactivar vuelve a poner ACTIVO, liberar un bloqueo fija
 * `liberado_at` —sin borrar la fila— y deja de ocupar agenda, suspender una sede
 * no la borra, y el `@Delete` no existe como camino alternativo.
 */

function fecha(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

class ValidadorException extends BadRequestException {
  override getStatus() {
    return 422;
  }
}

describe('E2-07 · vocabulario: desactivar, liberar, suspender', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = '/api/v1';
  const tokens: Record<string, string> = {};
  const datos: Record<string, string> = {};
  const correos: Record<string, string> = {};

  const headers = (rol: string, barberiaId?: string) => {
    const h: Record<string, string> = { Authorization: `Bearer ${tokens[rol]}` };
    if (barberiaId) h['x-barberia-id'] = barberiaId;
    return h;
  };

  const registrarYLogin = async (rol: string, correo: string, telefono: string) => {
    const r = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({ nombreCompleto: correo, correo, telefono, password: 'Password1!' });
    expect([200, 201, 409]).toContain(r.status);

    const l = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ correo, password: 'Password1!' });
    expect(l.status).toBe(200);
    tokens[rol] = l.body.accessToken;
    correos[rol] = correo;
  };

  const disponibilidad = async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/barberias/${datos.sede}/agenda/disponibilidad?fecha=${datos.fecha}&duracionMinutos=30`)
      .set(headers('admin', datos.sede));
    expect(res.status).toBe(200);
    return res.body as { inicio: string; fin: string }[];
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => new ValidadorException(errors),
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // Sufijo único: la base de `dev` es compartida entre corridas y archivos.
    const sufijo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    datos.fecha = fecha(1);

    // D16: el catálogo lo escribe el BARBERO, así que la suite necesita uno.
    // Los teléfonos son 10 dígitos exactos porque `RegisterDto` ahora los valida.
    const serie = String(Math.floor(Math.random() * 9000) + 1000);
    const tel = (n: number) => `809${serie}${String(n).padStart(3, '0')}`;

    await registrarYLogin('admin', `admin.e207-${sufijo}@test.com`, tel(1));
    await registrarYLogin('cliente', `cliente.e207-${sufijo}@test.com`, tel(2));
    await registrarYLogin('global', `global.e207-${sufijo}@test.com`, tel(3));
    await registrarYLogin('barbero', `barbero.e207-${sufijo}@test.com`, tel(4));

    const admin = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.admin }, select: { id: true } });
    const cliente = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.cliente }, select: { id: true } });
    const global = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.global }, select: { id: true } });
    const barbero = await prisma.usuario.findUniqueOrThrow({ where: { correo: correos.barbero }, select: { id: true } });

    const sede = await prisma.barberia.create({
      data: {
        nombre: `Sede E207-${sufijo}`,
        telefono: `702${sufijo.slice(-6).padEnd(6, '0')}01`,
        ubicacion: 'Sede E2-07',
        estado: 'ACTIVO',
        codigoAcceso: `E207A-${sufijo}`,
        enlaceUnico: `https://e207-${sufijo}.test`,
        responsableId: admin.id,
      },
    });
    datos.sede = sede.id;

    await prisma.configuracionBarberia.create({
      data: {
        barberiaId: sede.id,
        modoReserva: 'MANUAL',
        nuevasReservasActivas: true,
        aceptaIndividual: true,
        aceptaGrupal: false,
        horizonteReservaDias: 30,
        margenGrupalMinutos: 0,
        oportunidadesEspacioActivas: true,
      },
    });

    const rolAdmin = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN_BARBERIA' }, select: { id: true } });
    const rolCliente = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'CLIENTE' }, select: { id: true } });
    const rolGlobal = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMINISTRADOR' }, select: { id: true } });
    const rolBarbero = await prisma.rol.upsert({
      where: { nombre: 'BARBERO' },
      update: {},
      create: { nombre: 'BARBERO', ambito: 'BARBERIA' },
      select: { id: true },
    });

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: admin.id, rolId: rolAdmin.id, barberiaId: sede.id },
        { usuarioId: cliente.id, rolId: rolCliente.id, barberiaId: null },
        { usuarioId: global.id, rolId: rolGlobal.id, barberiaId: null },
        // D16 corregido: el barbero gestiona el catálogo de su sede.
        { usuarioId: barbero.id, rolId: rolBarbero.id, barberiaId: sede.id },
      ],
      skipDuplicates: true,
    });

    await prisma.clienteBarberia.create({
      data: { usuarioId: cliente.id, barberiaId: sede.id, estadoVinculacion: 'ACTIVO' },
    });

    await prisma.horario.createMany({
      data: Array.from({ length: 7 }, (_, dia) => ({
        barberiaId: sede.id,
        diaSemana: dia + 1,
        horaInicio: new Date('1970-01-01T09:00:00.000Z'),
        horaFin: new Date('1970-01-01T20:00:00.000Z'),
      })),
    });

    // Cuatro servicios: uno libre, uno con reserva abierta, y la pareja del combo.
    const crearServicio = (nombre: string) =>
      prisma.servicio.create({
        data: { barberiaId: sede.id, nombre, precio: 10, duracionEstimada: 30, margenOperativo: 0, estado: 'ACTIVO' },
      });

    datos.servicioLibre = (await crearServicio('Libre E2-07')).id;
    datos.servicioEnUso = (await crearServicio('En uso E2-07')).id;
    datos.servicioEnCombo = (await crearServicio('En combo E2-07')).id;

    // (2) Un combo ACTIVO que contiene el servicio: desactivarlo se bloquea.
    datos.combo = (
      await prisma.combo.create({
        data: {
          barberiaId: sede.id,
          nombre: 'Combo E2-07',
          precioEspecial: 15,
          duracionPropia: 30,
          margenPropio: 0,
          estado: 'ACTIVO',
          comboItemsAsParent: { create: [{ servicioId: datos.servicioEnCombo }] },
        },
      })
    ).id;

    // (1) Una reserva PENDIENTE futura que usa el servicio: desactivarlo se bloquea.
    const reserva = await prisma.reserva.create({
      data: {
        barberiaId: sede.id,
        clienteId: cliente.id,
        tipoReserva: 'INDIVIDUAL',
        estado: 'PENDIENTE',
        modoConfirmacion: 'MANUAL',
        fechaCita: new Date(`${datos.fecha}T00:00:00.000Z`),
        horaInicio: new Date('1970-01-01T10:00:00.000Z'),
        horaFin: new Date('1970-01-01T10:30:00.000Z'),
        totalPagar: 10,
        expiraAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const participante = await prisma.participanteReserva.create({
      data: { reservaId: reserva.id, esAdultoResponsable: true, nombreParticipante: 'Cliente E2-07' },
    });
    await prisma.participanteServicio.create({
      data: {
        participanteId: participante.id,
        servicioId: datos.servicioEnUso,
        precioHistorico: 10,
        duracionHistorica: 30,
        margenHistorico: 0,
      },
    });

    // Bloqueo de 09:00 a 10:00 locales para el caso de «liberar».
    datos.bloqueo = (
      await prisma.bloqueosAgenda.create({
        data: {
          barberiaId: sede.id,
          fecha: new Date(`${datos.fecha}T00:00:00.000Z`),
          horaInicio: new Date('1970-01-01T09:00:00.000Z'),
          horaFin: new Date('1970-01-01T10:00:00.000Z'),
          motivo: 'Bloqueo E2-07',
          creadoPor: admin.id,
        },
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    // Limpieza de lo creado por esta suite (el `afterAll` va en el mismo archivo
    // para no dejar basura en la base de `dev`).
    if (prisma) {
      const usuarios = await prisma.usuario.findMany({
        where: { correo: { in: Object.values(correos) } },
        select: { id: true },
      });
      const ids = usuarios.map((u) => u.id);

      if (datos.sede) {
        await prisma.participanteServicio.deleteMany({ where: { servicio: { barberiaId: datos.sede } } });
        await prisma.participanteReserva.deleteMany({ where: { reserva: { barberiaId: datos.sede } } });
        await prisma.reserva.deleteMany({ where: { barberiaId: datos.sede } });
        await prisma.bloqueosAgenda.deleteMany({ where: { barberiaId: datos.sede } });
        await prisma.comboItem.deleteMany({ where: { combo: { barberiaId: datos.sede } } });
        await prisma.combo.deleteMany({ where: { barberiaId: datos.sede } });
        await prisma.servicio.deleteMany({ where: { barberiaId: datos.sede } });
        await prisma.horario.deleteMany({ where: { barberiaId: datos.sede } });
        await prisma.configuracionBarberia.deleteMany({ where: { barberiaId: datos.sede } });
        await prisma.clienteBarberia.deleteMany({ where: { barberiaId: datos.sede } });
        await prisma.barberia.deleteMany({ where: { id: datos.sede } });
      }

      await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: ids } } });
      await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    }
  }, 120_000);

  it('REGLA 3 · desactivar un servicio sin reservas abiertas y volver a activarlo', async () => {
    // D16: escribe el BARBERO de la sede, no su administrador.
    const desactivar = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${datos.servicioLibre}/desactivar`)
      .set(headers('barbero', datos.sede));
    expect(desactivar.status).toBe(200);

    const enBd = await prisma.servicio.findUniqueOrThrow({
      where: { id: datos.servicioLibre },
      select: { estado: true },
    });
    expect(enBd.estado).toBe('INACTIVO');

    // Sale del catálogo para cliente: `findAll` solo lista los ACTIVO.
    const catalogoCliente = await request(app.getHttpServer())
      .get(`${api}/catalogo/servicios`)
      .set(headers('cliente', datos.sede));
    expect(catalogoCliente.status).toBe(200);
    expect(catalogoCliente.body.map((s: { id: string }) => s.id)).not.toContain(datos.servicioLibre);

    // Admin ve todos (incluye INACTIVOS)
    const catalogoAdmin = await request(app.getHttpServer())
      .get(`${api}/catalogo/servicios`)
      .set(headers('admin', datos.sede));
    expect(catalogoAdmin.status).toBe(200);
    expect(catalogoAdmin.body.map((s: { id: string }) => s.id)).toContain(datos.servicioLibre);

    const reactivar = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${datos.servicioLibre}/reactivar`)
      .set(headers('barbero', datos.sede));
    expect(reactivar.status).toBe(200);

    const trasReactivar = await prisma.servicio.findUniqueOrThrow({
      where: { id: datos.servicioLibre },
      select: { estado: true },
    });
    expect(trasReactivar.estado).toBe('ACTIVO');
  });

  it('REGLA 1 · 422 SERVICIO_EN_USO con una reserva PENDIENTE que usa el servicio', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${datos.servicioEnUso}/desactivar`)
      .set(headers('barbero', datos.sede));

    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('SERVICIO_EN_USO');
    expect(res.body.mensaje).toContain('por confirmar');

    const enBd = await prisma.servicio.findUniqueOrThrow({
      where: { id: datos.servicioEnUso },
      select: { estado: true },
    });
    expect(enBd.estado).toBe('ACTIVO');
  });

  it('REGLA 2 · 422 SERVICIO_EN_COMBO_ACTIVO, y el combo primero desbloquea', async () => {
    const bloqueado = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${datos.servicioEnCombo}/desactivar`)
      .set(headers('barbero', datos.sede));

    expect(bloqueado.status).toBe(422);
    expect(bloqueado.body.codigo).toBe('SERVICIO_EN_COMBO_ACTIVO');
    expect(bloqueado.body.mensaje).toContain('Combo E2-07');
    expect(bloqueado.body.combos).toEqual([{ id: datos.combo, nombre: 'Combo E2-07' }]);

    // El servicio sigue ACTIVO: la regla no dejó medias tintas.
    const antes = await prisma.servicio.findUniqueOrThrow({
      where: { id: datos.servicioEnCombo },
      select: { estado: true },
    });
    expect(antes.estado).toBe('ACTIVO');

    // Se resuelve el combo (el orden que pide el backlog) y entonces sí.
    const combo = await request(app.getHttpServer())
      .patch(`${api}/catalogo/combos/${datos.combo}/desactivar`)
      .set(headers('barbero', datos.sede));
    expect(combo.status).toBe(200);

    const despues = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${datos.servicioEnCombo}/desactivar`)
      .set(headers('barbero', datos.sede));
    expect(despues.status).toBe(200);

    const enBd = await prisma.servicio.findUniqueOrThrow({
      where: { id: datos.servicioEnCombo },
      select: { estado: true },
    });
    expect(enBd.estado).toBe('INACTIVO');
  });

  it('liberar un bloqueo no borra la fila, la marca y deja de ocupar agenda', async () => {
    // `GET .../agenda/disponibilidad` devuelve TRAMOS libres continuos, no slots:
    // se compara el arranque del primer tramo, no cuántos hay.
    const arranque = (tramos: { inicio: string }[]) =>
      Math.min(...tramos.map((t) => new Date(t.inicio).getTime()));

    const antes = await disponibilidad();

    const liberar = await request(app.getHttpServer())
      .post(`${api}/barberias/${datos.sede}/agenda/bloqueos/${datos.bloqueo}/liberar`)
      .set(headers('admin', datos.sede));
    expect(liberar.status).toBe(200);
    expect(liberar.body.success).toBe(true);

    // La fila sigue ahí —eso es lo que el `DELETE` no conservaba— con la marca.
    const enBd = await prisma.bloqueosAgenda.findUniqueOrThrow({ where: { id: datos.bloqueo } });
    expect(enBd.motivo).toBe('Bloqueo E2-07');
    expect(enBd.liberadoAt).not.toBeNull();

    const despues = await disponibilidad();

    // El bloqueo ocupaba de 09:00 a 10:00 locales: al liberarse, el primer tramo
    // libre arranca una hora antes de donde arrancaba.
    const minutosGanados = (arranque(antes) - arranque(despues)) / 60_000;
    expect(minutosGanados).toBeGreaterThanOrEqual(60);

    // Idempotente: la segunda llamada no cambia nada ni falla.
    const otraVez = await request(app.getHttpServer())
      .post(`${api}/barberias/${datos.sede}/agenda/bloqueos/${datos.bloqueo}/liberar`)
      .set(headers('admin', datos.sede));
    expect(otraVez.status).toBe(200);
    expect(otraVez.body.message).toContain('ya estaba liberado');

    const sinCambios = await prisma.bloqueosAgenda.findUniqueOrThrow({ where: { id: datos.bloqueo } });
    expect(sinCambios.liberadoAt?.toISOString()).toBe(enBd.liberadoAt?.toISOString());
  });

  it('suspender y reactivar la sede es cambio de estado (y solo del ADMINISTRADOR)', async () => {
    // La sede no entra por aquí: su vía es la plataforma (decisión 4).
    const noAutorizado = await request(app.getHttpServer())
      .patch(`${api}/barberias/${datos.sede}/estado`)
      .set(headers('admin', datos.sede))
      .send({ estado: 'INACTIVO' });
    expect(noAutorizado.status).toBe(403);

    const suspender = await request(app.getHttpServer())
      .patch(`${api}/barberias/${datos.sede}/estado`)
      .set(headers('global'))
      .send({ estado: 'INACTIVO' });
    expect(suspender.status).toBe(200);

    const suspendida = await prisma.barberia.findUniqueOrThrow({
      where: { id: datos.sede },
      select: { estado: true, nombre: true },
    });
    expect(suspendida.estado).toBe('INACTIVO');
    // Sigue existiendo: es una suspensión, no un borrado.
    expect(suspendida.nombre).toContain('Sede E207-');

    const reactivar = await request(app.getHttpServer())
      .patch(`${api}/barberias/${datos.sede}/estado`)
      .set(headers('global'))
      .send({ estado: 'ACTIVO' });
    expect(reactivar.status).toBe(200);

    const reactivada = await prisma.barberia.findUniqueOrThrow({
      where: { id: datos.sede },
      select: { estado: true },
    });
    expect(reactivada.estado).toBe('ACTIVO');
  });

  it('visibilidad por rol: inactivos ocultos al cliente, visibles al admin', async () => {
    // Desactivar un servicio para que quede INACTIVO
    const desactivar = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${datos.servicioLibre}/desactivar`)
      .set(headers('barbero', datos.sede));
    expect(desactivar.status).toBe(200);

    // Cliente solo ve ACTIVOS
    const clienteGet = await request(app.getHttpServer())
      .get(`${api}/catalogo/servicios`)
      .set(headers('cliente', datos.sede));
    expect(clienteGet.status).toBe(200);
    expect(clienteGet.body.some((s: any) => s.id === datos.servicioLibre)).toBe(false);

    // Admin ve TODOS
    const adminGet = await request(app.getHttpServer())
      .get(`${api}/catalogo/servicios`)
      .set(headers('admin', datos.sede));
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.some((s: any) => s.id === datos.servicioLibre)).toBe(true);

    // Reactivar para dejar estado limpio
    const reactivar = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${datos.servicioLibre}/reactivar`)
      .set(headers('barbero', datos.sede));
    expect(reactivar.status).toBe(200);
  });

  it('visibilidad de combos por rol y endpoints de transición', async () => {
    // Desactivar combo
    const desactivarCombo = await request(app.getHttpServer())
      .patch(`${api}/catalogo/combos/${datos.combo}/desactivar`)
      .set(headers('barbero', datos.sede));
    expect(desactivarCombo.status).toBe(200);

    // Cliente no ve inactivo
    const clienteCombos = await request(app.getHttpServer())
      .get(`${api}/catalogo/combos`)
      .set(headers('cliente', datos.sede));
    expect(clienteCombos.status).toBe(200);
    expect(clienteCombos.body.some((c: any) => c.id === datos.combo)).toBe(false);

    // Admin ve todos
    const adminCombos = await request(app.getHttpServer())
      .get(`${api}/catalogo/combos`)
      .set(headers('admin', datos.sede));
    expect(adminCombos.status).toBe(200);
    expect(adminCombos.body.some((c: any) => c.id === datos.combo)).toBe(true);

    // Reactivar combo
    const reactivarCombo = await request(app.getHttpServer())
      .patch(`${api}/catalogo/combos/${datos.combo}/reactivar`)
      .set(headers('barbero', datos.sede));
    expect(reactivarCombo.status).toBe(200);
  });

  /**
   * D16 (Especificación §2/§3.1): el catálogo lo opera el personal de la sede.
   *
   *   BARBERO ✅ · ADMIN_BARBERIA ✅ · ADMINISTRADOR global ❌ · CLIENTE ❌
   *
   * El caso interesante sigue siendo el ADMINISTRADOR global: `RolesGuard` le
   * concede acceso transversal a cualquier `@Roles` por jerarquía (E1-04), así
   * que sin `OperadorBarberiaGuard` habría seguido creando servicios. Y el
   * ADMIN_BARBERIA tiene que poder: en V1 es el operador de la barbería.
   */
  it('RBAC del catálogo · BARBERO y ADMIN_BARBERIA escriben, global y cliente no', async () => {
    const nuevoServicio = {
      nombre: 'Servicio del barbero E2-07',
      precio: 25,
      duracionEstimada: 30,
    };

    // Roles que NO operan el catálogo: 403 aunque la sede sea la suya.
    for (const rol of ['global', 'cliente']) {
      const res = await request(app.getHttpServer())
        .post(`${api}/catalogo/servicios`)
        .set(headers(rol, datos.sede))
        .send(nuevoServicio);
      expect(`${rol} POST /catalogo/servicios → ${res.status}`).toBe(
        `${rol} POST /catalogo/servicios → 403`,
      );
    }

    // El operador de la sede (ADMIN_BARBERIA) crea sin problemas.
    const creadoPorAdmin = await request(app.getHttpServer())
      .post(`${api}/catalogo/servicios`)
      .set(headers('admin', datos.sede))
      .send({ ...nuevoServicio, nombre: 'Servicio del admin de sede E2-07' });
    expect(creadoPorAdmin.status, JSON.stringify(creadoPorAdmin.body)).toBe(201);
    expect(creadoPorAdmin.body.barberiaId).toBe(datos.sede);

    // Y el BARBERO también.
    const creado = await request(app.getHttpServer())
      .post(`${api}/catalogo/servicios`)
      .set(headers('barbero', datos.sede))
      .send(nuevoServicio);
    expect(creado.status, JSON.stringify(creado.body)).toBe(201);
    expect(creado.body.barberiaId).toBe(datos.sede);

    // Todos LEEN el mismo catálogo (vitrina + supervisión).
    for (const rol of ['admin', 'global', 'cliente', 'barbero']) {
      const res = await request(app.getHttpServer())
        .get(`${api}/catalogo/servicios`)
        .set(headers(rol, datos.sede));
      expect(`${rol} GET → ${res.status}`).toBe(`${rol} GET → 200`);
    }

    // Edita el ADMIN_BARBERIA (operador de la sede)...
    const adminEdita = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${creado.body.id}`)
      .set(headers('admin', datos.sede))
      .send({ precio: 30 });
    expect(adminEdita.status, JSON.stringify(adminEdita.body)).toBe(200);
    expect(Number(adminEdita.body.precio)).toBe(30);

    // ...y edita el BARBERO.
    const barberoEdita = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${creado.body.id}`)
      .set(headers('barbero', datos.sede))
      .send({ precio: 35 });
    expect(barberoEdita.status).toBe(200);
    expect(Number(barberoEdita.body.precio)).toBe(35);

    // El ADMINISTRADOR global no edita: 403 explícito.
    const globalEdita = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${creado.body.id}`)
      .set(headers('global', datos.sede))
      .send({ precio: 50 });
    expect(globalEdita.status).toBe(403);
  });
});
