import { IsUUID } from 'class-validator';

/**
 * V3 · reasignación de barbero (la limitación funcional que la agenda arrastraba
 * desde la Fase 2: un turno «Sin Asignar» no se podía mover a un barbero).
 *
 * Solo viaja el barbero destino. La reserva va en la ruta y la sede sale de la
 * PROPIA reserva: aceptarla en el cuerpo obligaría a confiar en el cliente para
 * decidir el tenant.
 */
export class AsignarBarberoDto {
  @IsUUID('4', { message: 'El barbero indicado no es válido.' })
  barberoId: string;
}
