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
  { verbo: 'patch', ruta: '/barberias/{A}/seleccionar', permitidos: ['CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/barberias/vincular', permitidos: ['CLIENTE', 'ADMINISTRADOR'], cuerpo: { codigoAcceso: 'TESTPM' } },
  // E3-13: `PATCH /barberias/:id` ya no renombra (el nombre va por solicitud),
  // asi que la matriz mide el decorador con un campo que SI se edita directo.
  { verbo: 'patch', ruta: '/barberias/{A}', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: { descripcion: 'Matriz permisos' } },
  { verbo: 'post', ruta: '/barberias/{A}/solicitudes-cambio', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: { tipo: 'NOMBRE', valorNuevo: 'Matriz permisos E3-13' } },
  { verbo: 'get', ruta: '/plataforma/solicitudes-cambio', permitidos: ['ADMINISTRADOR'] },
  // H54 (E4-03/2): el estado propio lo consulta el CLIENTE. El ADMINISTRADOR no
  // se mide aquí a propósito: no tiene vinculación propia en la sede, así que
  // recibe 403 `NO_VINCULADO` del servicio y eso NO es una denegación de permiso.
  { verbo: 'get', ruta: '/barberias/{A}/mi-estado', permitidos: ['CLIENTE'], sinAdministrador: true },
  // E4-03/5: suspender una cuenta es de la plataforma; el resto recibe 403 del
  // guard. Con un UUID al azar, el ADMINISTRADOR recibe 404 (la cuenta no
  // existe), que también es «permitido» para esta matriz.
  { verbo: 'patch', ruta: `/plataforma/usuarios/${randomUUID()}/estado`, permitidos: ['ADMINISTRADOR'], cuerpo: { estadoCuenta: 'SUSPENDIDO', motivo: 'Matriz de permisos E4-03/5' } },
  { verbo: 'post', ruta: `/plataforma/solicitudes-cambio/${randomUUID()}/resolver`, permitidos: ['ADMINISTRADOR'], cuerpo: { aprobar: true } },
  // E4-03: la bandeja local de restringidos es de la SEDE (y del ADMINISTRADOR
  // por jerarquía). El guard solo filtra el rol: la pertenencia a la sede la
  // comprueba el servicio y aquí no se mide (un 404 de un cliente sin vínculo
  // es una respuesta válida de una ruta permitida).
  { verbo: 'get', ruta: '/barberias/{A}/clientes-restringidos', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: `/barberias/{A}/clientes/${randomUUID()}/reactivar`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'get', ruta: '/barberias/{A}', permitidos: TODOS },
  { verbo: 'get', ruta: '/barberias/{A}/personal', permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR'] },
  // E2-07: el borrado lógico de la sede pasa a cambio de estado explícito.
  { verbo: 'patch', ruta: '/barberias/{B}/estado', permitidos: [], sinAdministrador: true, cuerpo: { estado: 'INACTIVO' } },

  // ── agenda ──────────────────────────────────────────────────────────────
  { verbo: 'get', ruta: '/agenda/bloqueos', permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/barberias/{A}/agenda/bloqueos', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  // E2-07: liberar un bloqueo en vez de borrarlo. Con un UUID al azar el
  // servicio responde 404, que tambien es «permitido» para esta matriz.
  { verbo: 'post', ruta: `/barberias/{A}/agenda/bloqueos/${randomUUID()}/liberar`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: '/agenda/disponibilidad?fecha=2026-10-05&duracionMinutos=30', permitidos: TODOS },
  { verbo: 'post', ruta: '/barberias/{A}/agenda/disponibilidad', permitidos: TODOS, cuerpo: { fecha: '2026-10-05', duracionTotal: 30 } },
  // E4-02: los huecos de espacio no son para el BARBERO (§E4-02/2).
  { verbo: 'get', ruta: '/barberias/{A}/disponibilidad/huecos?fecha=2026-10-05&duracionMinutos=30', permitidos: ['CLIENTE', 'ADMIN_BARBERIA', 'ADMINISTRADOR'] },

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
  { verbo: 'post', ruta: '/barberias/{A}/horarios/barberos/{BARBERO}/excepciones', permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },

  // ── pagos ────────────────────────────────────────────────────────────────
  { verbo: 'get', ruta: '/cobros/auditoria', permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'] },
  { verbo: 'post', ruta: '/cobros', permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },

  // ── reservas ─────────────────────────────────────────────────────────────
  // E3-03: el alias se parte en dos rutas con política distinta. `/reservas`
  // queda para el wizard del CLIENTE (con el ADMINISTRADOR, que el guard
  // concede por jerarquía, E1-04) y el walk-in de la agenda pasa a
  // `/reservas/walk-in` con los tres roles de la sede. Ver también
  // `test/reserva-walkin-split.e2e-spec.ts` para el efecto real sobre un
  // recurso (aquí solo se mide el 403 del guard).
  { verbo: 'post', ruta: '/reservas', permitidos: ['CLIENTE', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'post', ruta: '/reservas/walk-in', permitidos: ['BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },
  { verbo: 'get', ruta: '/reservas/mis-reservas', permitidos: ['CLIENTE', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: '/reservas/agenda?fecha=2026-10-05', permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR'] },
  { verbo: 'get', ruta: `/reservas/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR'] },
  // E2-02 (2026-10-11): `PATCH /reservas/:id/estado` ya no existe (el caso se
  // quitó de la matriz; con él, cualquier rol recibía 404). El no presentado
  // conserva su ruta dedicada.
  { verbo: 'post', ruta: `/reservas/${randomUUID()}/inasistencia`, permitidos: ['ADMIN_BARBERIA', 'ADMINISTRADOR'], cuerpo: {} },

  // ── catálogo ─────────────────────────────────────────────────────────────
  // D16 corregido: lecturas para todos (vitrina pública incluida) y escrituras
  // SOLO del BARBERO. El ADMINISTRADOR global tampoco escribe el catálogo: la
  // jerarquía de `RolesGuard` reparte acceso, no propiedad del negocio.
  { verbo: 'get', ruta: '/catalogo/servicios', permitidos: TODOS },
  { verbo: 'post', ruta: '/catalogo/servicios', permitidos: ['BARBERO'], cuerpo: {} },
  { verbo: 'get', ruta: `/catalogo/servicios/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR'] },
  { verbo: 'patch', ruta: `/catalogo/servicios/${randomUUID()}`, permitidos: ['BARBERO'], cuerpo: {} },
  { verbo: 'patch', ruta: `/catalogo/servicios/${randomUUID()}/desactivar`, permitidos: ['BARBERO'] },
  { verbo: 'patch', ruta: `/catalogo/servicios/${randomUUID()}/reactivar`, permitidos: ['BARBERO'] },
  { verbo: 'get', ruta: '/catalogo/combos', permitidos: TODOS },
  { verbo: 'post', ruta: '/catalogo/combos', permitidos: ['BARBERO'], cuerpo: {} },
  { verbo: 'get', ruta: `/catalogo/combos/${randomUUID()}`, permitidos: ['ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR'] },
  { verbo: 'patch', ruta: `/catalogo/combos/${randomUUID()}`, permitidos: ['BARBERO'], cuerpo: {} },
  { verbo: 'patch', ruta: `/catalogo/combos/${randomUUID()}/desactivar`, permitidos: ['BARBERO'] },
  { verbo: 'patch', ruta: `/catalogo/combos/${randomUUID()}/reactivar`, permitidos: ['BARBERO'] },

  // ── E3-12/3 · la salida del cliente por su cuenta ─────────────────────────
  // Va al FINAL a propósito: es la única ruta de la matriz que CAMBIA el
  // fixture (deja el vínculo del CLIENTE con la sede A en `DESVINCULADO`) y
  // ninguna comprobación posterior depende de que siga ACTIVO. El
  // ADMINISTRADOR no se mide aquí: no tiene vínculo propio en la sede, así que
  // recibiría un 403 `NO_VINCULADO` del servicio y eso no es una decisión del
  // guard (misma razón que en `GET .../mi-estado`).
  { verbo: 'post', ruta: '/barberias/{A}/mi-estado/desvincular', permitidos: ['CLIENTE'], sinAdministrador: true },
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

  const duenios = ['pm_duenio@matriz.test'];
  const tokens: Partial<Record<Rol, string>> = {};
  const barberia = { a: '', b: '' };
  const usuarios: { barbero: string } = { barbero: '' };

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

    // ── Barbería B: destino del cambio de estado que solo puede hacer el ADMINISTRADOR ─
    const duenioB = await crearUsuario(duenios[0], roles['ADMIN_BARBERIA'].id, null);
    barberia.b = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barbería Matriz B',
          telefono: '600000002',
          ubicacion: 'Segunda sede',
          estado: 'ACTIVO',
          codigoAcceso: 'TESTPMB',
          enlaceUnico: 'matriz-b',
          responsableId: duenioB,
        },
      })
    ).id;

    // ── Barbería A: el tenant de los cuatro usuarios ──────────────────────
    // Su responsable es el propio ADMIN_BARBERIA del test: `PATCH /barberias/:id`
    // solo deja editar a quien figura como responsable, y aqui lo que se quiere
    // medir es el decorador, no esa comprobación del servicio.
    const adminBarberiaId = await crearUsuario(correos.ADMIN_BARBERIA, roles['ADMIN_BARBERIA'].id, null);
    barberia.a = (
      await prisma.barberia.create({
        data: {
          nombre: 'Barbería Matriz A',
          telefono: '600000001',
          ubicacion: 'Sede principal',
          estado: 'ACTIVO',
          codigoAcceso: 'TESTPMA',
          enlaceUnico: 'matriz-a',
          responsableId: adminBarberiaId,
        },
      })
    ).id;

    await prisma.usuarioRol.updateMany({
      where: { usuarioId: adminBarberiaId },
      data: { barberiaId: barberia.a },
    });

    // ── Un usuario por rol ────────────────────────────────────────────────
    await crearUsuario(correos.ADMINISTRADOR, roles['ADMINISTRADOR'].id, null);
    const barberoId = await crearUsuario(correos.BARBERO, roles['BARBERO'].id, barberia.a);
    const clienteId = await crearUsuario(correos.CLIENTE, roles['CLIENTE'].id, null);
    usuarios.barbero = barberoId;

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
    expect(barberoId).toBeTruthy();
  }, 120_000);

  // `telefono` es único en el esquema: cada usuario del test recibe el suyo.
  let secuenciaTelefono = 0;

  async function crearUsuario(correo: string, rolId: string, barberiaId: string | null) {
    secuenciaTelefono += 1;
    const usuario = await prisma.usuario.create({
      data: {
        nombreCompleto: `Matriz ${correo}`,
        correo,
        telefono: `6${String(secuenciaTelefono).padStart(9, '0')}`,
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
    const usuarios = await prisma.usuario.findMany({
      where: { correo: { in: correosPrueba } },
      select: { id: true },
    });
    const idsUsuario = usuarios.map((u) => u.id);

    // Desde E3-13 `PATCH /barberias/:id` ya no renombra la sede, pero el test
    // sigue localizándolas por código de acceso o responsable (como las creó)
    // para no depender del campo que la matriz decida editar mañana.
    const sedes = await prisma.barberia.findMany({
      where: {
        OR: [
          { codigoAcceso: { in: ['TESTPMA', 'TESTPMB'] } },
          { responsableId: { in: idsUsuario } },
          { nombre: { in: ['Barbería Matriz A', 'Barbería Matriz B'] } },
        ],
      },
      select: { id: true },
    });
    const idsSede = sedes.map((s) => s.id);

    await prisma.reserva.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.reporte.deleteMany({ where: { barberiaId: { in: idsSede } } });
    await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.clienteBarberia.deleteMany({ where: { usuarioId: { in: idsUsuario } } });
    await prisma.barberia.deleteMany({ where: { id: { in: idsSede } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuario } } });
  }

  afterAll(async () => {
    await limpiar();
    await app.close();
  }, 120_000);

  async function llamar(caso: Caso, rol: Rol) {
    const ruta = caso.ruta
      .replace('{A}', barberia.a)
      .replace('{B}', barberia.b)
      .replace('{BARBERO}', usuarios.barbero);
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

  it('suspender la barberia solo con ADMINISTRADOR (E2-07)', async () => {
    for (const rol of ['CLIENTE', 'BARBERO', 'ADMIN_BARBERIA'] as Rol[]) {
      const res = await llamar(
        { verbo: 'patch', ruta: '/barberias/{B}/estado', permitidos: [], cuerpo: { estado: 'INACTIVO' } },
        rol,
      );
      expect(`${rol} ${res.status}`).toBe(`${rol} 403`);
    }

    const res = await request(app.getHttpServer())
      .patch(`/barberias/${barberia.b}/estado`)
      .set('Authorization', `Bearer ${tokens.ADMINISTRADOR}`)
      .set('x-barberia-id', barberia.a)
      .send({ estado: 'INACTIVO' });

    expect(res.status).toBe(200);

    const estado = await prisma.barberia.findUniqueOrThrow({
      where: { id: barberia.b },
      select: { estado: true },
    });
    expect(estado.estado).toBe('INACTIVO');
  }, 120_000);
});