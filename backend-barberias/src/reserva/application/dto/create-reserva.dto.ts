import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * E4-01 §2 · un participante de la reserva grupal. Los niños NO son cuentas: el
 * nombre es un dato de la reserva, no se crean usuarios, roles ni vinculaciones.
 */
export class ParticipanteReservaDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsBoolean()
  esAdultoResponsable: boolean;

  @IsArray()
  @ArrayNotEmpty({ message: 'Cada participante debe incluir al menos un servicio' })
  @IsUUID('4', { each: true })
  servicios: string[];
}

export class CreateReservaDto {
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

  /**
   * E4-01: en la reserva GRUPAL los servicios viven dentro de cada participante
   * (`participantes[].servicios`), así que esta lista solo se exige en el flujo
   * individual. La validación es condicional y NO se relaja: sin `tipo` —o con
   * cualquier otro tipo— sigue siendo obligatoria y no vacía.
   */
  @ValidateIf((o: CreateReservaDto) => o.tipo !== 'GRUPAL')
  @IsArray()
  @ArrayNotEmpty({ message: 'Debe incluir al menos un servicio en la reserva' })
  @IsUUID('4', { each: true })
  serviciosIds: string[];

  @IsNumber()
  @Min(0, { message: 'El precio total esperado no puede ser negativo' })
  precioTotalEsperado: number;

  @IsOptional()
  @IsUUID('4')
  barberoId?: string;

  @IsOptional()
  @IsString()
  nombreInvitado?: string;

  /** E3-03/2: el tipo de reserva es obligatorio; nunca se asume en silencio. */
  @IsString()
  @IsNotEmpty()
  @IsIn(['INDIVIDUAL', 'GRUPAL', 'AUTOMATICO', 'MANUAL'])
  tipo: string;

  /**
   * E4-01 §2 · participantes de la reserva grupal: un adulto responsable más uno
   * o más niños, cada uno con al menos un servicio de ESA sede.
   *
   * El DTO garantiza la forma de CADA participante (nombre, marca de adulto y
   * servicios no vacíos). La forma del GRUPO —al menos dos participantes,
   * exactamente un adulto y la capacidad D46— se resuelve en el servicio, porque
   * su precedencia importa: una sede con `acepta_grupal = false` debe seguir
   * respondiendo 422 `GRUPAL_NO_DISPONIBLE` aunque el grupo llegue incompleto
   * (es lo que ya asegura el E2E de E3-03).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipanteReservaDto)
  participantes?: ParticipanteReservaDto[];
}
