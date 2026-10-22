import { ArrayNotEmpty, IsArray, IsDateString, IsUUID } from 'class-validator';

/**
 * E4-02 · D22: alta de una suscripción a la lista de espera (Carril B).
 *
 * El cliente no elige barbero ni hora: dice QUÉ día, en QUÉ sede y PARA QUÉ
 * servicios aceptaría un hueco que se libere. El `usuarioId` nunca viaja en el
 * cuerpo — sale del token en el controlador.
 *
 * `fechaObjetivo` es una etiqueta de calendario `YYYY-MM-DD` de la sede (el
 * mismo formato de `fechaCita`), no un instante: `IsDateString` rechaza lo que
 * no sea ISO y `TiempoService.fechaDeCalendario` la fija en la medianoche UTC
 * que Prisma espera para una columna `DATE`.
 */
export class CreateListaEsperaDto {
  @IsUUID('4')
  barberiaId: string;

  @IsDateString()
  fechaObjetivo: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Debe indicar al menos un servicio' })
  @IsUUID('4', { each: true })
  servicios: string[];
}
