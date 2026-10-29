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
   * individual.
   *
   * V3 fase 4: en el flujo individual con catálogo HÍBRIDO los servicios llegan
   * en `serviciosBarberoIds`, así que tampoco se exige aquí. La regla sigue
   * siendo estricta: una reserva individual sin NINGUNO de los dos catálogos se
   * rechaza en `ReservaService.crearReserva` con 400, porque un DTO que se
   * relajara a `@IsOptional()` a secas aceptaría una reserva de cero servicios.
   */
  @ValidateIf(
    (o: CreateReservaDto) =>
      o.tipo !== 'GRUPAL' && !(o.serviciosBarberoIds && o.serviciosBarberoIds.length > 0),
  )
  @IsArray()
  @ArrayNotEmpty({ message: 'Debe incluir al menos un servicio en la reserva' })
  @IsUUID('4', { each: true })
  serviciosIds?: string[];

  /**
   * V3 fase 4 · servicios del catálogo híbrido (`servicios_barbero`).
   *
   * Cada barbero publica los suyos con su precio y su duración, así que la
   * reserva tiene que decir de QUIÉN son: el servicio y `barberoId` forman una
   * pareja indivisible y el servicio comprueba que cada id pertenece a ese
   * barbero y a esa sede. El precio y la duración NO se aceptan del cliente:
   * se calculan en el servidor sumando los valores del catálogo.
   *
   * Es excluyente con `serviciosIds` (una reserva mezcla catálogos o no los
   * mezcla): si llegan los dos, `crearReserva` responde 400
   * `CATALOGO_AMBIGUO`. La reserva GRUPAL sigue usando el catálogo heredado.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'serviciosBarberoIds no puede ir vacío si se envía' })
  @IsUUID('4', { each: true, message: 'Cada servicio del catálogo híbrido debe ser un UUID válido' })
  serviciosBarberoIds?: string[];

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
