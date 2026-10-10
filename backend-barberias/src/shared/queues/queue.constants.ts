/**
 * Constantes y tipos estandarizados para colas y jobs de BullMQ.
 * Evita strings mágicos y asegura tipado en los payloads de eventos asíncronos.
 *
 * HALLAZGO-E305-01 (2026-10-09): este archivo declaraba `queue:reservas`,
 * `queue:notificaciones`, `job:expirar-reserva`... y NADIE lo importaba: el
 * productor y el consumidor iban por literales. Además, esos valores no eran
 * implementables: BullMQ RECHAZA cualquier nombre de cola que contenga ':'
 * (`node_modules/bullmq/dist/cjs/classes/queue-base.js`: "Queue name cannot
 * contain :") y también los `jobId` propios con ':' (classes/job.js: "Custom Id
 * cannot contain :"). Un arranque con `QUEUES.RESERVAS` habría caído en el
 * constructor. Ahora cada valor es el nombre REAL que ya viaja por Redis: no se
 * renombra ninguna cola, así no se huerfanan jobs pendientes.
 *
 * Convención resultante (la que ya usaba el código): kebab-case sin prefijos.
 */

export const QUEUES = {
  RESERVAS: 'reservas-pendientes', // ReservaModule / ReservaProcessor
  NOTIFICACIONES: 'notificaciones', // NotificacionModule / NotificacionProcessor
  AUDITORIA: 'auditoria-purga', // AuditoriaModule / AuditoriaProcessor
  BLOQUEOS: 'agenda-bloqueos', // AgendaModule / BloqueosProcessor
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  // Épica 5: Expiración defensiva de reserva tras 10 minutos.
  // E3-05: único job que HOY tiene productor y consumidor cableados a estas
  // constantes.
  EXPIRAR_RESERVA: 'expirar-reserva',

  // Épica 4: Liberación de bloqueo temporal de agenda
  LIBERAR_BLOQUEO: 'liberar-bloqueo',

  // Épica 8: Recordatorio obligatorio 1h antes y notificaciones.
  // El despacho real comparte un único nombre de job en la cola de
  // notificaciones ('enviar-notificacion'); lo que distingue a cada
  // notificación es el `tipo` del payload, no el nombre del job.
  RECORDATORIO_CITA_1H: 'recordatorio-cita',
  NOTIFICACION_RESERVA_CREADA: 'enviar-notificacion',
  NOTIFICACION_RESERVA_CONFIRMADA: 'enviar-notificacion',

  // Épica 8: Cron diario de purga de auditoría (03:00)
  PURGA_AUDITORIA_DIARIA: 'purga-auditoria-diaria',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/**
 * `jobId` DETERMINÍSTICO del job de expiración (D33), para poder encontrarlo y
 * cancelarlo al aceptar, rechazar o cancelar.
 *
 * El diseño (D33) escribe `expirar:{reservaId}`, pero BullMQ prohíbe ':' en los
 * `jobId` propios, así que el separador es '-' y el resultado es
 * `expirar-reserva-<uuid>`. Vive aquí —y no en el servicio— para que el
 * productor (`ReservaService`), el consumidor (`ReservaProcessor`) y la
 * reconciliación (`ExpiracionReservaService`) calculen el MISMO id.
 */
export function jobIdExpiracionReserva(reservaId: string): string {
  return `${JOBS.EXPIRAR_RESERVA}-${reservaId}`;
}

// ── Payloads tipados para cada Job ──────────────────────────────────────────

export interface ExpirarReservaJobPayload {
  reservaId: string;
  barberiaId: string;
}

export interface LiberarBloqueoJobPayload {
  bloqueoId: string;
  barberiaId: string;
}

export interface RecordatorioCitaJobPayload {
  reservaId: string;
  clienteId: string;
  barberiaId: string;
  fechaCita: string;
  horaInicio: string;
  telefonoCliente: string;
}

export interface NotificacionReservaPayload {
  reservaId: string;
  usuarioId: string;
  tipo: 'RESERVA_CREADA' | 'RESERVA_CONFIRMADA' | 'RESERVA_RECHAZADA' | 'RESERVA_CANCELADA';
  canal: 'APP' | 'WHATSAPP' | 'SMS';
  mensaje: string;
}

export interface PurgaAuditoriaJobPayload {
  diasRetencion: number; // Por defecto: 365 días
}
