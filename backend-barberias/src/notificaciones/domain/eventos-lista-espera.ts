/**
 * Fase 9 · Eventos de dominio de lista de espera.
 *
 * Se emite cuando se libera un hueco y un candidato elegible recibe el aviso
 * (un hueco = un aviso). El payload trae los datos del candidato y del bloque
 * liberado para que el módulo de notificaciones despache por correo/WhatsApp.
 */
export const EVENTOS_LISTA_ESPERA = {
  CUPO_DISPONIBLE: 'lista_espera.cupo_disponible',
} as const;

export type TipoEventoListaEspera = (typeof EVENTOS_LISTA_ESPERA)[keyof typeof EVENTOS_LISTA_ESPERA];

export interface EventoCupoDisponible {
  tipo: TipoEventoListaEspera;
  /** Suscripción que recibió el aviso */
  suscripcionId: string;
  barberiaId: string;
  nombreBarberia: string;
  telefonoBarberia?: string | null;
  fecha: string; // YYYY-MM-DD
  inicio: string; // ISO
  fin: string; // ISO
  horaInicio: string; // HH:mm
  horaFin: string; // HH:mm
  usuarioId: string;
  nombreCliente: string;
  correoCliente: string;
  telefonoCliente: string;
}
