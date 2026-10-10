import 'reflect-metadata';
import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ExecutionContext, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module.js';
import { ROLES_KEY } from '../src/iam/infrastructure/roles.decorator.js';
import { AUTENTICADO_KEY } from '../src/iam/infrastructure/autenticado.decorator.js';
import { IS_PUBLIC_KEY } from '../src/iam/infrastructure/public.decorator.js';
import { RolesGuard } from '../src/iam/infrastructure/roles.guard.js';
import {
  AMBITO_BARBERIA,
  AMBITO_GLOBAL,
  ROL_ADMINISTRADOR,
  ROL_ADMIN_BARBERIA,
  ROL_BARBERO,
  ROL_CLIENTE,
} from '../src/iam/domain/roles.js';
import type { UsuarioAutenticado } from '../src/iam/domain/jwt.interface.js';

/**
 * E1-05 · Matriz de permisos rol × ruta.
 *
 * El test no necesita base de datos: compila `AppModule` (sin inicializar los
 * módulos) y lee SOLO los metadatos de los decoradores, igual que
 * `test/route-security.spec.ts`.
 *
 * Comprueba dos cosas distintas y ambas son la política del dueño:
 *
 *  1. `POLITICA_DECLARADA`: los roles que declara cada decorador. Es lo que el
 *     código tiene que escribir, sin deducciones ni atajos.
 *  2. `MATRIZ_ESPERADA`: a qué roles `RolesGuard` concede realmente la ruta,
 *     ya con la regla de jerarquía de `RolesGuard` (el `ADMINISTRADOR` global
 *     pasa cualquier `@Roles`). El guard es el que decide, no el decorador.
 *
 * Cualquier ruta nueva que no esté en las dos constantes hace fallar el test:
 * una ruta sin decisión de permisos no puede entrar en `main`.
 */

const ROLES = [ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE] as const;
type Rol = (typeof ROLES)[number];

const BARBERIA_ID = '11111111-1111-4111-8111-111111111111';

const VERBO: Record<RequestMethod, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.SEARCH]: 'SEARCH',
} as Record<RequestMethod, string>;

const TODOS: Rol[] = [ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE];

/**
 * Roles que declara cada decorador tras E1-05. Las rutas `@Public` y
 * `@Autenticado` no declaran lista, así que admiten a los cuatro.
 */
const POLITICA_DECLARADA: Record<string, Rol[]> = {
  'GET /': TODOS,
  'POST /auth/register': TODOS,
  'POST /auth/login': TODOS,
  'GET /auth/me': TODOS,
  'POST /auth/forgot-password': TODOS,
  'POST /auth/reset-password': TODOS,
  'GET /health,api/v1/health': TODOS,
  'GET /notificaciones/mis-notificaciones': TODOS,

  'GET /auditoria/': [ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA],
  'GET /auditoria/estadisticas': [ROL_ADMINISTRADOR],
  'POST /auditoria/purgar': [ROL_ADMINISTRADOR],

  'GET /barberias/': TODOS,
  'POST /barberias/': TODOS,
  'GET /barberias/all': [ROL_ADMINISTRADOR],
  'GET /barberias/:id/personal': [ROL_ADMIN_BARBERIA, ROL_BARBERO],
  'GET /barberias/:id': TODOS,
  'PATCH /barberias/:id/seleccionar': [ROL_CLIENTE, ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'PATCH /barberias/:id': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'DELETE /barberias/:id': [ROL_ADMINISTRADOR],
  'POST /barberias/vincular': [ROL_CLIENTE],

  'GET /barberias/:barberiaId/agenda,agenda/bloqueos': [ROL_ADMIN_BARBERIA, ROL_BARBERO],
  'POST /barberias/:barberiaId/agenda,agenda/bloqueos': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'DELETE /barberias/:barberiaId/agenda,agenda/bloqueos/:id': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /barberias/:barberiaId/agenda,agenda/disponibilidad': TODOS,
  'POST /barberias/:barberiaId/agenda,agenda/disponibilidad': TODOS,

  'POST /barberias/:barberiaId/antecedentes/': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'PATCH /barberias/:barberiaId/antecedentes/:id/evaluar': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /barberias/:barberiaId/antecedentes/cliente/:clienteId': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /barberias/:barberiaId/antecedentes/pendientes': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  'GET /barberias/:barberiaId/horarios/': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /barberias/:barberiaId/horarios/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /barberias/:barberiaId/horarios/mi-horario': [ROL_BARBERO],
  'POST /barberias/:barberiaId/horarios/mi-horario': [ROL_BARBERO],
  'GET /barberias/:barberiaId/horarios/excepciones': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /barberias/:barberiaId/horarios/excepciones': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /barberias/:barberiaId/horarios/barberos/:barberoId/excepciones': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  'GET /barberias/:barberiaId/pagos,cobros,pagos/auditoria': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-09 (2026-10): la política de la RUTA no cambia — el guard sigue
  // admitiendo a los tres roles en POST /cobros. Lo que se añade es una
  // comprobación de SERVICIO: un BARBERO solo cobra las reservas asignadas a
  // él (y las sin asignar solo las cobra un ADMIN), que el guard no puede ver
  // porque no consulta la reserva. Cubierto por
  // `test/pago-barbero-asignado.e2e-spec.ts` (5 casos, rojo→verde) y por el
  // describe E3-09 de `src/pago/application/pago.service.spec.ts`.
  'POST /barberias/:barberiaId/pagos,cobros,pagos/en-persona,': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  // E3-03 (2026-10): la única fila de cuatro roles se parte en dos. El alias
  // `/reservas` lo usaban DOS pantallas: el wizard del cliente
  // (`reserva-wizard.component.ts`, manda `barberoId: null`) y el modal de
  // walk-in de la agenda (`walk-in-modal.component.ts`, exige `barberoId`).
  // Con la ruta walk-in separada, cada una recibe su política real: el alias
  // vuelve a ser exclusivo del CLIENTE y el walk-in, que solo ocurre en la
  // sede y siempre con barbero, queda para el staff. No se debilita ninguna
  // de las dos: se sustituyen 4 aserciones mezcladas por 2 + 2 más estrictas.
  'POST /barberias/:barberiaId/reservas,reservas/': [ROL_CLIENTE],
  'POST /barberias/:barberiaId/reservas,reservas/walk-in': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // D44: la cotización sin persistir la usan tanto el wizard del cliente (que
  // necesita cotizar antes de crear su propia reserva) como el modal de
  // walk-in, así que declara los cuatro roles: cotizar no persiste nada y el
  // CLIENTE debe poder consultar el precio de su futura reserva.
  'POST /barberias/:barberiaId/reservas,reservas/cotizar': [ROL_CLIENTE, ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /barberias/:barberiaId/reservas,reservas/mis-reservas': [ROL_CLIENTE],
  'GET /barberias/:barberiaId/reservas,reservas/:id': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE],
  // E2-02 (2026-10-11): `PATCH .../reservas/:id/estado` se eliminó. Era un
  // «pon el estado que quieras» que escribía directo sobre `reservas.estado`
  // sin comprobar el grafo de §5.2: con ella, un ADMIN podía saltarse
  // aceptar/rechazar/cancelar y hasta cobrar sin pasar por caja. La matriz
  // pierde esa fila (64 → 63 rutas) y el único escritor de estado es ahora
  // `ReservaService.cambiarEstado`, privado y con la máquina delante.
  'POST /barberias/:barberiaId/reservas,reservas/:id/inasistencia': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-04 (2026-10-09): aceptar y rechazar una solicitud son decisiones de la
  // SEDE, no del barbero: la misma matriz que el no presentado (D02) y que el
  // cambio de estado (decisión 11, hoy ya sin ruta genérica). El `RolesGuard`
  // las acota al `barberiaId` del parámetro, así que un admin de otra sede
  // recibe 403.
  'POST /barberias/:barberiaId/reservas,reservas/:id/aceptar': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /barberias/:barberiaId/reservas,reservas/:id/rechazar': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-05 (2026-10-09): cancelar la declaran los tres roles. El CLIENTE dueño
  // cancela lo suyo y la sede cancela por mostrador; lo que el guard NO puede
  // ver —que la reserva sea del CLIENTE que la cancela— lo exige el servicio
  // (403 RESERVA_AJENA) y lo cubren las pruebas de servicio y el E2E.
  'POST /barberias/:barberiaId/reservas,reservas/:id/cancelar': [ROL_CLIENTE, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-06 (2026-10-09): reprogramar una reserva vigente es una decisión de la
  // SEDE, como aceptar, rechazar o marcar el no presentado: la misma política y
  // el mismo acotado por `barberiaId` del parámetro. La vía del CLIENTE para
  // cambiar de horario es la propuesta con ventana de 10 minutos (§5.4), que
  // sigue pendiente como tarea del backlog.
  'PATCH /barberias/:barberiaId/reservas,reservas/:id/reprogramar': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-08 (2026-10-10): la cancelación especial (D17) es una decisión de la SEDE
  // con motivo obligatorio, así que declara los mismos dos roles que aceptar,
  // rechazar o reprogramar. La propuesta de horario (D18) es la vía del CLIENTE
  // dueño y su bandeja de resolución (aceptar/rechazar) vuelve a ser de la SEDE.
  'POST /barberias/:barberiaId/reservas,reservas/:id/cancelacion-especial': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /barberias/:barberiaId/reservas,reservas/:id/proponer-horario': [ROL_CLIENTE],
  'POST /barberias/:barberiaId/reservas,reservas/:id/propuesta-horario/aceptar': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /barberias/:barberiaId/reservas,reservas/:id/propuesta-horario/rechazar': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /barberias/:barberiaId/reservas,reservas/agenda': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_ADMINISTRADOR],

  'GET /catalogo/servicios,servicios/': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'POST /catalogo/servicios,servicios/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /catalogo/servicios,servicios/:id': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'PATCH /catalogo/servicios,servicios/:id': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'DELETE /catalogo/servicios,servicios/:id': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  'GET /catalogo/combos/': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'POST /catalogo/combos/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /catalogo/combos/:id': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'PATCH /catalogo/combos/:id': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'DELETE /catalogo/combos/:id': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
};

/**
 * Decisión efectiva de `RolesGuard` por ruta y rol. Coincide con la política
 * declarada más la regla de jerarquía: `ADMINISTRADOR` tiene acceso transversal
 * y `RolesGuard` lo concede antes de mirar la lista de roles, así que pasa
 * cualquier `@Roles` (E1-04).
 */
const MATRIZ_ESPERADA: Record<string, Rol[]> = Object.fromEntries(
  Object.entries(POLITICA_DECLARADA).map(([ruta, roles]) => [
    ruta,
    roles.includes(ROL_ADMINISTRADOR) ? roles : [...roles, ROL_ADMINISTRADOR],
  ]),
);

interface RutaDescubierta {
  clave: string;
  verbo: string;
  ruta: string;
  metodo: string;
  controlador: string;
  handler: (...args: unknown[]) => unknown;
  clase: object;
  esPublica: boolean;
  esAutenticada: boolean;
  roles: string[] | undefined;
  esTenant: boolean;
}

describe('Matriz de permisos rol × ruta (E1-05)', () => {
  let rutas: RutaDescubierta[] = [];
  let guard: RolesGuard;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = new MetadataScanner();
    const reflector = moduleRef.get(Reflector);
    guard = moduleRef.get(RolesGuard);

    rutas = [];

    for (const { instance, metatype } of discovery
      .getControllers()
      .filter((wrapper) => !!wrapper.instance && !!wrapper.metatype)) {
      const prefijo = Reflect.getMetadata(PATH_METADATA, metatype as object);
      if (!prefijo) continue;

      const prototipo = Object.getPrototypeOf(instance);

      for (const nombre of scanner.getAllMethodNames(prototipo)) {
        if (nombre === 'constructor') continue;

        const descriptor = Object.getOwnPropertyDescriptor(prototipo, nombre);
        const manejador = descriptor?.value;
        if (typeof manejador !== 'function') continue;

        const verbo = Reflect.getMetadata(METHOD_METADATA, manejador);
        if (verbo === undefined) continue;

        const sufijo = Reflect.getMetadata(PATH_METADATA, manejador) ?? '';
        const ruta = `/${[prefijo, sufijo].filter(Boolean).join('/')}`.replace(/\/+/g, '/');

        const objetivos = [manejador, metatype as object];
        const esPublica = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, objetivos) === true;
        const esAutenticada = reflector.getAllAndOverride<boolean>(AUTENTICADO_KEY, objetivos) === true;
        const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, objetivos);

        const verboTexto = VERBO[verbo as RequestMethod] ?? String(verbo);

        rutas.push({
          clave: `${verboTexto} ${ruta}`,
          verbo: verboTexto,
          ruta,
          metodo: nombre,
          controlador: (metatype as { name: string }).name,
          handler: manejador,
          clase: metatype as object,
          esPublica,
          esAutenticada: esAutenticada,
          roles,
          esTenant: ruta.includes(':barberiaId'),
        });
      }
    }

    rutas.sort((a, b) => a.clave.localeCompare(b.clave));
  }, 60_000);

  /** Usuario sintético con UN solo rol, para no medir nada que no sea la ruta. */
  function usuario(rol: Rol): UsuarioAutenticado {
    const global = rol === ROL_ADMINISTRADOR;
    return {
      id: 'usuario-de-prueba',
      correo: 'matriz@prueba.local',
      roles: [rol],
      rolesDetallados: [
        {
          nombre: rol,
          barberiaId: global ? null : BARBERIA_ID,
          ambito: global ? AMBITO_GLOBAL : AMBITO_BARBERIA,
        },
      ],
    };
  }

  function contexto(ruta: RutaDescubierta, rol: Rol): ExecutionContext {
    const request = {
      method: ruta.verbo,
      originalUrl: ruta.ruta,
      params: ruta.esTenant ? { barberiaId: BARBERIA_ID } : {},
      headers: {},
      query: {},
      user: usuario(rol),
    };

    return {
      getHandler: () => ruta.handler,
      getClass: () => ruta.clase,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  /** El guard lanza `ForbiddenException` cuando deniega: eso es un `false`. */
  function permite(ruta: RutaDescubierta, rol: Rol): boolean {
    try {
      return guard.canActivate(contexto(ruta, rol)) === true;
    } catch {
      return false;
    }
  }

  // E2-02 (2026-10-11): eran 64 rutas; `PATCH /reservas/:id/estado` se eliminó
  // (ver la nota del diccionario), así que quedan 63.
  it('descubrir las 63 rutas del servidor y todas tienen decision', () => {
    const claves = rutas.map((r) => r.clave);
    expect(claves.length).toBe(63);

    const sinDecision = claves.filter((clave) => !(clave in POLITICA_DECLARADA));
    expect(
      sinDecision.length === 0
        ? ''
        : `rutas sin decision en la matriz:\n${sinDecision.join('\n')}`,
    ).toBe('');

    const sobrantes = Object.keys(POLITICA_DECLARADA).filter((clave) => !claves.includes(clave));
    expect(
      sobrantes.length === 0
        ? ''
        : `decisiones de la matriz que ya no existen en el servidor:\n${sobrantes.join('\n')}`,
    ).toBe('');
  }, 60_000);

  it('declarar en cada decorador la politica aprobada', () => {
    const desviaciones: string[] = [];

    for (const ruta of rutas) {
      const esperados = POLITICA_DECLARADA[ruta.clave];
      const declarados = ruta.roles;

      if (declarados && declarados.length > 0) {
        // El orden de la lista de roles no significa nada para el guard: se
        // compara como conjunto.
        const mismaLista =
          declarados.length === esperados.length &&
          declarados.every((rol) => esperados.includes(rol as Rol));
        if (!mismaLista) {
          desviaciones.push(
            `${ruta.clave} · declara @Roles(${declarados.join(', ')}) y la politica es @Roles(${esperados.join(', ')})`,
          );
        }
        continue;
      }

      // Sin `@Roles`: solo se admiten las rutas abiertas a cualquier autenticado.
      if (!ruta.esPublica && !ruta.esAutenticada) {
        desviaciones.push(`${ruta.clave} · sin @Public, @Autenticado ni @Roles`);
        continue;
      }
      if (ruta.esPublica && ruta.esAutenticada) {
        desviaciones.push(`${ruta.clave} · declara @Public y @Autenticado a la vez`);
      }
    }

    expect(
      desviaciones.length === 0
        ? ''
        : `${desviaciones.length} desviaciones:\n${desviaciones.join('\n')}`,
    ).toBe('');
  }, 60_000);

  it('RolesGuard concede a cada rol exactamente lo que dice la matriz', () => {
    const desviaciones: string[] = [];
    let evaluaciones = 0;

    for (const ruta of rutas) {
      const esperados = MATRIZ_ESPERADA[ruta.clave];
      for (const rol of ROLES) {
        evaluaciones += 1;
        const esperado = esperados.includes(rol);
        const obtenido = permite(ruta, rol);
        if (obtenido !== esperado) {
          desviaciones.push(
            `${ruta.clave} · ${rol} · guard=${obtenido ? 'permite' : 'deniega'} · matriz=${esperado ? 'permite' : 'deniega'}`,
          );
        }
      }
    }

    console.log(
      `\n=== MATRIZ ROL × RUTA (${rutas.length} rutas × ${ROLES.length} roles = ${evaluaciones} decisiones) ===`,
    );
    for (const ruta of rutas) {
      const celdas = ROLES.map((rol) =>
        (MATRIZ_ESPERADA[ruta.clave].includes(rol) === permite(ruta, rol) ? 'si' : 'NO').padEnd(4),
      );
      console.log(`${ruta.clave.padEnd(58)} | ${celdas.join('| ')}`);
    }
    console.log('');

    // 63 rutas × 4 roles: la partición de E3-03 añadió POST /reservas/walk-in,
    // el endpoint de cotización (D44) añadió POST /reservas/cotizar, E3-04
    // añadió POST /reservas/:id/aceptar y POST /reservas/:id/rechazar, E3-05
    // añadió POST /reservas/:id/cancelar, E3-06 añadió
    // PATCH /reservas/:id/reprogramar, E3-08 añadió cuatro (cancelación
    // especial, proponer-horario y su bandeja de aceptar/rechazar) y E2-02
    // quitó PATCH /reservas/:id/estado.
    expect(evaluaciones).toBe(252);
    expect(
      desviaciones.length === 0
        ? ''
        : `${desviaciones.length} desviaciones:\n${desviaciones.join('\n')}`,
    ).toBe('');
  }, 60_000);
});