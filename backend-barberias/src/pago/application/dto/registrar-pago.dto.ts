import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';
import { METODOS_PAGO, type MetodoPago } from '../../domain/metodos-pago.js';

export class RegistrarPagoDto {
  @IsUUID('4', { message: 'reservaId debe ser un UUID válido versión 4' })
  @IsNotEmpty({ message: 'El ID de la reserva es obligatorio' })
  reservaId: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto debe tener máximo 2 decimales' })
  @IsPositive({ message: 'El monto a pagar debe ser mayor a cero' })
  monto?: number;

  // V3 fase 6: el método deja de ser texto libre. El arqueo agrupa por método, y
  // una errata («EFECTIVOO») se convertiría en una cuarta bolsa invisible.
  @IsOptional()
  @IsIn(METODOS_PAGO, {
    message: `El método de pago debe ser uno de: ${METODOS_PAGO.join(', ')}`,
  })
  metodoPago?: MetodoPago;
}
