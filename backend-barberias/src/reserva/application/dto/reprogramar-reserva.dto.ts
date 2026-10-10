import { IsDateString, IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * E3-06 · Nuevo bloque horario de una reserva ya existente.
 *
 * Solo lleva FECHA y RANGO: los servicios, sus snapshots (precio, duración y
 * margen históricos) y el total a pagar NO se tocan al reprogramar. Mover una
 * cita no puede cambiar lo que se pactó, así que este DTO no expone `serviciosIds`
 * ni `precioTotalEsperado` a propósito: si el cliente quiere otro servicio, es
 * una reserva nueva.
 *
 * Los mismos validadores que `CreateReservaDto` (`HH:mm` y fecha ISO) para que el
 * 400 de formato sea idéntico en las dos rutas.
 */
export class ReprogramarReservaDto {
  @IsDateString()
  fecha: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaInicio debe estar en formato HH:mm' })
  horaInicio: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaFin debe estar en formato HH:mm' })
  horaFin: string;
}
