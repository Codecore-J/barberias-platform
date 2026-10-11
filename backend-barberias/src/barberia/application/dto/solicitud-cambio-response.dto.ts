import type { EstadoSolicitudCambio, TipoSolicitudCambio } from '../../domain/solicitud-cambio.js';

/**
 * E3-13 · contrato de salida de una solicitud de cambio (D26).
 *
 * Es un mapeo explícito campo por campo de la fila Prisma: el panel de
 * plataforma no recibe nunca el objeto crudo de la base.
 */
export class SolicitudCambioResponseDto {
  id: string;
  barberiaId: string;
  tipo: TipoSolicitudCambio;
  valorNuevo: string;
  estado: EstadoSolicitudCambio;
  solicitadoPor: string;
  resueltoPor: string | null;
  motivoRechazo: string | null;
  creadoAt: Date | null;
  resueltoAt: Date | null;
  /** Solo en el listado: el ADMINISTRADOR resuelve sin una segunda consulta. */
  barberia?: { id: string; nombre: string };
}
