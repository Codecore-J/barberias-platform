/**
 * Fase 4 · modelo de la agenda, tipado de una vez para toda la app.
 *
 * La agenda trabajaba con `any[]`: la plantilla podía leer `turno.estadoi` o
 * `turno.precioTotal` sin que TypeScript dijera nada, y el estado de una cita se
 * comparaba contra literales escritos a mano en cada componente. Con estos tipos
 * el compilador protege también la plantilla (Angular comprueba los bindings con
 * `strictTemplates`), así que un estado mal escrito deja de ser un bug silencioso
 * en producción y pasa a ser un error de compilación.
 */

/**
 * Los estados que el backend puede devolver en §5.1/§5.2.
 *
 * La lista es la COMPLETA, no solo los seis que se pintan con color: `RECHAZADA`,
 * `EXPIRADA` y `NO_PRESENTADO` también llegan en el histórico del día y la
 * pantalla los agrupa con los terminales. Recortarla obligaría a un `as` en cada
 * comparación, que es justo la laxitud que este archivo viene a quitar.
 */
export type EstadoReserva =
  | 'PENDIENTE'
  | 'PROPUESTA_PENDIENTE'
  | 'CONFIRMADA'
  | 'COMPLETADA'
  | 'CANCELADA'
  | 'RECHAZADA'
  | 'EXPIRADA'
  | 'NO_ASISTIO'
  | 'NO_PRESENTADO';

/** Los estados en los que la cita ya no admite acciones. */
export const ESTADOS_TERMINALES: readonly EstadoReserva[] = [
  'CANCELADA',
  'COMPLETADA',
  'RECHAZADA',
  'EXPIRADA',
  'NO_ASISTIO',
  'NO_PRESENTADO',
];

/** Filtro de la columna: un estado concreto o todos. */
export type FiltroEstado = EstadoReserva | 'TODOS';

/**
 * Cliente de la cita. `contadorNoPresentado` y `estaRestringido` son de ESA sede
 * (E4-03, D48): la restricción nunca es global a la cuenta. El backend los
 * rellena siempre con 0/false cuando no hay fila de sede, por eso son
 * obligatorios y la plantilla no tiene que defenderse de `undefined`.
 */
export interface TurnoCliente {
  id: string;
  nombre: string;
  contadorNoPresentado: number;
  estaRestringido: boolean;
}

export interface TurnoBarbero {
  id: string;
  nombre: string;
}

/** Servicio de la cita con su precio y duración CONGELADOS al reservar. */
export interface TurnoDetalle {
  id: string;
  nombreServicioHist: string;
  duracionMinutosHist: number;
  precioHistorico?: number;
}

/**
 * Una cita tal como la sirve `GET /shops/:shopId/appointments/day`.
 *
 * `precioTotalHist` admite `string` a propósito: es un `Decimal` de Prisma y
 * viaja serializado como texto. Tiparlo solo como `number` mentiría y obligaría a
 * castear en cada lectura; `Number(...)` sigue siendo necesario al sumarlo.
 *
 * `cliente` NO es opcional: el backend siempre lo arma (con `'Cliente'` y
 * `'Sin teléfono'` de respaldo), así que la plantilla puede leerlo sin guardas.
 * `barbero`, en cambio, sí puede venir `null` en un turno walk-in sin asignar.
 */
export interface Turno {
  id: string;
  estado: EstadoReserva;
  fechaHoraInicio: string;
  precioTotalHist: number | string;
  cliente: TurnoCliente;
  barbero: TurnoBarbero | null;
  detalles: TurnoDetalle[];
}

/**
 * Una cita del PROPIO cliente (`GET /appointments/mine`).
 *
 * Trae `barberiaNombre` en vez del `cliente`, que aquí es el usuario que la
 * pide y no hace falta pintarlo; el resto de campos coincide con `Turno`.
 */
export interface ReservaCliente {
  id: string;
  estado: EstadoReserva;
  fechaHoraInicio: string;
  precioTotalHist: number | string;
  barberiaNombre: string;
  detalles: TurnoDetalle[];
}
