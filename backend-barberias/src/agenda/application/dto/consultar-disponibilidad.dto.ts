import { IsDateString, IsInt, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';

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

  /**
   * V3 fase 5 · barbero concreto. Con él, la jornada del día se intersecta con
   * su horario y su descanso deja de estar disponible. Sin él, la consulta es
   * la de la sede entera (comportamiento histórico).
   */
  @IsOptional()
  @IsUUID('4', { message: 'barberoId debe ser un UUID válido' })
  barberoId?: string;
}
