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

  const correos = [
    'admin.a.cta@test.com',
    'admin.b.cta@test.com',
    'suelto.cta@test.com',
    'vinculado.cta@test.com',
    // D16: el catálogo de A lo opera su personal (BARBERO o ADMIN_BARBERIA), así
    // que el control positivo de "editar SU servicio" usa una sesión de barbero.
    'barbero.a.cta@test.com',
  ];

  let barberiaA: string;
  let barberiaB: string;
  let servicioA: string;
  let servicioB: string;
  let comboA: string;
  let comboB: string;
  let bloqueoB: string;
  let tokenAdminA: string;
  let tokenSuelto: string;
  let tokenVinculado: string;
  let tokenBarberoA: string;

  const api = '/api/v1';

  async function crearUsuario(correo: string, nombre: string, telefono: string) {
    const hash = await bcrypt.hash('Password1!', 10);
    return prisma.usuario.create({
      data: { telefonoVerificado: true, nombreCompleto: nombre, correo, telefono, passwordHash: hash },
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

    const [rolAdmin, rolCliente, rolBarbero] = await Promise.all([
      prisma.rol.upsert({
        where: { nombre: 'ADMIN_BARBERIA' },
        update: {},
        create: { nombre: 'ADMIN_BARBERIA', ambito: 'BARBERIA' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'CLIENTE' },
        update: {},
        // `ambito: 'GLOBAL'` es la convencion del producto (prisma/seed.ts:56) y
        // la que ya usa `e1-06-sede-del-tenant`: el CLIENTE es global con
        // `barberia_id` nulo y su pertenencia a una sede va por `cliente_barberias`.
        // Sembrarlo BARBERIA con `barberia_id` nulo hace que `alcanceCumple` lo
        // deniegue siempre, y como el upsert lleva `update: {}`, el primer
        // fichero que corre en una BD limpia decide el ambito para los demas.
        create: { nombre: 'CLIENTE', ambito: 'GLOBAL' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'BARBERO' },
        update: {},
        create: { nombre: 'BARBERO', ambito: 'BARBERIA' },
      }),
    ]);

    const adminA = await crearUsuario('admin.a.cta@test.com', 'Admin A CTA', '9993000001');
    const adminB = await crearUsuario('admin.b.cta@test.com', 'Admin B CTA', '9993000002');
    const suelto = await crearUsuario('suelto.cta@test.com', 'Cliente Suelto', '9993000003');
    const vinculado = await crearUsuario('vinculado.cta@test.com', 'Cliente Vinculado', '9993000004');
    const barberoA = await crearUsuario('barbero.a.cta@test.com', 'Barbero A CTA', '9993000005');

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
        // Igual de GLOBAL y sin barberia_id en usuario_roles, pero CON fila ACTIVA
        // en cliente_barberias para A: es el control positivo de la regla.
        { usuarioId: vinculado.id, rolId: rolCliente.id, barberiaId: null },
        // El barbero que SÍ puede escribir el catálogo de A (D16).
        { usuarioId: barberoA.id, rolId: rolBarbero.id, barberiaId: barberiaA },
      ],
    });

    // Control positivo de la regla de vínculo: este cliente SÍ está vinculado a
    // A, así que debe seguir viendo su catálogo con normalidad. Sin esta fila,
    // un arreglo que denegase a todos los CLIENTES también dejaría el spec verde.
    await prisma.clienteBarberia.create({
      data: { usuarioId: vinculado.id, barberiaId: barberiaA, estadoVinculacion: 'ACTIVO' },
    });

    // Vínculo DESVINCULADO con B: ni rol en usuario_roles ni fila ACTIVA. Debe
    // recibir 403 igual que el cliente sin vínculo, que es el caso que se arregla.
    await prisma.clienteBarberia.create({
      data: { usuarioId: vinculado.id, barberiaId: barberiaB, estadoVinculacion: 'DESVINCULADO' },
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
    tokenVinculado = await login('vinculado.cta@test.com');
    tokenBarberoA = await login('barbero.a.cta@test.com');
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
    // Fase 5 (Punto 5.3): la sede va en la RUTA. El admin de A apunta a la ruta
    // de B y no hay cabecera que lo desvíe: la denegación es del guard.
    await registrar('GET /shops/:shopId/services/:id', 'leer servicio de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/services/${servicioB}`)
      .set('Authorization', jwt(tokenAdminA)));

    // D16: las escrituras del catálogo son del BARBERO y del ADMIN_BARBERIA de la
    // sede, así que el intento de tocar B se hace con el barbero de A. El rol
    // pasa; lo que debe frenarlo es el aislamiento de tenant, que es el objetivo.
    await registrar('PATCH /shops/:shopId/services/:id', 'editar servicio de B', request(app.getHttpServer())
      .patch(`${api}/shops/${barberiaB}/services/${servicioB}`)
      .set('Authorization', jwt(tokenBarberoA))
      .send({ nombre: 'SECUESTRADO-POR-A' }));

    await registrar('PATCH /shops/:shopId/services/:id/deactivate', 'desactivar servicio de B', request(app.getHttpServer())
      .patch(`${api}/shops/${barberiaB}/services/${servicioB}/deactivate`)
      .set('Authorization', jwt(tokenBarberoA)));

    await registrar('GET /shops/:shopId/combos/:id', 'leer combo de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/combos/${comboB}`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('PATCH /shops/:shopId/combos/:id', 'editar combo de B', request(app.getHttpServer())
      .patch(`${api}/shops/${barberiaB}/combos/${comboB}`)
      .set('Authorization', jwt(tokenBarberoA))
      .send({ nombre: 'SECUESTRADO-POR-A' }));

    await registrar('PATCH /shops/:shopId/combos/:id/deactivate', 'desactivar combo de B', request(app.getHttpServer())
      .patch(`${api}/shops/${barberiaB}/combos/${comboB}/deactivate`)
      .set('Authorization', jwt(tokenBarberoA)));

    await registrar('GET /shops/:shopId/services', 'listar el catálogo de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/services`)
      .set('Authorization', jwt(tokenAdminA)));

    // --- Agenda, bloqueos, pagos, horarios, auditoría y antecedentes de B ---
    await registrar('GET /shops/:shopId/appointments/schedule/availability', 'leer la agenda de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/appointments/schedule/availability?fecha=2026-12-01&duracionMinutos=30`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /shops/:shopId/appointments/schedule/blocks', 'leer los bloqueos de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/appointments/schedule/blocks?fromDate=2026-11-01&toDate=2026-12-31`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /shops/:shopId/appointments/schedule/blocks (cabecera A)', 'bloqueos de B con cabecera de A', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/appointments/schedule/blocks?fromDate=2026-11-01&toDate=2026-12-31`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA));

    await registrar('POST /shops/:shopId/appointments/schedule/blocks/:id/release', 'liberar un bloqueo de B', request(app.getHttpServer())
      .post(`${api}/shops/${barberiaB}/appointments/schedule/blocks/${bloqueoB}/release`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /shops/:shopId/payments/audit', 'leer la auditoría de cobros de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/payments/audit`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('POST /shops/:shopId/payments', 'cobrar en B', request(app.getHttpServer())
      .post(`${api}/shops/${barberiaB}/payments`)
      .set('Authorization', jwt(tokenAdminA))
      .send({}));

    await registrar('GET /shops/:shopId/hours', 'leer los horarios de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/hours`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /auditoria?barberiaId=B', 'auditoría de B por query', request(app.getHttpServer())
      .get(`${api}/auditoria?barberiaId=${barberiaB}`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /shops/:shopId/records/pending', 'antecedentes de B', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/records/pending`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /auditoria/estadisticas', 'estadísticas globales sin ser ADMINISTRADOR', request(app.getHttpServer())
      .get(`${api}/auditoria/estadisticas`)
      .set('Authorization', jwt(tokenAdminA)));

    // --- Manipulación: la cabecera no manda sobre el parámetro de la ruta ---
    await registrar('GET /shops/:shopId/hours (ruta B, cabecera A)', 'ruta B con cabecera de A', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/hours`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaA));

    // El caso inverso (ruta A, cabecera B) NO entra en el bucle de intentos
    // ajenos: el usuario pide SU propia sede y un 200 es legitimo. Lo que hay
    // que probar no es el estado sino QUE sede se leyo: `params` debe ganar a la
    // cabecera. A tiene diaSemana=1, B tiene diaSemana=7.
    const rutaAconCabeceraB = await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaA}/hours`)
      .set('Authorization', jwt(tokenAdminA))
      .set('x-barberia-id', barberiaB);
    const diasDevueltos = (rutaAconCabeceraB.body as { diaSemana: number }[]).map((h) => h.diaSemana);
    expect(rutaAconCabeceraB.status, 'ruta A con cabecera B: lee su propia sede').toBe(200);
    expect(diasDevueltos, 'la cabecera B no se cuela: no aparece el diaSemana de B (7)').not.toContain(7);
    expect(diasDevueltos, 'devuelve la sede de la ruta (A, diaSemana 1)').toContain(1);

    // --- Manipulación: una query con otra sede no cambia la sede de la ruta ---
    await registrar('GET /shops/:shopId/services?barberiaId=A', 'catálogo de B con query de A', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/services?barberiaId=${barberiaA}`)
      .set('Authorization', jwt(tokenAdminA)));

    await registrar('GET /shops/:shopId/appointments/schedule/blocks?barberiaId=A', 'bloqueos de B con query de A', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/appointments/schedule/blocks?barberiaId=${barberiaA}&fromDate=2026-11-01&toDate=2026-12-31`)
      .set('Authorization', jwt(tokenAdminA)));

    // --- CLIENTE no vinculado a ninguna sede ---
    // La disponibilidad SI exige pertenencia (E1-06 parte 3): 403 sin vinculo.
    await registrar('GET /shops/:shopId/appointments/schedule/availability (CLIENTE suelto)', 'cliente sin vínculo lee la agenda de A', request(app.getHttpServer())
      .get(`${api}/shops/${barberiaA}/appointments/schedule/availability?fecha=2026-12-01&duracionMinutos=30`)
      .set('Authorization', jwt(tokenSuelto)));

    // --- Control positivo: el operador de A SÍ puede con lo suyo ---
    // D16: el catálogo lo escribe el personal de la sede (aquí, su barbero).
    const controlPropio = await request(app.getHttpServer())
      .patch(`${api}/shops/${barberiaA}/services/${servicioA}`)
      .set('Authorization', jwt(tokenBarberoA))
      .send({ nombre: 'Corte E1-06-CTA de A (editado por su barbero)' });

    // CATÁLOGO PRIVADO HASTA EL VÍNCULO (decision del dueno, E1-06 paso 5).
    // Un CLIENTE sin fila ACTIVA en cliente_barberias para esa sede recibe 403
    // en /shops/:shopId/services y /shops/:shopId/combos.
    const catalogoSuelto = await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaA}/services`)
      .set('Authorization', jwt(tokenSuelto));

    const combosSuelto = await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaA}/combos`)
      .set('Authorization', jwt(tokenSuelto));

    // CONTROL POSITIVO: el mismo rol CLIENTE, pero VINCULADO a A con fila ACTIVA,
    // sigue viendo el catalogo de A con normalidad. Sin este caso, un arreglo que
    // denegase a todos los CLIENTES pasaria el spec por el motivo equivocado.
    const catalogoVinculado = await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaA}/services`)
      .set('Authorization', jwt(tokenVinculado));

    const combosVinculado = await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaA}/combos`)
      .set('Authorization', jwt(tokenVinculado));

    // El vinculo con B esta DESVINCULADO: el mismo cliente que si lee A no puede
    // leer el catalogo de B. Comprueba que la regla mira `estado_vinculacion` y
    // no solo la existencia de la fila.
    const catalogoVinculadoB = await request(app.getHttpServer())
      .get(`${api}/shops/${barberiaB}/services`)
      .set('Authorization', jwt(tokenVinculado));

    console.log(
      '\n| ruta | intento | estado |\n|---|---|---|\n' +
        casos.map((c) => `| \`${c.ruta}\` | ${c.intento} | ${c.estado} |`).join('\n') +
        `\n| \`PATCH /shops/:shopId/services/:id\` | *CONTROL* el barbero edita SU servicio | ${controlPropio.status} |` +
        `\n| \`GET /shops/:shopId/hours (ruta A, cabecera B)\` | *CONTROL* lee A (diaSemana 1), no B (7) | ${rutaAconCabeceraB.status} |` +
        `\n| \`GET /shops/:shopId/services\` | cliente SIN vinculo lee el catalogo de A | ${catalogoSuelto.status} |` +
        `\n| \`GET /shops/:shopId/combos\` | cliente SIN vinculo lee los combos de A | ${combosSuelto.status} |` +
        `\n| \`GET /shops/:shopId/services\` | *CONTROL* cliente VINCULADO lee el catalogo de A | ${catalogoVinculado.status} |` +
        `\n| \`GET /shops/:shopId/combos\` | *CONTROL* cliente VINCULADO lee los combos de A | ${combosVinculado.status} |` +
        `\n| \`GET /shops/:shopId/services\` | cliente con vinculo DESVINCULADO en B | ${catalogoVinculadoB.status} |\n`,
    );

    // El control positivo tiene que pasar: si esto no es 2xx, el 403/404 de los
    // casos ajenos no estaría probando aislamiento sino una app que deniega todo.
    expect(controlPropio.status, 'control positivo: el barbero edita el servicio de su sede').toBe(200);

    // La regla de vinculo: sin fila ACTIVA, 403 en servicios y combos.
    expect(catalogoSuelto.status, 'cliente sin vinculo: /shops/:shopId/services').toBe(403);
    expect(combosSuelto.status, 'cliente sin vinculo: /shops/:shopId/combos').toBe(403);

    // Y el control positivo tiene que seguir en verde: vinculo ACTIVO, catalogo
    // propio de A, con el servicio de A dentro y sin el de B.
    expect(catalogoVinculado.status, 'cliente vinculado: /shops/:shopId/services').toBe(200);
    expect(combosVinculado.status, 'cliente vinculado: /shops/:shopId/combos').toBe(200);
    expect(
      (catalogoVinculado.body as { id: string }[]).map((s) => s.id),
      'el cliente vinculado ve el servicio de su sede',
    ).toContain(servicioA);
    expect(
      (catalogoVinculado.body as { id: string }[]).map((s) => s.id),
      'el cliente vinculado NO ve el catalogo de la sede ajena',
    ).not.toContain(servicioB);
    expect(
      (combosVinculado.body as { id: string }[]).map((c) => c.id),
      'el cliente vinculado ve el combo de su sede',
    ).toContain(comboA);

    // Vinculo DESVINCULADO con B: mismo cliente, otra sede, 403.
    expect(catalogoVinculadoB.status, 'vinculo suspendido: no lee el catalogo de B').toBe(403);

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
    // E2-07: liberar escribe `liberado_at`; el intento cross-tenant no lo tocó.
    expect(bloqueoBDespues?.liberadoAt).toBeNull();
  }, 120000);
});