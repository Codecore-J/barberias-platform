import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class RegistrarPagoDto {
  @IsUUID('4', { message: 'reservaId debe ser un UUID válido versión 4' })
  @IsNotEmpty({ message: 'El ID de la reserva es obligatorio' })
  reservaId: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto debe tener máximo 2 decimales' })
  @IsPositive({ message: 'El monto a pagar debe ser mayor a cero' })
  monto?: number;

  @IsOptional()
  @IsString({ message: 'El método de pago debe ser una cadena de texto' })
  metodoPago?: string;
}
