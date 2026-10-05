import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';

/**
 * E1-06 · paso 4: el ADMIN_BARBERIA de A contra los recursos de B.
 *
 * Este fichero existe para una sola pregunta: ¿algún intento de una sede sobre
 * los datos de otra devuelve 2xx? Si alguno lo hace, es una fuga cross-tenant y
 * NO se arregla aquí (el paso 5 pide reportarlo con evidencia, sin ampliar
 * alcance).
 *
 * Cada caso lleva su control positivo cuando aplica, para que un 403 general
 * —una app rota que deniega todo— no haga pasar la suite por el motivo
 * equivocado.
 */
describe('E1-06 · cross-tenant: el admin de A no alcanza los recursos de B', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const correos = ['admin.a.cta@test.com', 'admin.b.cta@test.com', 'suelto.cta@test.com'];

  let barberiaA: string;
  let barberiaB: string;
  let servicioA: string;
  let servicioB: string;
  let comboA: string;
  let comboB: string;
  let bloqueoB: string;
  let tokenAdminA: string;
  let tokenSuelto: string;

  const api = '/api/v1';

  async function crearUsuario(correo: string, nombre: string, telefono: string) {
    const hash = await bcrypt.hash('Password1!', 10);
    return prisma.usuario.create({
      data: { nombreCompleto: nombre, correo, telefono, passwordHash: hash },
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
    prisma = app.get(PrismaService);

    // Limpieza idempotente. Las barberías van antes que los usuarios porque
    // `responsable_id` es una FK y borrarlos al revés revienta.
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.barberia.deleteMany({ where: { nombre: { contains: 'E1-06-CTA' } } });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });

    const [rolAdmin, rolCliente] = await Promise.all([
      prisma.rol.upsert({
        where: { nombre: 'ADMIN_BARBERIA' },
        update: {},
        create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'CLIENTE' },
        update: {},
        create: { nombre: 'CLIENTE', ambito: 'BARBERIA' },
      }),
    ]);

    const adminA = await crearUsuario('admin.a.cta@test.com', 'Admin A CTA', '9993000001');
    const adminB = await crearUsuario('admin.b.cta@test.com', 'Admin B CTA', '9993000002');
    const suelto = await crearUsuario('suelto.cta@test.com', 'Cliente Suelto', '9993000003');

    barberiaA = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia A E1-06-CTA',
          telefono: '9993111111',
          ubicacion: 'A',
          codigoAcceso: 'CTA-AAAA',
          enlaceUnico: 'https://a.cta.test/x',
          responsableId: adminA.id,
        },
      })
    ).id;
    barberiaB = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia B E1-06-CTA',
          telefono: '9993222222',
          ubicacion: 'B',
          codigoAcceso: 'CTA-BBBB',
          enlaceUnico: 'https://b.cta.test/x',
          responsableId: adminB.id,
        },
      })
    ).id;

    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminA.id, rolId: rolAdmin.id, barberiaId: barberiaA },
        { usuarioId: adminB.id, rolId: rolAdmin.id, barberiaId: barberiaB },
        // CLIENTE GLOBAL con barberia_id nulo y SIN fila en cliente_barberias:
        // no está vinculado a ninguna sede.
        { usuarioId: suelto.id, rolId: rolCliente.id, barberiaId: null },
      ],
    });

    servicioA = (
      await prisma.servicio.create({
        data: { barberiaId: barberiaA, nombre: 'Corte E1-06-CTA de A', precio: 100, duracionEstimada: 30 },
      })
    ).id;
    servicioB = (
      await prisma.servicio.create({
        data: { barberiaId: barberiaB, nombre: 'Corte E1-06-CTA de B', precio: 200, duracionEstimada: 45 },
      })
    ).id;
    comboA = (
      await prisma.combo.create({
        data: { barberiaId: barberiaA, nombre: 'Combo E1-06-CTA de A', precioEspecial: 150, duracionPropia: 60 },
      })
    ).id;
    comboB = (
      await prisma.combo.create({
        data: { barberiaId: barberiaB, nombre: 'Combo E1-06-CTA de B', precioEspecial: 250, duracionPropia: 90 },
      })
    ).id;

    bloqueoB = (
      await prisma.bloqueosAgenda.create({
        data: {
          barberiaId: barberiaB,
          fecha: new Date('2026-12-01'),
          horaInicio: new Date('1970-01-01T09:00:00Z'),
          horaFin: new Date('1970-01-01T10:00:00Z'),
          motivo: 'MOTIVO-PRIVADO-DE-B',
        },
      })
    ).id;

    // Horarios con `diaSemana` distinto para poder distinguir QUE sede se leyo
    // cuando la respuesta es 2xx. Sin esto, un 200 en el caso de cabecera
    // manipulada no dice si leyo la sede de la ruta o la de la cabecera.
    await prisma.horario.create({
      data: {
        barberiaId: barberiaA,
        diaSemana: 1,
        horaInicio: new Date('1970-01-01T08:00:00Z'),
        horaFin: new Date('1970-01-01T18:00:00Z'),
      },
    });
    await prisma.horario.create({
      data: {
        barberiaId: barberiaB,
        diaSemana: 7,
        horaInicio: new Date('1970-01-01T09:00:00Z'),
        horaFin: new Date('1970-01-01T15:00:00Z'),
      },
    });

    const login = async (correo: string) => {
      const res = await request(app.getHttpServer()).post(`${api}/auth/login`).send({ correo, password: 'Password1!' });
      expect([200, 201], `login de ${correo}`).toContain(res.status);
      return res.body.accessToken as string;
    };

    tokenAdminA = await login('admin.a.cta@test.com');
    tokenSuelto = await login('suelto.cta@test.com');
  }, 60000);

  afterAll(async () => {
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.barberia.deleteMany({ where: { nombre: { contains: 'E1-06-CTA' } } });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });
    await app.close();
  }, 30000);

  /**
   * La tabla que pide el informe. Se rellena en un unico test para que la salida
   * sea una tabla y no casos sueltos, y se comprueba con `expect.soft` para que
   * un fallo no oculte los demas intentos.
   */
  it('ningún intento ajeno sobre B responde 2xx (tabla ruta × intento × estado)', async () => {
    const jwt = (t: string) => `Bearer ${t}`;
    const ejecutar = async (r: request.Test) => (await r).status;

    const casos: { ruta: string; intento: string; estado: number }[] = [];

    const registrar = async (ruta: string, intento: string, r: request.Test) => {
      const estado = await ejecutar(r);
      casos.push({ ruta, intento, estado });
      return estado;
    };

    // --- Catálogo de B: leer, editar y desactivar ---
    await registrar('GET /catalogo/servicios/:id', 'leer servicio de B', request(app.getHttpServer())
      .get(`${api}/catalogo/servicios/${servicioB}`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA));

    await registrar('PATCH /catalogo/servicios/:id', 'editar servicio de B', request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${servicioB}`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA)
      .send({ nombre: 'SECUESTRADO-POR-A' }));

    await registrar('DELETE /catalogo/servicios/:id', 'desactivar servicio de B', request(app.getHttpServer())
      .delete(`${api}/catalogo/servicios/${servicioB}`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA));

    await registrar('GET /catalogo/combos/:id', 'leer combo de B', request(app.getHttpServer())
      .get(`${api}/catalogo/combos/${comboB}`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA));

    await registrar('PATCH /catalogo/combos/:id', 'editar combo de B', request(app.getHttpServer())
      .patch(`${api}/catalogo/combos/${comboB}`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA)
      .send({ nombre: 'SECUESTRADO-POR-A' }));

    await registrar('DELETE /catalogo/combos/:id', 'desactivar combo de B', request(app.getHttpServer())
      .delete(`${api}/catalogo/combos/${comboB}`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA));

    await registrar('GET /catalogo/servicios', 'listar el catálogo de B', request(app.getHttpServer())
      .get(`${api}/catalogo/servicios`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaB));

    // --- Agenda, bloqueos, pagos, horarios, auditoría y antecedentes de B ---
    await registrar('GET /barberias/:id/agenda/disponibilidad', 'leer la agenda de B', request(app.getHttpServer())
      .get(`${api}/barberias/${barberiaB}/agenda/disponibilidad?fecha=2026-12-01&duracionMinutos=30`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /barberias/:id/agenda/bloqueos', 'leer los bloqueos de B', request(app.getHttpServer())
      .get(`${api}/barberias/${barberiaB}/agenda/bloqueos?fromDate=2026-11-01&toDate=2026-12-31`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /agenda/bloqueos', 'bloqueos de B por cabecera', request(app.getHttpServer())
      .get(`${api}/agenda/bloqueos?fromDate=2026-11-01&toDate=2026-12-31`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaB));

    await registrar('DELETE /barberias/:id/agenda/bloqueos/:id', 'borrar un bloqueo de B', request(app.getHttpServer())
      .delete(`${api}/barberias/${barberiaB}/agenda/bloqueos/${bloqueoB}`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /cobros/auditoria', 'leer la auditoría de cobros de B', request(app.getHttpServer())
      .get(`${api}/cobros/auditoria`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaB));

    await registrar('POST /barberias/:id/pagos/en-persona', 'cobrar en B', request(app.getHttpServer())
      .post(`${api}/barberias/${barberiaB}/pagos/en-persona`)
      .set('Authorization', jwt(tokenAdminA))
      .send({}));

    await registrar('GET /barberias/:id/horarios', 'leer los horarios de B', request(app.getHttpServer())
      .get(`${api}/barberias/${barberiaB}/horarios`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /auditoria?barberiaId=B', 'auditoría de B por query', request(app.getHttpServer())
      .get(`${api}/auditoria?barberiaId=${barberiaB}`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /barberias/:id/antecedentes/pendientes', 'antecedentes de B', request(app.getHttpServer())
      .get(`${api}/barberias/${barberiaB}/antecedentes/pendientes`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /auditoria/estadisticas', 'estadísticas globales sin ser ADMINISTRADOR', request(app.getHttpServer())
      .get(`${api}/auditoria/estadisticas`)
      .set('Authorization', jwt(tokenAdminA)));

    // --- Manipulación: la cabecera no manda sobre el parámetro de la ruta ---
    await registrar('GET /barberias/:id/horarios (ruta B, cabecera A)', 'ruta B con cabecera de A', request(app.getHttpServer())
      .get(`${api}/barberias/${barberiaB}/horarios`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA));

    // El caso inverso (ruta A, cabecera B) NO entra en el bucle de intentos
    // ajenos: el usuario pide SU propia sede y un 200 es legitimo. Lo que hay
    // que probar no es el estado sino QUE sede se leyo: `params` debe ganar a la
    // cabecera. A tiene diaSemana=1, B tiene diaSemana=7.
    const rutaAconCabeceraB = await request(app.getHttpServer())
      .get(`${api}/barberias/${barberiaA}/horarios`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaB);
    const diasDevueltos = (rutaAconCabeceraB.body as { diaSemana: number }[]).map((h) => h.diaSemana);
    expect(rutaAconCabeceraB.status, 'ruta A con cabecera B: lee su propia sede').toBe(200);
    expect(diasDevueltos, 'la cabecera B no se cuela: no aparece el diaSemana de B (7)').not.toContain(7);
    expect(diasDevueltos, 'devuelve la sede de la ruta (A, diaSemana 1)').toContain(1);

    // --- Manipulación: barberiaId en la query ---
    await registrar('GET /catalogo/servicios?barberiaId=B', 'catálogo de B por query', request(app.getHttpServer())
      .get(`${api}/catalogo/servicios?barberiaId=${barberiaB}`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /agenda/bloqueos?barberiaId=B', 'bloqueos de B por query', request(app.getHttpServer())
      .get(`${api}/agenda/bloqueos?barberiaId=${barberiaB}&fromDate=2026-11-01&toDate=2026-12-31`)
      .set('Authorization', jwt(tokenAdminA)));

    // --- CLIENTE no vinculado a ninguna sede ---
    // La disponibilidad SI exige pertenencia (E1-06 parte 3): 403 sin vinculo.
    await registrar('GET /agenda/disponibilidad (CLIENTE suelto)', 'cliente sin vínculo lee la agenda de A', request(app.getHttpServer())
      .get(`${api}/agenda/disponibilidad?fecha=2026-12-01&duracionMinutos=30`)
      .set('Authorization', jwt(tokenSuelto))
      .set('x-barberia-id', barberiaA));


    // --- Control positivo: el mismo admin SÍ puede con lo suyo ---
    const controlPropio = await request(app.getHttpServer())
      .patch(`${api}/catalogo/servicios/${servicioA}`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA)
      .send({ nombre: 'Corte E1-06-CTA de A (editado por su admin)' });

    // HALLAZGO (paso 5) · un CLIENTE sin vinculo a ninguna sede lee el catalogo
    // de A con 200. Se comprueba aqui para que quede fijado y visible, en vez de
    // esconderlo bajando la asercion del bucle. Ver el informe: la matriz de
    // permisos abre `GET /catalogo/servicios` a los cuatro roles y navegar sin
    // vinculo parece intencionado, pero contradice el criterio del paso 4
    // ("todo intento ajeno, 403 o 404"). Decide el dueno; NO se cambia aqui.
    const catalogoSuelto = await request(app.getHttpServer())
      .get(`${api}/catalogo/servicios`)
      .set('Authorization', jwt(tokenSuelto))
      .set('x-barberia-id', barberiaA);

    console.log(
      '\n| ruta | intento | estado |\n|---|---|---|\n' +
        casos.map((c) => `| \`${c.ruta}\` | ${c.intento} | ${c.estado} |`).join('\n') +
        `\n| \`PATCH /catalogo/servicios/:id\` | *CONTROL* el admin edita SU servicio | ${controlPropio.status} |` +
        `\n| \`GET /barberias/:id/horarios (ruta A, cabecera B)\` | *CONTROL* lee A (diaSemana 1), no B (7) | ${rutaAconCabeceraB.status} |` +
        `\n| \`GET /catalogo/servicios\` | *HALLAZGO* cliente sin vinculo lee el catalogo | ${catalogoSuelto.status} |\n`,
    );

    // El control positivo tiene que pasar: si esto no es 2xx, el 403/404 de los
    // casos ajenos no estaría probando aislamiento sino una app que deniega todo.
    expect(controlPropio.status, 'control positivo: el admin edita su propio servicio').toBe(200);

    // El hallazgo queda fijado con su estado real, y ademas se comprueba que el
    // catalogo leido es el de la sede pedida y no el de todas las sedes.
    expect(catalogoSuelto.status, 'desviacion conocida: cliente sin vinculo lee el catalogo').toBe(200);
    expect(
      (catalogoSuelto.body as { id: string }[]).map((s) => s.id),
      'el catalogo que lee es el de la sede que pide, no el de todas',
    ).not.toContain(servicioB);

    for (const c of casos) {
      expect.soft([403, 404], `${c.ruta} · ${c.intento} → ${c.estado}`).toContain(c.estado);
    }

    // Y nada de lo ajeno pudo tocar los datos de B.
    const servicioBDespues = await prisma.servicio.findUnique({ where: { id: servicioB } });
    const comboBDespues = await prisma.combo.findUnique({ where: { id: comboB } });
    const bloqueoBDespues = await prisma.bloqueosAgenda.findUnique({ where: { id: bloqueoB } });
    expect(servicioBDespues?.nombre).toBe('Corte E1-06-CTA de B');
    expect(servicioBDespues?.estado).toBe('ACTIVO');
    expect(comboBDespues?.nombre).toBe('Combo E1-06-CTA de B');
    expect(comboBDespues?.estado).toBe('ACTIVO');
    expect(bloqueoBDespues?.motivo).toBe('MOTIVO-PRIVADO-DE-B');
  }, 120000);
});
