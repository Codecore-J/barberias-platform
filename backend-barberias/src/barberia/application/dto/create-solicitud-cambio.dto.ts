import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  TIPOS_SOLICITUD_CAMBIO_LISTA,
  type TipoSolicitudCambio,
} from '../../domain/solicitud-cambio.js';

/**
 * E3-13 · `POST /barberias/:id/solicitudes-cambio` (ADMIN_BARBERIA).
 *
 * `valorNuevo` es el nombre propuesto cuando `tipo = NOMBRE` y el uuid del
 * usuario propuesto cuando `tipo = RESPONSABLE`. La comprobación de que ese
 * usuario EXISTE es de negocio y la hace el servicio (422
 * `RESPONSABLE_INEXISTENTE`): el DTO solo cierra el catálogo de tipos.
 */
export class CreateSolicitudCambioDto {
  @IsIn(TIPOS_SOLICITUD_CAMBIO_LISTA)
  tipo: TipoSolicitudCambio;

  @IsString()
  @MinLength(3)
  @MaxLength(150)
  valorNuevo: string;
}
