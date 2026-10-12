import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * E4-03 · cuerpo de `POST /barberias/:id/clientes/:clienteId/reactivar`.
 *
 * El motivo es opcional: la acción ya la autoriza el rol, pero cuando llega se
 * guarda en la auditoría (`RESTRICCION_LEVANTADA`) junto al valor anterior y al
 * nuevo (D28). No se exige para no convertir un perdón legítimo en un 422 por
 * un campo de texto que la política del dueño no marcó como obligatorio.
 */
export class ReactivarClienteDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  motivo?: string;
}
