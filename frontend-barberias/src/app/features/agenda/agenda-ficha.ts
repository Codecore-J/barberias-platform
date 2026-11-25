import type { Turno } from '../../core/models/turno.model';

/**
 * F3-05 · decide si la agenda puede abrir la ficha del cliente de un turno.
 *
 * En un walk-in `cliente.id` es el OPERADOR que tecleó la cita (T-05), no la
 * persona atendida: su ficha mostraría datos del staff y daría a entender que
 * el turno es suyo. El nombre visible ya viene resuelto (F3-01), pero el id no,
 * así que la señal es `esWalkIn`.
 *
 * Un turno sin el flag es anterior a F3-01 y se comporta como normal: la
 * ausencia del campo no debe ocultar fichas que sí son del cliente.
 */
export function puedeAbrirFichaDeCliente(
  turno: Pick<Turno, 'esWalkIn'> | null | undefined,
): boolean {
  return !!turno && turno.esWalkIn !== true;
}
