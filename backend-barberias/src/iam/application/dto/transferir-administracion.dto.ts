import { IsUUID } from 'class-validator';

/**
 * F7 / T-73 · cuerpo de `PATCH /plataforma/sedes/:sedeId/transferir-admin`.
 *
 * El UUID del nuevo administrador se valida como UUID para que un id mal
 * copiado no llegue a la base y responda un 404 engañoso: el contrato D40 lo
 * devuelve como 400 del `ValidationPipe`.
 */
export class TransferirAdministracionDto {
  @IsUUID('4', { message: 'nuevoAdminId debe ser un UUID válido.' })
  nuevoAdminId!: string;
}
