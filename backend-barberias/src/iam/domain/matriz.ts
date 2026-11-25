/**
 * T-10 · La matriz objetivo, en código.
 *
 * Fuente: `docs/MATRIZ_PERMISOS_OBJETIVO.md` (las 30 acciones, aprobadas el
 * 23 nov 2026) y `docs/MATRIZ_RUTAS_ACCIONES.md` §3 (qué acción le toca a cada
 * ruta). Los identificadores se copian tal cual, sin renombrar ni derivar, y su
 * orden en `RUTA_ACCION` es el de la tabla del documento.
 *
 * `RUTA_ACCION` cubre las 123 rutas del inventario (`POLITICA_DECLARADA` en
 * `test/permisos-matriz.spec.ts`): 70 con al menos una acción y 53 con `[]`
 * porque la matriz no las cubre —41 fuera de su alcance y las 12 brechas de
 * `RUTAS_BRECHA_MATRIZ`. El tipo `Accion` hace que un identificador inventado
 * no compile: el mapa no puede desviarse de la matriz por una errata.
 *
 * No impone permisos todavía. T-11 usa `RUTAS_BRECHA_ROL` para corregir los
 * roles que hoy contradicen la matriz y T-12 asigna las acciones nuevas a sus
 * rutas. `test/matriz-acciones.spec.ts` es el guardián de estos números.
 */

/** Las 30 acciones de la matriz objetivo, en el orden del documento. */
export const ACCIONES = [
  'plataforma.metricas.ver',
  'plataforma.sedes.gestionar',
  'plataforma.usuarios.gestionar',
  'plataforma.auditoria.ver',
  'catalogo.categorias.gestionar',
  'catalogo.categorias.ver',
  'catalogo.servicios.gestionar',
  'personal.gestionar',
  'horario.base.aprobar',
  'excepciones.ajenas.gestionar',
  'excepciones.propias.registrar',
  'agenda.sede.ver',
  'agenda.propia.ver',
  'walkin.crear',
  'cita.estado.marcar',
  'solicitudes_cambio.gestionar',
  'antecedentes.solicitar',
  'antecedentes.resolver',
  'antecedentes.ver',
  'caja.ver_y_cerrar',
  'pagos.anular',
  'plataforma.solicitudes_cambio.gestionar',
  'plataforma.vinculaciones.gestionar',
  'cita.propia.cancelar',
  'cita.propia.proponer_horario',
  'pagos.cobrar',
  'configuracion.sede.ver',
  'configuracion.sede.gestionar',
  'restringidos_locales.ver',
  'restringidos_locales.gestionar',
] as const;

export type Accion = (typeof ACCIONES)[number];

/**
 * Ruta del servidor (tal cual la clave de `POLITICA_DECLARADA`) → acciones de la
 * matriz que la cubren. `[]` significa que la matriz no tiene acción para esa
 * ruta; ver `RUTAS_BRECHA_MATRIZ` para distinguir las que además son brecha.
 */
export const RUTA_ACCION: Readonly<Record<string, readonly Accion[]>> = {
  'GET /': [],
  'POST /auth/register': [],
  'POST /auth/login': [],
  'GET /auth/me': [],
  'POST /auth/logout': [],
  'POST /auth/forgot-password': [],
  'POST /auth/reset-password': [],
  'POST /auth/send-otp': [],
  'POST /auth/verify-otp': [],
  'POST /auth/otp/resend': [],
  'PATCH /auth/otp/update-contact': [],
  'GET /health,api/v1/health': [],
  'GET /health/liveness,api/v1/health/liveness': [],
  'GET /notificaciones/mis-notificaciones': [],
  'POST /webhooks/whatsapp/': [],
  'GET /auditoria/': ['plataforma.auditoria.ver'],
  'GET /auditoria/estadisticas': ['plataforma.auditoria.ver'],
  'POST /auditoria/purgar': ['plataforma.auditoria.ver'],
  'GET /shops/all': ['plataforma.sedes.gestionar'],
  'GET /analytics/plataforma/hoy': ['plataforma.metricas.ver'],
  'GET /plataforma/solicitudes-cambio/': [],
  'POST /plataforma/solicitudes-cambio/:id/resolver': [],
  'GET /plataforma/vinculaciones/pendientes': [],
  'POST /plataforma/vinculaciones/:id/aprobar': [],
  'POST /plataforma/vinculaciones/:id/rechazar': [],
  'PATCH /plataforma/usuarios/:id/estado': ['plataforma.usuarios.gestionar'],
  'GET /plataforma/usuarios/': ['plataforma.usuarios.gestionar'],
  'POST /plataforma/usuarios/': ['plataforma.usuarios.gestionar'],
  'GET /plataforma/usuarios/:id/auditoria': ['plataforma.auditoria.ver'],
  'GET /plataforma/usuarios/:id/roles': ['plataforma.usuarios.gestionar'],
  'PATCH /plataforma/usuarios/:id/administrador': ['plataforma.usuarios.gestionar'],
  'GET /shops/': [],
  'POST /shops/': ['plataforma.sedes.gestionar'],
  'GET /shops/:shopId': [],
  'PATCH /shops/:shopId/select': [],
  'PATCH /shops/:shopId': ['plataforma.sedes.gestionar'],
  'PATCH /shops/:shopId/status': ['plataforma.sedes.gestionar'],
  'POST /shops/link': [],
  'GET /shops/:shopId/invitation': [],
  'GET /shops/:shopId/settings/': [],
  'PATCH /shops/:shopId/settings/': [],
  'GET /shops/:shopId/analytics/': ['caja.ver_y_cerrar'],
  'GET /shops/:shopId/analytics/export': ['caja.ver_y_cerrar'],
  'GET /shops/overview': ['caja.ver_y_cerrar'],
  'POST /shops/:shopId/change-requests': ['solicitudes_cambio.gestionar'],
  'GET /shops/:shopId/change-requests': ['solicitudes_cambio.gestionar'],
  'GET /shops/:shopId/restricted-clients/': [],
  'POST /shops/:shopId/restricted-clients/:clientId/reactivate': [],
  'GET /shops/:shopId/membership/': [],
  'POST /shops/:shopId/membership/unlink': [],
  'GET /mi-estado/barberias': [],
  'GET /mi-estado/membresias': [],
  'POST /mi-estado/unirse': [],
  'GET /shops/:shopId/staff': ['personal.gestionar'],
  'POST /shops/:shopId/staff': ['personal.gestionar'],
  'PATCH /shops/:shopId/staff/:userId': ['personal.gestionar'],
  'GET /shops/:shopId/appointments/schedule/blocks': ['agenda.sede.ver'],
  'POST /shops/:shopId/appointments/schedule/blocks': ['agenda.sede.ver'],
  'POST /shops/:shopId/appointments/schedule/blocks/:id/release': ['agenda.sede.ver'],
  'GET /shops/:shopId/appointments/schedule/availability': [],
  'POST /shops/:shopId/appointments/schedule/availability': [],
  'GET /shops/:shopId/appointments/schedule/slots': [],
  'POST /shops/:shopId/appointments/': [],
  'POST /shops/:shopId/appointments/walk-in': ['walkin.crear'],
  'POST /shops/:shopId/appointments/walk-in-pago': ['walkin.crear'],
  'POST /shops/:shopId/appointments/quote': [],
  'GET /shops/:shopId/appointments/mine': [],
  'GET /shops/:shopId/appointments/:id': [],
  'POST /shops/:shopId/appointments/:id/no-show': ['cita.estado.marcar'],
  'POST /shops/:shopId/appointments/:id/accept': ['cita.estado.marcar'],
  'POST /shops/:shopId/appointments/:id/reject': ['cita.estado.marcar'],
  'POST /shops/:shopId/appointments/:id/cancel': ['cita.estado.marcar', 'cita.propia.cancelar'],
  'PATCH /shops/:shopId/appointments/:id/reschedule': ['cita.estado.marcar'],
  'POST /shops/:shopId/appointments/:id/special-cancellation': ['cita.estado.marcar'],
  'POST /shops/:shopId/appointments/:id/propose-time': [],
  'POST /shops/:shopId/appointments/:id/proposed-time/accept': ['cita.estado.marcar'],
  'POST /shops/:shopId/appointments/:id/proposed-time/reject': ['cita.estado.marcar'],
  'GET /shops/:shopId/appointments/proposals/pending': ['cita.estado.marcar'],
  'GET /shops/:shopId/appointments/day': ['agenda.sede.ver'],
  'PATCH /reservas/:id/asignar-barbero': ['cita.estado.marcar'],
  'GET /shops/:shopId/hours/': ['agenda.sede.ver'],
  'POST /shops/:shopId/hours/': ['personal.gestionar'],
  'GET /shops/:shopId/hours/mine': ['agenda.propia.ver'],
  'POST /shops/:shopId/hours/mine': ['excepciones.propias.registrar'],
  'GET /shops/:shopId/mi-horario/': ['agenda.propia.ver'],
  'PUT /shops/:shopId/mi-horario/': ['excepciones.propias.registrar'],
  'GET /shops/:shopId/mi-horario/base': ['agenda.propia.ver'],
  'PUT /shops/:shopId/mi-horario/base': ['excepciones.propias.registrar'],
  'GET /shops/:shopId/hours/exceptions': ['excepciones.ajenas.gestionar'],
  'POST /shops/:shopId/hours/exceptions': ['excepciones.ajenas.gestionar'],
  'POST /shops/:shopId/hours/barbers/:barberoId/exceptions': ['excepciones.ajenas.gestionar'],
  // F4-04: la decisión sobre la propuesta de horario base. Es la única acción de
  // T-12 que tenía endpoint pendiente; con esta ruta deja de estar huérfana.
  'PATCH /shops/:shopId/hours/barbers/:barberoId/base': ['horario.base.aprobar'],
  'POST /lista-espera/': [],
  'POST /shops/:shopId/records/': ['antecedentes.solicitar'],
  // F5 · la petición del personal de la sede; la resolución sigue en la
  // plataforma (T-53) y no en el responsable de la sede.
  'POST /shops/:shopId/antecedentes/solicitudes/': ['antecedentes.solicitar'],
  'GET /shops/:shopId/antecedentes/solicitudes/': ['antecedentes.ver'],
  // La bandeja de la plataforma y su decisión: resolver es solo del global.
  'GET /antecedentes/solicitudes/': ['antecedentes.ver'],
  'PATCH /antecedentes/solicitudes/:id': ['antecedentes.resolver'],
  'PATCH /shops/:shopId/records/:id/evaluate': ['antecedentes.resolver'],
  'GET /shops/:shopId/records/client/:clientId': ['antecedentes.ver'],
  'GET /shops/:shopId/records/pending': ['antecedentes.ver'],
  'GET /shops/:shopId/payments/audit': ['caja.ver_y_cerrar'],
  'POST /shops/:shopId/payments/': [],
  'GET /shops/:shopId/payments/history': ['caja.ver_y_cerrar'],
  'POST /pagos/cobrar': [],
  'GET /caja/hoy': ['caja.ver_y_cerrar'],
  'POST /caja/cierre': ['caja.ver_y_cerrar'],
  'POST /shops/:shopId/payments/:id/void': ['pagos.anular'],
  'GET /shops/:shopId/services/': [],
  'POST /shops/:shopId/services/': ['catalogo.servicios.gestionar'],
  'GET /shops/:shopId/services/:id': [],
  'PATCH /shops/:shopId/services/:id': ['catalogo.servicios.gestionar'],
  'PATCH /shops/:shopId/services/:id/deactivate': ['catalogo.servicios.gestionar'],
  'PATCH /shops/:shopId/services/:id/reactivate': ['catalogo.servicios.gestionar'],
  'GET /shops/:shopId/combos/': [],
  'POST /shops/:shopId/combos/': ['catalogo.servicios.gestionar'],
  'GET /shops/:shopId/combos/:id': [],
  'PATCH /shops/:shopId/combos/:id': ['catalogo.servicios.gestionar'],
  'PATCH /shops/:shopId/combos/:id/deactivate': ['catalogo.servicios.gestionar'],
  'PATCH /shops/:shopId/combos/:id/reactivate': ['catalogo.servicios.gestionar'],
  'POST /shops/:shopId/categorias/': ['catalogo.categorias.gestionar'],
  'GET /shops/:shopId/categorias/': ['catalogo.categorias.ver'],
  'PATCH /shops/:shopId/categorias/:id': ['catalogo.categorias.gestionar'],
  // T-21 (backlog de catálogo) · retirar una categoría global sin servicios.
  // La acción es la misma que crearla y editarla: gestionar la taxonomía.
  'DELETE /shops/:shopId/categorias/:id': ['catalogo.categorias.gestionar'],
  'GET /shops/:shopId/categorias/:id': ['catalogo.categorias.ver'],
  'GET /shops/:shopId/servicios': [],
  'POST /shops/:shopId/mis-servicios': [],
  'GET /shops/:shopId/mis-servicios': [],
  'PATCH /shops/:shopId/mis-servicios/:id': [],
  // T-24 · foto del servicio: la sube su barbero dueño, igual que lo edita.
  'PATCH /shops/:shopId/mis-servicios/:id/imagen': [],
  // T-27/T-28 · solicitudes de servicio: pedir es autoservicio propio (sin
  // acción); la bandeja y su resolución usan gestionar el catálogo.
  'POST /shops/:shopId/solicitudes-servicio/': [],
  'GET /shops/:shopId/solicitudes-servicio/': ['catalogo.servicios.gestionar'],
  'PATCH /shops/:shopId/solicitudes-servicio/:id': ['catalogo.servicios.gestionar'],
  // T-28 (foto) · la adjunta el barbero dueño de la solicitud PENDIENTE: es
  // autoservicio propio, como el alta, no una acción de gestión de la sede.
  'PATCH /shops/:shopId/solicitudes-servicio/:id/imagen': [],
};

/**
 * §6 del mapa: rutas `sin acción` que el documento declaró brecha de la matriz.
 * Necesitan una acción nueva y su ruta; las crea T-12.
 */
export const RUTAS_BRECHA_MATRIZ: readonly string[] = [
  'GET /plataforma/solicitudes-cambio/',
  'POST /plataforma/solicitudes-cambio/:id/resolver',
  'GET /plataforma/vinculaciones/pendientes',
  'POST /plataforma/vinculaciones/:id/aprobar',
  'POST /plataforma/vinculaciones/:id/rechazar',
  'GET /shops/:shopId/settings/',
  'PATCH /shops/:shopId/settings/',
  'GET /shops/:shopId/restricted-clients/',
  'POST /shops/:shopId/restricted-clients/:clientId/reactivate',
  'POST /shops/:shopId/appointments/:id/propose-time',
  'POST /shops/:shopId/payments/',
  'POST /pagos/cobrar',
];

/**
 * §2 del mapa: rutas que sí tienen acción, pero cuyos roles en el código hoy
 * contradicen la matriz. T-11 ya alineó las 12: la lista queda vacía a
 * propósito y el test la vigila para que ninguna vuelva a desviarse sin que se
 * note.
 */
export const RUTAS_BRECHA_ROL: readonly string[] = [];

/** Acciones de una ruta; `[]` si la matriz no la cubre. */
export function accionesDe(clave: string): readonly Accion[] {
  return RUTA_ACCION[clave] ?? [];
}
