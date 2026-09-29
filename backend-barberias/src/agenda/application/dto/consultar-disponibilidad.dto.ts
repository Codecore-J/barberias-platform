import { IsDateString, IsInt, IsOptional, IsPositive, Min } from 'class-validator';

export class ConsultarDisponibilidadDto {
  @IsDateString({}, { message: 'fecha debe ser una fecha válida en formato YYYY-MM-DD' })
  fecha: string;

  @IsInt({ message: 'duracionTotal debe ser un número entero' })
  @IsPositive({ message: 'duracionTotal debe ser mayor a cero' })
  duracionTotal: number;

  @IsOptional()
  @IsInt({ message: 'margenRequerido debe ser un número entero' })
  @Min(0, { message: 'margenRequerido no puede ser negativo' })
  margenRequerido?: number;
}
