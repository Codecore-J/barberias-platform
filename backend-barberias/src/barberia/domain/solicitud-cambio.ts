/**
 * E3-13 · Catálogo y matriz de transiciones de `solicitudes_cambio_barberia`
 * (D26, BACKLOG §8.4).
 *
 * El nombre de la sede y el responsable NO se editan directo: el ADMIN_BARBERIA
 * de la sede crea una solicitud y el ADMINISTRADOR de la plataforma la resuelve.
 * Igual que la reserva (E2-02), el grafo de estados vive en un solo lugar y las
 * escrituras pasan por aquí: la columna es un `VARCHAR` con `CHECK` (D26), así
 * que la única barrera real es esta tabla.
 */

export const TIPOS_SOLICITUD_CAMBIO = {
  NOMBRE: 'NOMBRE',
  RESPONSABLE: 'RESPONSABLE',
} as const;

export type TipoSolicitudCambio =
  (typeof TIPOS_SOLICITUD_CAMBIO)[keyof typeof TIPOS_SOLICITUD_CAMBIO];

export const TIPOS_SOLICITUD_CAMBIO_LISTA: readonly TipoSolicitudCambio[] =
  Object.values(TIPOS_SOLICITUD_CAMBIO);

export const ESTADOS_SOLICITUD_CAMBIO = {
  PENDIENTE: 'PENDIENTE',
  APROBADA: 'APROBADA',
  RECHAZADA: 'RECHAZADA',
} as const;

export type EstadoSolicitudCambio =
  (typeof ESTADOS_SOLICITUD_CAMBIO)[keyof typeof ESTADOS_SOLICITUD_CAMBIO];

export const ESTADOS_SOLICITUD_CAMBIO_LISTA: readonly EstadoSolicitudCambio[] =
  Object.values(ESTADOS_SOLICITUD_CAMBIO);

/** Estados terminales: una solicitud resuelta no vuelve a abrirse. */
export const ESTADOS_SOLICITUD_CAMBIO_TERMINALES: readonly EstadoSolicitudCambio[] = [
  ESTADOS_SOLICITUD_CAMBIO.APROBADA,
  ESTADOS_SOLICITUD_CAMBIO.RECHAZADA,
];

export function esEstadoTerminalSolicitud(estado: unknown): boolean {
  return (ESTADOS_SOLICITUD_CAMBIO_TERMINALES as readonly string[]).includes(estado as string);
}

/** D26: el rechazo exige un motivo, y el CHECK de la base exige 5 caracteres. */
export const MOTIVO_RECHAZO_MIN = 5;

/**
 * §8.4 · la matriz, fila por fila. `desde: null` es la CREACIÓN de la solicitud.
 * El actor lo comprueba el servicio (`SOLO_ADMIN_BARBERIA` y la ruta de
 * plataforma), no el grafo.
 */
export interface TransicionSolicitudCambio {
  readonly desde: EstadoSolicitudCambio | null;
  readonly hacia: EstadoSolicitudCambio;
  readonly actor: 'ADMIN_BARBERIA' | 'ADMINISTRADOR';
  readonly condicion: string;
}

export const TRANSICIONES_SOLICITUD_CAMBIO: readonly TransicionSolicitudCambio[] = [
  {
    desde: null,
    hacia: ESTADOS_SOLICITUD_CAMBIO.PENDIENTE,
    actor: 'ADMIN_BARBERIA',
    condicion: 'la sede propone un nombre nuevo o un responsable existente',
  },
  {
    desde: ESTADOS_SOLICITUD_CAMBIO.PENDIENTE,
    hacia: ESTADOS_SOLICITUD_CAMBIO.APROBADA,
    actor: 'ADMINISTRADOR',
    condicion: 'el valor propuesto sigue siendo válido al aprobar',
  },
  {
    desde: ESTADOS_SOLICITUD_CAMBIO.PENDIENTE,
    hacia: ESTADOS_SOLICITUD_CAMBIO.RECHAZADA,
    actor: 'ADMINISTRADOR',
    condicion: 'motivo obligatorio',
  },
];
