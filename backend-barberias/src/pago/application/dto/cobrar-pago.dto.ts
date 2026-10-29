import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';
import { METODOS_PAGO, type MetodoPago } from '../../domain/metodos-pago.js';

/**
 * V3 fase 6 · `POST /pagos/cobrar`.
 *
 * Es el contrato del modal de cobro de la agenda. No lleva `barberiaId`: la sede
 * se deduce de la RESERVA en el servicio, que es la única que puede decir a qué
 * sede pertenece el cobro. Aceptarla del cliente permitiría mandar un cobro de
 * una sede a otra.
 *
 * `monto` es opcional y, cuando llega, el servicio exige que coincida con el
 * `totalPagar` de la reserva. Pagos parciales no existen en este flujo: la
 * reserva guarda su total congelado y cobrar otra cifra descuadraría el arqueo.
 */
export class CobrarPagoDto {
  @IsUUID('4', { message: 'reservaId debe ser un UUID válido versión 4' })
  @IsNotEmpty({ message: 'El ID de la reserva es obligatorio' })
  reservaId: string;

  @IsIn(METODOS_PAGO, {
    message: `El método de pago debe ser uno de: ${METODOS_PAGO.join(', ')}`,
  })
  metodo: MetodoPago;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto debe tener máximo 2 decimales' })
  @IsPositive({ message: 'El monto a pagar debe ser mayor a cero' })
  monto?: number;
}
