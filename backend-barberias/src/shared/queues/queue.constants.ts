/**
 * Constantes y tipos estandarizados para colas y jobs de BullMQ.
 * Evita strings mágicos y asegura tipado en los payloads de eventos asíncronos.
 */

export const QUEUES = {
  RESERVAS: 'queue:reservas',
  NOTIFICACIONES: 'queue:notificaciones',
  AUDITORIA: 'queue:auditoria',
  BLOQUEOS: 'queue:bloqueos',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  // Épica 5: Expiración defensiva de reserva tras 10 minutos
  EXPIRAR_RESERVA: 'job:expirar-reserva',

  // Épica 4: Liberación de bloqueo temporal de agenda
  LIBERAR_BLOQUEO: 'job:liberar-bloqueo',

  // Épica 8: Recordatorio obligatorio 1h antes y notificaciones
  RECORDATORIO_CITA_1H: 'job:recordatorio-cita-1h',
  NOTIFICACION_RESERVA_CREADA: 'job:notificacion-reserva-creada',
  NOTIFICACION_RESERVA_CONFIRMADA: 'job:notificacion-reserva-confirmada',

  // Épica 8: Cron diario de purga de auditoría
  PURGA_AUDITORIA_DIARIA: 'job:purga-auditoria-diaria',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

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
