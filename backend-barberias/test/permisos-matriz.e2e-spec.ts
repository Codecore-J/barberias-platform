import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/iam/infrastructure/jwt-auth.guard.js';

/**
 * E2E de la matriz de permisos de E1-05 sobre HTTP real: 4 usuarios (uno por
 * rol) y 2 barberías (la del tenant y otra para el cruce).
 *
 * El test comprueba PERMISOS, no reglas de negocio: espera 403 cuando el rol no
 * está en la política y cualquier otro código cuando sí está. Un 400 por un
 * cuerpo incompleto es una respuesta válida de una ruta permitida.
 *
 * Solo se ejecuta en Docker local (`npx vitest run --config vitest.e2e.ts`).
 * Nunca contra Neon.
 */

const ROLES = ['ADMINISTRADOR', 'ADMIN_BARBERIA', 'BARBERO', 'CLIENTE'] as const;
type Rol = (typeof ROLES)[number];

const TODOS: Rol[] = ['ADMINISTRADOR', 'ADMIN_BARBERIA', 'BARBERO', 'CLIENTE'];

interface Caso {
  verbo: 'get' | 'post' | 'patch' | 'delete';
  ruta: string;
  permitidos: Rol[];
  cuerpo?: Record<string, unknown>;
  /** El ADMINISTRADOR se comprueba aparte cuando la ruta altera datos. */
  sinAdministrador?: boolean;
}

const CASOS: Caso[] = [
  // ── barbería ────────────────────────────────────────────────────────────
  { verbo: 'patch', ruta: '/barberias/{A}/seleccionar', permitidos: ['CLIENTE', 'ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/barberias/vincular', permitidos: ['CLIENTE', 'ADMINISTRADOR'], cuerpo: { codigoAcceso: 'TESTPM' } },
  { verbo: 'patch', ruta: '/barberias/{A}', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: { nombre: 'Matriz permisos' } },
  { verbo: 'get', ruta: '/barberias/{A}', permitidos: TODOS },
  { verbo: 'get', ruta: '/barberias/{A}/personal', permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR'] },
  { verbo: 'delete', ruta: '/barberias/{B}', permitidos: [], sinAdministrador: true },

  // ── agenda ──────────────────────────────────────────────────────────────
  { verbo: 'get', ruta: '/agenda/bloqueos', permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/barberias/{A}/agenda/bloqueos', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'delete', ruta: `/barberias/{A}/agenda/bloqueos/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: '/agenda/disponibilidad?fecha=2026-10-05&duracionMinutos=30', permitidos: TODOS },
  { verbo: 'post', ruta: '/barberias/{A}/agenda/disponibilidad', permitidos: TODOS, cuerpo: { fecha: '2026-10-05', duracionTotal: 30 } },

  // ── antecedentes ─────────────────────────────────────────────────────────
  { verbo: 'post', ruta: '/barberias/{A}/antecedentes', permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'patch', ruta: `/barberias/{A}/antecedentes/${randomUUID()}/evaluar`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'get', ruta: '/barberias/{A}/antecedentes/pendientes', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: `/barberias/{A}/antecedentes/cliente/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },

  // ── horarios ─────────────────────────────────────────────────────────────
  { verbo: 'get', ruta: '/barberias/{A}/horarios', permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/barberias/{A}/horarios', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: [] },
  { verbo: 'get', ruta: '/barberias/{A}/horarios/mi-horario', permitidos: ['BARBERO', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/barberias/{A}/horarios/mi-horario', permitidos: ['BARBERO', 'ADMINISTRADOR'], cuerpo: [] },
  { verbo: 'get', ruta: '/barberias/{A}/horarios/excepciones', permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/barberias/{A}/horarios/excepciones', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'post', ruta: `/barberias/{A}/horarios/barberos/${randomUUID()}/excepciones`, permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },

  // ── pagos ────────────────────────────────────────────────────────────────
  { verbo: 'get', ruta: '/cobros/auditoria', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/cobros', permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },

  // ── reservas ─────────────────────────────────────────────────────────────
  { verbo: 'post', ruta: '/reservas', permitidos: TODOS, cuerpo: {} },
  { verbo: 'get', ruta: '/reservas/mis-reservas', permitidos: ['CLIENTE', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: '/reservas/agenda?fecha=2026-10-05', permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: `/reservas/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR'] },
  { verbo: 'patch', ruta: `/reservas/${randomUUID()}/estado`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: { estado: 'CANCELADA' } },
  { verbo: 'post', ruta: `/reservas/${randomUUID()}/inasistencia`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },

  // ── catálogo ─────────────────────────────────────────────────────────────
  { verbo: 'get', ruta: '/catalogo/servicios', permitidos: TODOS },
  { verbo: 'post', ruta: '/catalogo/servicios', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'get', ruta: `/catalogo/servicios/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR'] },
  { verbo: 'patch', ruta: `/catalogo/servicios/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'delete', ruta: `/catalogo/servicios/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: '/catalogo/combos', permitidos: TODOS },
  { verbo: 'post', ruta: '/catalogo/combos', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'get', ruta: `/catalogo/combos/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR'] },
  { verbo: 'patch', ruta: `/catalogo/combos/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'delete', ruta: `/catalogo/combos/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
];

describe('Matriz de permisos rol × ruta sobre HTTP (E1-05)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const correos: Record<Rol, string> = {
    ADMINISTRADOR: 'pm_admin@matriz.test',
    ADMIN_BARBERIA: 'pm_adminb@matriz.test',
    BARBERO: 'pm_barbero@matriz.test',
    CLIENTE: 'pm_cliente@matriz.test',
  };

  const duenios = ['pm_duenio@matriz.test', 'pm_duenio_a@matriz.test'];
  const tokens: Partial<Record<Rol, string>> = {};
  const barberia = { a: '', b: '' };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // La matriz dispara más de 120 peticiones por minuto: sin esto el
      // throttler global devolvería 429 y falsearía el resultado.
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
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalGuards(new JwtAuthGuard(moduleFixture.get('Reflector')));

    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get(JwtService);

    await limpiar();

    // ── Catálogo de roles (idempotente) ────────────────────────────────────
    const roles: Record<string, { id: string }> = {};
    for (const [nombre, ambito] of [
      ['ADMINISTRADOR', 'GLOBAL'],
      ['ADMIN_BARBERIA', 'BARBERIA'],
      ['BARBERO', 'BARBERIA'],
      ['CLIENTE', 'GLOBAL'],
    ] as [string, string][]) {
      roles[nombre] = await prisma.rol.upsert({
        where: { nombre },
        update: { ambito },
        create: { nombre, ambito },
        select: { id: true },
      });
    }

    // ── Barbería B: destino del DELETE que solo puede hacer el ADMINISTRADOR ─
    const duenioB = await crearUsuario(duenios[0], roles['ADMIN_BARBERIA'].id, null);
    barberia.b = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barbería Matriz B',
          telefono: '600000002',
          ubicacion: 'Segunda sede',
          estado: 'ACTIVA',
          codigoAcceso: 'TESTPMB',
          enlaceUnico: 'matriz-b',
          responsableId: duenioB,
        },
      })
    ).id;

    // ── Barbería A: el tenant de los cuatro usuarios ──────────────────────
    const duenioA = await crearUsuario(duenios[1], roles['ADMIN_BARBERIA'].id, null);
    barberia.a = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barbería Matriz A',
          telefono: '600000001',
          ubicacion: 'Sede principal',
          estado: 'ACTIVA',
          codigoAcceso: 'TESTPMA',
          enlaceUnico: 'matriz-a',
          responsableId: duenioA,
        },
      })
    ).id;

    // ── Un usuario por rol ────────────────────────────────────────────────
    await crearUsuario(correos.ADMINISTRADOR, roles['ADMINISTRADOR'].id, null);
    const adminBarberiaId = await crearUsuario(
      correos.ADMIN_BARBERIA,
      roles['ADMIN_BARBERIA'].id,
      barberia.a,
    );
    await crearUsuario(correos.BARBERO, roles['BARBERO'].id, barberia.a);
    const clienteId = await crearUsuario(correos.CLIENTE, roles['CLIENTE'].id, null);

    // El CLIENTE queda vinculado a la barbería A con vínculo activo.
    await prisma.clienteBarberia.create({
      data: {
        usuarioId: clienteId,
        barberiaId: barberia.a,
        estadoVinculacion: 'ACTIVO',
        esBarberiaActiva: true,
      },
    });

    const sesiones: [Rol, string][] = [
      ['ADMINISTRADOR', correos.ADMINISTRADOR],
      ['ADMIN_BARBERIA', correos.ADMIN_BARBERIA],
      ['BARBERO', correos.BARBERO],
      ['CLIENTE', correos.CLIENTE],
    ];
    for (const [rol, correo] of sesiones) {
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { correo } });
      tokens[rol] = await jwtService.signAsync({
        sub: usuario.id,
        correo: usuario.correo,
        roles: [rol],
      });
    }

    expect(adminBarberiaId).toBeTruthy();
  }, 120_000);

  async function crearUsuario(correo: string, rolId: string, barberiaId: string | null) {
    const usuario = await prisma.usuario.create({
      data: {
        nombreCompleto: `Matriz ${correo}`,
        correo,
        telefono: '600000000',
        passwordHash: '$2b$10$HashFalsoMatrizPermisosNoSeUsaParaLogin',
        estadoCuenta: 'ACTIVO',
        usuarioRoles: { create: [{ rolId, barberiaId }] },
      },
      select: { id: true },
    });
    return usuario.id;
  }

  async function limpiar() {
    const correosPrueba = [...Object.values(correos), ...duenios];
    await prisma.usuarioRol.deleteMany({ where: { usuario: { correo: { in: correosPrueba } } } });
    await prisma.clienteBarberia.deleteMany({ where: { usuario: { correo: { in: correosPrueba } } } });
    await prisma.barberia.deleteMany({
      where: { nombre: { in: ['Barbería Matriz A', 'Barbería Matriz B'] } },
    });
    await prisma.usuario.deleteMany({ where: { correo: { in: correosPrueba } } });
  }

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 120_000);

  async function llamar(caso: Caso, rol: Rol) {
    const ruta = caso.ruta.replace('{A}', barberia.a).replace('{B}', barberia.b);
    const peticion = request(app.getHttpServer())[caso.verbo](ruta)
      .set('Authorization', `Bearer ${tokens[rol]}`)
      .set('x-barberia-id', barberia.a);
    if (caso.cuerpo !== undefined) {
      peticion.send(caso.cuerpo);
    }
    return peticion;
  }

  it(`denegar o permitir cada ruta segun el rol (${CASOS.length} rutas × 4 roles)`, async () => {
    const fallos: string[] = [];
    const tabla: string[] = [];

    for (const caso of CASOS) {
      const estados: string[] = [];

      for (const rol of ROLES) {
        if (caso.sinAdministrador && rol === 'ADMINISTRADOR') {
          estados.push('n/d ');
          continue;
        }

        const res = await llamar(caso, rol);
        const permitido = res.status !== 403;

        if (permitido !== caso.permitidos.includes(rol)) {
          fallos.push(`${caso.verbo.toUpperCase()} ${caso.ruta} · ${rol} · ${res.status}`);
        }
        estados.push(permitido ? ` ${String(res.status).padEnd(3)}` : '403 ');
      }

      tabla.push(
        `${`${caso.verbo.toUpperCase()} ${caso.ruta}`.padEnd(56)} | ADM:${estados[0]} | ADM_B:${estados[1]} | BARB:${estados[2]} | CLIEN:${estados[3]}`,
      );
    }

    console.log(`\n=== MATRIZ HTTP (${CASOS.length} rutas × 4 roles) ===`);
    for (const fila of tabla) {
      console.log(fila);
    }
    console.log('');

    expect(fallos.length === 0 ? '' : `${fallos.length} desviaciones:\n${fallos.join('\n')}`).toBe('');
  }, 180_000);

  it('ocultar codigoAcceso y enlaceUnico en GET /barberias/:id salvo ADMIN_BARBERIA de esa barberia y ADMINISTRADOR', async () => {
    for (const rol of ROLES) {
      for (const [sede, id] of [
        ['A', barberia.a],
        ['B', barberia.b],
      ] as [string, string][]) {
        const res = await request(app.getHttpServer())
          .get(`/barberias/${id}`)
          .set('Authorization', `Bearer ${tokens[rol]}`)
          .set('x-barberia-id', barberia.a);

        expect(`${rol} sede ${sede} status ${res.status}`).toBe(`${rol} sede ${sede} status 200`);

        // El ADMIN_BARBERIA solo ve el código de SU barbería.
        const puedeVerCodigo = rol === 'ADMINISTRADOR' || (rol === 'ADMIN_BARBERIA' && sede === 'A');

        if (puedeVerCodigo) {
          expect(res.body.codigoAcceso).toBeDefined();
          expect(res.body.enlaceUnico).toBeDefined();
        } else {
          expect(res.body.codigoAcceso).toBeUndefined();
          expect(res.body.enlaceUnico).toBeUndefined();
          // Los datos públicos de la barbería siguen presentes.
          expect(res.body.nombre).toBeDefined();
          expect(res.body.ubicacion).toBeDefined();
          expect(res.body.telefono).toBeDefined();
        }
      }
    }
  }, 120_000);

  it('desactivar la barberia solo con ADMINISTRADOR', async () => {
    for (const rol of ['CLIENTE', 'BARBERO', 'ADMIN_BARBERIA'] as Rol[]) {
      const res = await llamar({ verbo: 'delete', ruta: '/barberias/{B}', permitidos: [] }, rol);
      expect(`${rol} ${res.status}`).toBe(`${rol} 403`);
    }

    const res = await request(app.getHttpServer())
      .delete(`/barberias/${barberia.b}`)
      .set('Authorization', `Bearer ${tokens.ADMINISTRADOR}`)
      .set('x-barberia-id', barberia.a);

    expect([200, 204]).toContain(res.status);

    const estado = await prisma.barberia.findUniqueOrThrow({
      where: { id: barberia.b },
      select: { estado: true },
    });
    expect(estado.estado).toBe('INACTIVO');
  }, 120_000);
});