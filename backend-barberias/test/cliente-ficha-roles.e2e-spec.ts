import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { ClienteModule } from '../src/cliente/cliente.module.js';
import { IamModule } from '../src/iam/iam.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter.js';
import { JwtAuthGuard } from '../src/iam/infrastructure/jwt-auth.guard.js';
import { RolesGuard } from '../src/iam/infrastructure/roles.guard.js';

/**
 * El rol `ADMIN` no existe en el catálogo de roles.
 *
 * `roles.ts` solo declara ADMINISTRADOR, ADMIN_BARBERIA, BARBERO y CLIENTE, así
 * que `@Roles('BARBERO', 'ADMIN')` en las rutas de ficha y notas era una
 * contradicción con el propio dominio: nadie podía tener ese rol y el
 * ADMIN_BARBERIA de la sede —que es quien gestiona a sus clientes— recibía 403
 * sin querer.
 *
 * El spec monta `ClienteModule` por separado porque en la aplicación el módulo
 * está DESACTIVADO a propósito (H22, hasta E4-05): `app.module.spec.ts` exige
 * que `ClienteController` no aparezca en el grafo, así que contra `AppModule`
 * estas rutas responderían 404 y el test no probaría el rol de nada. Lo que se
 * prueba aquí es la política del controlador, que es lo que este PR cambia; que
 * la ruta esté o no publicada es otra decisión, ya tomada y con su propio test.
 */
describe('Cliente · ficha y notas: qué rol entra de verdad', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const correos = [
    'admin.a.roles@test.com',
    'barbero.a.roles@test.com',
    'ajeno.roles@test.com',
    'cliente.roles@test.com',
  ];

  let barberiaA: string;
  let barberiaB: string;
  let clienteId: string;
  let tokenAdminA: string;
  let tokenBarberoA: string;
  let tokenAjeno: string;

  const api = '/api/v1';

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

  beforeAll(async () => {
    // Los mismos dos guards globales que la app: sin ellos `@Roles` no se evalua
    // y el test pasaria sin comprobar nada. Los dos reciben el `Reflector` a
    // mano porque aqui se instancian fuera del contenedor.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [IamModule, ClienteModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // El `Reflector` se pasa a mano porque los guards globales de la app los
    // instancia el contenedor de Nest; aqui se crean fuera de el.
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
    prisma = app.get(PrismaService);

    // Idempotente. Barberías antes que usuarios: `responsable_id` es FK.
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.antecedente.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.barberia.deleteMany({ where: { nombre: { contains: 'ROLES-E2E' } } });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });

    const [rolAdmin, rolBarbero] = await Promise.all([
      prisma.rol.upsert({
        where: { nombre: 'ADMIN_BARBERIA' },
        update: {},
        // `ambito: 'GLOBAL'` es la convencion del producto (prisma/seed.ts:56).
        // Con `BARBERIA` y `barberia_id` en la fila de `usuario_roles` el alcance
        // tambien funciona, pero sembrar el rol GLOBAL deja claro que el filtro
        // que importa en este spec es el de `usuario_roles.barberia_id`.
        create: { nombre: 'ADMIN_BARBERIA', ambito: 'GLOBAL' },
      }),
      prisma.rol.upsert({
        where: { nombre: 'BARBERO' },
        update: {},
        create: { nombre: 'BARBERO', ambito: 'GLOBAL' },
      }),
    ]);

    const adminA = await crearUsuario('admin.a.roles@test.com', 'Admin A', '9994100001');
    const barberoA = await crearUsuario('barbero.a.roles@test.com', 'Barbero A', '9994100002');
    const ajeno = await crearUsuario('ajeno.roles@test.com', 'Ajeno', '9994100003');
    const cliente = await crearUsuario('cliente.roles@test.com', 'Cliente', '9994100004');

    barberiaA = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia A ROLES-E2E',
          telefono: '9994111111',
          ubicacion: 'A',
          codigoAcceso: 'ROLES-A',
          enlaceUnico: 'https://a.roles.test/x',
          responsableId: adminA.id,
        },
      })
    ).id;
    barberiaB = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barberia B ROLES-E2E',
          telefono: '9994222222',
          ubicacion: 'B',
          codigoAcceso: 'ROLES-B',
          enlaceUnico: 'https://b.roles.test/x',
          responsableId: ajeno.id,
        },
      })
    ).id;
    clienteId = cliente.id;

    // El ADMIN_BARBERIA y el BARBERO con `barberiaId` en su fila: es el vínculo
    // que `alcanceCumple` mira. El de B es de otra sede a propósito.
    await prisma.usuarioRol.createMany({
      data: [
        { usuarioId: adminA.id, rolId: rolAdmin.id, barberiaId: barberiaA },
        { usuarioId: barberoA.id, rolId: rolBarbero.id, barberiaId: barberiaA },
        { usuarioId: ajeno.id, rolId: rolAdmin.id, barberiaId: barberiaB },
      ],
    });

    const login = async (correo: string) => {
      const res = await request(app.getHttpServer())
        .post(`${api}/auth/login`)
        .send({ correo, password: 'Password1!' });
      expect([200, 201], `login de ${correo}`).toContain(res.status);
      return res.body.accessToken as string;
    };

    tokenAdminA = await login('admin.a.roles@test.com');
    tokenBarberoA = await login('barbero.a.roles@test.com');
    tokenAjeno = await login('ajeno.roles@test.com');
  }, 60000);

  afterAll(async () => {
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.antecedente.deleteMany({ where: { usuario: { correo: { in: correos } } } });
    await prisma.barberia.deleteMany({ where: { nombre: { contains: 'ROLES-E2E' } } });
    await prisma.usuario.deleteMany({ where: { correo: { in: correos } } });
    await app.close();
  }, 30000);

  it('el ADMIN_BARBERIA de la sede lee la ficha de un cliente de su sede', async () => {
    const res = await request(app.getHttpServer())
      .get(`${api}/clientes/${clienteId}/ficha`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('x-barberia-id', barberiaA);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(clienteId);
  });

  it('el ADMIN_BARBERIA de la sede escribe una nota de un cliente de su sede', async () => {
    const res = await request(app.getHttpServer())
      .post(`${api}/clientes/${clienteId}/notas`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('x-barberia-id', barberiaA)
      .send({ contenido: 'Nota escrita por el ADMIN_BARBERIA' });

    expect(res.status).toBe(201);
    expect(res.body.contenido).toBe('Nota escrita por el ADMIN_BARBERIA');

    // La nota existe de verdad, con la sede que envió la petición.
    const nota = await prisma.antecedente.findUnique({ where: { id: res.body.id } });
    expect(nota?.barberiaOrigenId).toBe(barberiaA);
  });

  it('el BARBERO sigue entrando: no es una regresión del cambio de rol', async () => {
    const ficha = await request(app.getHttpServer())
      .get(`${api}/clientes/${clienteId}/ficha`)
      .set('Authorization', `Bearer ${tokenBarberoA}`)
      .set('x-barberia-id', barberiaA);
    expect(ficha.status).toBe(200);

    const nota = await request(app.getHttpServer())
      .post(`${api}/clientes/${clienteId}/notas`)
      .set('Authorization', `Bearer ${tokenBarberoA}`)
      .set('x-barberia-id', barberiaA)
      .send({ contenido: 'Nota del barbero' });
    expect(nota.status).toBe(201);
  });

  it('el ADMIN_BARBERIA de OTRA sede no entra: sigue siendo cross-tenant', async () => {
    // El arreglo abre la ruta al ADMIN_BARBERIA, no a cualquier admin. Este es
    // el control que separa "arreglar el rol equivocado" de "abrir la ruta".
    const ficha = await request(app.getHttpServer())
      .get(`${api}/clientes/${clienteId}/ficha`)
      .set('Authorization', `Bearer ${tokenAjeno}`)
      .set('x-barberia-id', barberiaA);
    expect(ficha.status).toBe(403);

    const nota = await request(app.getHttpServer())
      .post(`${api}/clientes/${clienteId}/notas`)
      .set('Authorization', `Bearer ${tokenAjeno}`)
      .set('x-barberia-id', barberiaA)
      .send({ contenido: 'Nota de un admin de otra sede' });
    expect(nota.status).toBe(403);
  });
});