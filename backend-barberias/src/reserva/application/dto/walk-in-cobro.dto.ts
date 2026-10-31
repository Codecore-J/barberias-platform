import { IsIn, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateReservaDto } from './create-reserva.dto.js';
import { METODOS_PAGO, type MetodoPago } from '../../../pago/domain/metodos-pago.js';

/**
 * Fase 3 · cuerpo de `POST /shops/:shopId/appointments/walk-in-pago`.
 *
 * La reserva viaja anidada y con las MISMAS validaciones que el alta normal
 * (`CreateReservaDto`), no con una copia relajada: si el walk-in aceptara un
 * cuerpo que el wizard rechaza, existirían dos agendas con reglas distintas.
 */
export class WalkInCobroDto {
  @ValidateNested()
  @Type(() => CreateReservaDto)
  reserva: CreateReservaDto;

  /**
   * Obligatorio y de catálogo cerrado: el arqueo agrupa por método y un valor
   * libre dejaría el dinero fuera de las tres bolsas (EFECTIVO/TARJETA/
   * TRANSFERENCIA).
   */
  @IsIn(METODOS_PAGO, {
    message: `El método de pago debe ser uno de: ${METODOS_PAGO.join(', ')}`,
  })
  @IsNotEmpty({ message: 'El método de pago es obligatorio para cobrar la cita' })
  metodoPago: MetodoPago;
}
