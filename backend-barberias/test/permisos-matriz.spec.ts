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
  // H64 (2026-10-14): sonda de VIDA separada de la de preparación. Es `@Public`
  // como la otra (la consulta la infraestructura, sin token) y no comprueba nada
  // externo: si dependiera de Redis, un parpadeo de la cola se convertiría en un
  // reinicio de la instancia.
  'GET /health/liveness,api/v1/health/liveness': TODOS,
  'GET /notificaciones/mis-notificaciones': TODOS,
  // Fase 7 · el webhook de WhatsApp es `@Public` (lo llama un proveedor, no un
  // navegador) y su autenticación es el secreto x-webhook-secret, que el
  // RolesGuard no conoce: por eso la decisión del guard es «deja pasar a los
  // cuatro», igual que el resto de rutas públicas.
  'POST /webhooks/whatsapp/': TODOS,

  'GET /auditoria/': [ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA],
  'GET /auditoria/estadisticas': [ROL_ADMINISTRADOR],
  'POST /auditoria/purgar': [ROL_ADMINISTRADOR],

  'GET /shops/': TODOS,
  'POST /shops/': TODOS,
  'GET /shops/all': [ROL_ADMINISTRADOR],
  'GET /shops/:shopId/staff': [ROL_ADMIN_BARBERIA, ROL_BARBERO],
  'GET /shops/:shopId': TODOS,
  'PATCH /shops/:shopId/select': [ROL_CLIENTE, ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'PATCH /shops/:shopId': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E2-07 (2026-10-13): el borrado lógico de la sede pasa a ser un cambio de
  // estado explícito. La ruta usa `:id` (no `:barberiaId`), así que el guard NO
  // resuelve la sede del parámetro y la política es la lista plana: el
  // ADMINISTRADOR global (decisión 4).
  'PATCH /shops/:shopId/status': [ROL_ADMINISTRADOR],
  'POST /shops/link': [ROL_CLIENTE],
  // E3-12/2 (2026-10-17): la invitación de la sede (regla 1.10). La ruta usa
  // `:id`, así que el guard NO resuelve la sede del parámetro y la política es
  // la lista plana del decorador: la pertenencia la exige
  // `BarberiaService.obtenerInvitacion` (403) con la MISMA regla que ya entrega
  // `codigoAcceso` en la lectura por id (E1-05/E1-07). El CLIENTE queda fuera
  // —no es él quien comparte la puerta de entrada— y el ADMINISTRADOR entra por
  // jerarquía (E1-04).
  'GET /shops/:shopId/invitation': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-11 (2026-10-11): la configuración de la barbería la consulta y la
  // modifica la SEDE; el `RolesGuard` la acota al `barberiaId` del parámetro.
  'GET /shops/:shopId/settings/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'PATCH /shops/:shopId/settings/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // Paso 10: analíticas operativas y de retención (solo admin de sede / plataforma).
  'GET /shops/:shopId/analytics/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  // E3-13 (2026-10-11): el nombre y el responsable solo cambian por solicitud
  // aprobada. La ruta usa `:id` (no `:barberiaId`), así que el guard NO resuelve
  // la sede del parámetro: la pertenencia real la comprueba el servicio
  // (`SOLO_ADMIN_BARBERIA`, 403) y eso lo cubre el E2E de E3-13. La bandeja de
  // plataforma es exclusiva del ADMINISTRADOR global.
  'POST /shops/:shopId/change-requests': [ROL_ADMIN_BARBERIA],
  // E4-03 (2026-10-12): la bandeja de restringidos es de la SEDE. Como en
  // E3-13 la ruta usa `:id` y el guard no resuelve la sede del parámetro, así
  // que la pertenencia la exige el servicio (403). D48: la lista es local y no
  // existe ninguna acción de cuenta global en estos dos endpoints.
  'GET /shops/:shopId/restricted-clients/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/restricted-clients/:clientId/reactivate': [
    ROL_ADMIN_BARBERIA,
    ROL_ADMINISTRADOR,
  ],
  'GET /plataforma/solicitudes-cambio/': [ROL_ADMINISTRADOR],
  'POST /plataforma/solicitudes-cambio/:id/resolver': [ROL_ADMINISTRADOR],
  // E3-12 (2026-10-15): la 6.ª vinculación (D10) la resuelve la PLATAFORMA.
  // El límite se cuenta por USUARIO, no por sede, así que la sede es parte
  // interesada y no puede decidir: `@Roles(ADMINISTRADOR)` en las tres rutas,
  // como las otras dos bandejas globales. `test/e3-12-vinculacion.e2e-spec.ts`
  // comprueba además que el ADMIN_BARBERIA de la sede recibe 403.
  'GET /plataforma/vinculaciones/pendientes': [ROL_ADMINISTRADOR],
  'POST /plataforma/vinculaciones/:id/aprobar': [ROL_ADMINISTRADOR],
  'POST /plataforma/vinculaciones/:id/rechazar': [ROL_ADMINISTRADOR],
  // H54 (E4-03/2, 2026-10-12): el cliente consulta su PROPIO estado en esa sede.
  // La ruta usa `:barberiaId`, así que el guard SÍ acota por el parámetro; el
  // servicio vuelve a acotar por el usuario del token (nunca datos de otro).
  // `@Get()` sin argumento compone la ruta con barra final (igual que `GET /barberias/`).
  'GET /shops/:shopId/membership/': [ROL_CLIENTE],
  // E3-12/3 (2026-10-15): la desvinculación a petición del cliente (la otra
  // mitad de 1.9). Misma ruta base que `mi-estado` y por la misma razón: el
  // `:barberiaId` deja que el guard acote la sede del parámetro, y el servicio
  // vuelve a acotar por el usuario del token. Solo `CLIENTE`: cerrar el vínculo
  // de otro no es una operación de nadie más.
  'POST /shops/:shopId/membership/unlink': [ROL_CLIENTE],
  // H72 (2026-10-16): `GET /mi-estado/barberias` lista las sedes PROPIAS del
  // CLIENTE con vínculo `ACTIVO` o `PENDIENTE_APROBACION`, excluyendo
  // `DESVINCULADO` y las barberías inactivas. No cuelga de `/barberias` porque
  // esa base ya significa «donde YO SOY responsable» (E1-07). Sin `:barberiaId`,
  // así que el guard solo filtra el rol y el acotado por el usuario del token lo
  // exige el servicio. Solo CLIENTE: el staff tiene sus propios listados.
  'GET /mi-estado/barberias': [ROL_CLIENTE],
  // E3-12/2 (2026-10-17): la entrada del cliente por invitación (regla 1.10).
  // Hermana de `desvincular`: vive bajo `mi-estado` —el espacio del vínculo
  // propio— y es del CLIENTE, porque el vínculo que se crea es el suyo. Sin
  // `:barberiaId` (la sede se nombra por código o por enlace en el CUERPO), así
  // que el guard solo filtra el rol y el acotado por usuario lo hace el
  // servicio con el usuario del token. Reutiliza `vincularCliente`, así que D10
  // y la reapertura de H71 son las mismas que en la fila 20.
  'POST /mi-estado/unirse': [ROL_CLIENTE],
  // E4-03/5 (2026-10-12): suspender o reactivar la CUENTA global es exclusivo del
  // ADMINISTRADOR de la plataforma (D05/D09/D48). La sede no entra por aquí: su
  // penalización es local y su vía es `clientes/:clienteId/reactivar`.
  'PATCH /plataforma/usuarios/:id/estado': [ROL_ADMINISTRADOR],
  // Bandeja de usuarios de la plataforma: la lista completa de cuentas es del
  // ADMINISTRADOR global, igual que cambiarles el estado. La sede no la ve.
  'GET /plataforma/usuarios/': [ROL_ADMINISTRADOR],
  // Alta administrativa de una cuenta: el ADMINISTRADOR elige el rol y, para los
  // roles de sede, la barbería. La sede no crea cuentas (eso es `personal`).
  'POST /plataforma/usuarios/': [ROL_ADMINISTRADOR],
  // Historial de auditoría de UNA cuenta (suspensiones, reactivaciones, motivos).
  // Es la vista global del comportamiento de una cuenta: solo plataforma.
  'GET /plataforma/usuarios/:id/auditoria': [ROL_ADMINISTRADOR],

  'GET /shops/:shopId/appointments/schedule/blocks': [ROL_ADMIN_BARBERIA, ROL_BARBERO],
  'POST /shops/:shopId/appointments/schedule/blocks': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E2-07: `DELETE .../bloqueos/:id` —que borraba la fila— pasa a
  // `POST .../bloqueos/:id/liberar`, que fija `liberado_at` y conserva el rastro.
  'POST /shops/:shopId/appointments/schedule/blocks/:id/release': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /shops/:shopId/appointments/schedule/availability': TODOS,
  'POST /shops/:shopId/appointments/schedule/availability': TODOS,
  // E4-02 (2026-10): los huecos de espacio son lectura de la capacidad de venta
  // de la sede, no gestión de agenda, así que el BARBERO queda fuera (§E4-02/2).
  // El CLIENTE los consulta para su propia reserva y el ADMINISTRADOR es
  // transversal por jerarquía (E1-04), que MATRIZ_ESPERADA lo añade solo.
  'GET /shops/:shopId/appointments/schedule/slots': [
    ROL_CLIENTE,
    ROL_ADMIN_BARBERIA,
    ROL_ADMINISTRADOR,
  ],

  'POST /shops/:shopId/records/': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'PATCH /shops/:shopId/records/:id/evaluate': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /shops/:shopId/records/client/:clientId': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /shops/:shopId/records/pending': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  'GET /shops/:shopId/hours/': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/hours/': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /shops/:shopId/hours/mine': [ROL_BARBERO],
  'POST /shops/:shopId/hours/mine': [ROL_BARBERO],
  'GET /shops/:shopId/hours/exceptions': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/hours/exceptions': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/hours/barbers/:barberoId/exceptions': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  'GET /shops/:shopId/payments/audit': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-09 (2026-10): la política de la RUTA no cambia — el guard sigue
  // admitiendo a los tres roles en POST /cobros. Lo que se añade es una
  // comprobación de SERVICIO: un BARBERO solo cobra las reservas asignadas a
  // él (y las sin asignar solo las cobra un ADMIN), que el guard no puede ver
  // porque no consulta la reserva. Cubierto por
  // `test/pago-barbero-asignado.e2e-spec.ts` (5 casos, rojo→verde) y por el
  // describe E3-09 de `src/pago/application/pago.service.spec.ts`.
  'POST /shops/:shopId/payments/': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // H68 (2026-10-18): §7.3 · corregir un cobro. El recibo de la sede es la
  // lectura del dinero cobrado y la anulación es una decisión administrativa,
  // así que las dos son de la SEDE: el BARBERO cobra (E3-09) pero no deshace un
  // ingreso. La ruta de anulación usa `:id` (no `:barberiaId`), así que el guard
  // NO resuelve la sede del parámetro y la pertenencia la vuelve a exigir
  // `PagoService.anularPago` con la sede del PAGO (403 `ANULACION_SOLO_ADMIN` si
  // quien anula es barbero de esa sede, 404 si el cobro es de otra sede).
  'GET /shops/:shopId/payments/history': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/payments/:id/void': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],

  // E3-03 (2026-10): la única fila de cuatro roles se parte en dos. El alias
  // `/reservas` lo usaban DOS pantallas: el wizard del cliente
  // (`reserva-wizard.component.ts`, manda `barberoId: null`) y el modal de
  // walk-in de la agenda (`walk-in-modal.component.ts`, exige `barberoId`).
  // Con la ruta walk-in separada, cada una recibe su política real: el alias
  // vuelve a ser exclusivo del CLIENTE y el walk-in, que solo ocurre en la
  // sede y siempre con barbero, queda para el staff. No se debilita ninguna
  // de las dos: se sustituyen 4 aserciones mezcladas por 2 + 2 más estrictas.
  'POST /shops/:shopId/appointments/': [ROL_CLIENTE],
  'POST /shops/:shopId/appointments/walk-in': [ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // D44: la cotización sin persistir la usan tanto el wizard del cliente (que
  // necesita cotizar antes de crear su propia reserva) como el modal de
  // walk-in, así que declara los cuatro roles: cotizar no persiste nada y el
  // CLIENTE debe poder consultar el precio de su futura reserva.
  'POST /shops/:shopId/appointments/quote': [ROL_CLIENTE, ROL_BARBERO, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /shops/:shopId/appointments/mine': [ROL_CLIENTE],
  'GET /shops/:shopId/appointments/:id': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE],
  // E2-02 (2026-10-11): `PATCH .../reservas/:id/estado` se eliminó. Era un
  // «pon el estado que quieras» que escribía directo sobre `reservas.estado`
  // sin comprobar el grafo de §5.2: con ella, un ADMIN podía saltarse
  // aceptar/rechazar/cancelar y hasta cobrar sin pasar por caja. La matriz
  // pierde esa fila (64 → 63 rutas) y el único escritor de estado es ahora
  // `ReservaService.cambiarEstado`, privado y con la máquina delante.
  'POST /shops/:shopId/appointments/:id/no-show': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-04 (2026-10-09): aceptar y rechazar una solicitud son decisiones de la
  // SEDE, no del barbero: la misma matriz que el no presentado (D02) y que el
  // cambio de estado (decisión 11, hoy ya sin ruta genérica). El `RolesGuard`
  // las acota al `barberiaId` del parámetro, así que un admin de otra sede
  // recibe 403.
  'POST /shops/:shopId/appointments/:id/accept': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/appointments/:id/reject': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-05 (2026-10-09): cancelar la declaran los tres roles. El CLIENTE dueño
  // cancela lo suyo y la sede cancela por mostrador; lo que el guard NO puede
  // ver —que la reserva sea del CLIENTE que la cancela— lo exige el servicio
  // (403 RESERVA_AJENA) y lo cubren las pruebas de servicio y el E2E.
  'POST /shops/:shopId/appointments/:id/cancel': [ROL_CLIENTE, ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-06 (2026-10-09): reprogramar una reserva vigente es una decisión de la
  // SEDE, como aceptar, rechazar o marcar el no presentado: la misma política y
  // el mismo acotado por `barberiaId` del parámetro. La vía del CLIENTE para
  // cambiar de horario es la propuesta con ventana de 10 minutos (§5.4), que
  // sigue pendiente como tarea del backlog.
  'PATCH /shops/:shopId/appointments/:id/reschedule': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  // E3-08 (2026-10-10): la cancelación especial (D17) es una decisión de la SEDE
  // con motivo obligatorio, así que declara los mismos dos roles que aceptar,
  // rechazar o reprogramar. La propuesta de horario (D18) es la vía del CLIENTE
  // dueño y su bandeja de resolución (aceptar/rechazar) vuelve a ser de la SEDE.
  'POST /shops/:shopId/appointments/:id/special-cancellation': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/appointments/:id/propose-time': [ROL_CLIENTE],
  'POST /shops/:shopId/appointments/:id/proposed-time/accept': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/appointments/:id/proposed-time/reject': [ROL_ADMIN_BARBERIA, ROL_ADMINISTRADOR],
  'GET /shops/:shopId/appointments/day': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_ADMINISTRADOR],

  // D16 (Especificación §2/§3.1): el catálogo lo opera el personal de la sede.
  // Las escrituras son del BARBERO y del ADMIN_BARBERIA (en V1 suele ser el
  // único responsable/operador). El ADMINISTRADOR global queda FUERA de la
  // escritura aunque `RolesGuard` le conceda acceso por jerarquía (E1-04); de eso
  // se ocupa `OperadorBarberiaGuard`. Las lecturas conservan al CLIENTE porque
  // son la vitrina pública y el wizard.
  'GET /shops/:shopId/services/': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/services/': [ROL_BARBERO, ROL_ADMIN_BARBERIA],
  'GET /shops/:shopId/services/:id': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'PATCH /shops/:shopId/services/:id': [ROL_BARBERO, ROL_ADMIN_BARBERIA],
  // E2-07: el `DELETE` del catálogo se parte en los dos verbos del cambio de
  // estado. Desactivar tiene reglas de negocio (422) que el guard no puede ver.
  'PATCH /shops/:shopId/services/:id/deactivate': [ROL_BARBERO, ROL_ADMIN_BARBERIA],
  'PATCH /shops/:shopId/services/:id/reactivate': [ROL_BARBERO, ROL_ADMIN_BARBERIA],

  'GET /shops/:shopId/combos/': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'POST /shops/:shopId/combos/': [ROL_BARBERO, ROL_ADMIN_BARBERIA],
  'GET /shops/:shopId/combos/:id': [ROL_ADMIN_BARBERIA, ROL_BARBERO, ROL_CLIENTE, ROL_ADMINISTRADOR],
  'PATCH /shops/:shopId/combos/:id': [ROL_BARBERO, ROL_ADMIN_BARBERIA],
  'PATCH /shops/:shopId/combos/:id/deactivate': [ROL_BARBERO, ROL_ADMIN_BARBERIA],
  'PATCH /shops/:shopId/combos/:id/reactivate': [ROL_BARBERO, ROL_ADMIN_BARBERIA],

  // E4-02 · D22 (2026-10-20): el alta de la lista de espera es del CLIENTE: el
  // `usuarioId` sale del token, así que la ruta no lleva `:barberiaId` y el
  // guard solo filtra el rol. El ADMINISTRADOR global entra por jerarquía
  // (E1-04), que MATRIZ_ESPERADA añade solo.
  'POST /lista-espera/': [ROL_CLIENTE],
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
          esTenant: ruta.includes(':shopId'),
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
      params: ruta.esTenant ? { shopId: BARBERIA_ID } : {},
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
  // (ver la nota del diccionario), así que quedaban 63. E3-11 sumó los dos
  // endpoints de configuración (GET y PATCH /barberias/:barberiaId/configuracion)
  // y quedaban 65. E3-13 sumó la solicitud de la sede y la bandeja de plataforma
  // (listar y resolver): 68. E4-02 sumó los huecos de espacio (69) y E4-03 la
  // bandeja local de restringidos con su reactivación: 71. La Ola 2 del sprint
  // sumó `mi-estado` (H54) y la suspensión de cuenta (E4-03/5): 73. La Ola 3
  // (E2-07) retiró los cuatro `@Delete` y añadió los verbos del vocabulario del
  // diseño: `PATCH /barberias/:id/estado`, `POST .../bloqueos/:id/liberar` y los
  // cuatro `desactivar`/`reactivar` del catálogo → 73 − 4 + 6 = 75. La Fase 2
  // (H63, 2026-10-14) no añadió rutas. H64 suma la sonda de vida separada: 76.
  // E3-12 (2026-10-15) suma la bandeja de plataforma de la 6.ª vinculación y sus
  // dos resoluciones (aprobar y rechazar): 79. E3-12/3 suma la salida del
  // cliente (`POST .../mi-estado/desvincular`): 80. E3-12/2 sumó la invitación de
  // la sede y la unión del cliente: 83. H68 (2026-10-18) suma el historial de
  // cobros y la anulación de un pago: 85. E4-02 (2026-10-20) suma el alta de la
  // lista de espera (Carril B): 86. El listado de usuarios de plataforma suma
  // `GET /plataforma/usuarios`: 87. La bandeja de administración suma el alta
  // (`POST /plataforma/usuarios`) y el historial de una cuenta
  // (`GET /plataforma/usuarios/:id/auditoria`): 89. La Fase 7 suma el webhook de
  // retención (`POST /webhooks/whatsapp`, @Public): 90.
  it('descubrir las rutas del servidor y todas tienen decision', () => {
    const claves = rutas.map((r) => r.clave);
    expect(claves.length).toBeGreaterThanOrEqual(90);

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
      const declarados = ruta.roles ?? [];

      if (declarados.length > 0) {
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
      if (!esperados || !Array.isArray(esperados)) {
        desviaciones.push(`${ruta.clave} · sin matriz esperada`);
        continue;
      }
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

    // 68 rutas × 4 roles: la partición de E3-03 añadió POST /reservas/walk-in,
    // el endpoint de cotización (D44) añadió POST /reservas/cotizar, E3-04
    // añadió POST /reservas/:id/aceptar y POST /reservas/:id/rechazar, E3-05
    // añadió POST /reservas/:id/cancelar, E3-06 añadió
    // PATCH /reservas/:id/reprogramar, E3-08 añadió cuatro (cancelación
    // especial, proponer-horario y su bandeja de aceptar/rechazar), E2-02
    // quitó PATCH /reservas/:id/estado, E3-11 añadió las dos de configuración
    // (GET y PATCH /barberias/:barberiaId/configuracion), E3-13 las tres de
    // solicitudes de cambio, E4-02 la de huecos de espacio y E4-03 las dos de
    // restringidos: 71. La Ola 2 del sprint sumó `mi-estado` (H54) y
    // `PATCH /plataforma/usuarios/:id/estado` (E4-03/5): 73. La Ola 3 sumó los
    // seis verbos de E2-07 y retiró cuatro `@Delete`: 75 × 4 = 300. H64 sumó la
    // sonda de vida separada (76 rutas) y con ella la decisión de sus 4 roles:
    // 304. E3-12 sumó las tres rutas de la 6.ª vinculación (79 rutas) y E3-12/3
  // la desvinculación del cliente: 80 × 4 = 320. H72 sumó la lista de sedes
  // del cliente (H72): 81 × 4 = 324. E3-12/2 suma la puerta de entrada
  // (regla 1.10) —la invitación de la sede y la unión del cliente—: 83 × 4 = 332.
  // H68 suma las dos del recibo de cobros (historial y anulación): 85 × 4 = 340.
  // E4-02 suma el alta de la lista de espera: 86 × 4 = 344. El listado de
  // usuarios de plataforma suma la 87: 348. El alta de cuenta y su historial de
  // auditoría suman las 88 y 89: 356. El webhook de WhatsApp de la Fase 7 suma
  // la 90: 360.
  expect(evaluaciones).toBe(364);
    expect(
      desviaciones.length === 0
        ? ''
        : `${desviaciones.length} desviaciones:\n${desviaciones.join('\n')}`,
    ).toBe('');
  }, 60_000);
});