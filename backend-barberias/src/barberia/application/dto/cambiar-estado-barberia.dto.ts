import { IsIn } from 'class-validator';

/**
 * E2-07 · cuerpo de `PATCH /barberias/:id/estado`.
 *
 * El borrado lógico pasa a ser un CAMBIO DE ESTADO explícito: suspender una sede
 * (`INACTIVO`) y volver a activarla (`ACTIVO`) son la misma operación con dos
 * valores, y la ruta ya no se llama `DELETE` cuando el efecto es «suspender».
 *
 * `estado` es obligatorio a propósito: sin él la petición no dice qué hacer y el
 * `ValidationPipe` la rechaza con 400 antes de llegar al servicio.
 */
export class CambiarEstadoBarberiaDto {
  @IsIn(['ACTIVO', 'INACTIVO'])
  estado!: 'ACTIVO' | 'INACTIVO';
}
