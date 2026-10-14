import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * E4-03/5 · cuerpo de `PATCH /plataforma/usuarios/:id/estado`.
 *
 * D09/D24: suspender y reactivar la CUENTA es una decisión manual del
 * ADMINISTRADOR de la plataforma. `ELIMINADO` no se ofrece por esta ruta: dar de
 * baja una cuenta no es un cambio de estado reversible y el `CHECK` del catálogo
 * lo admite por otros caminos.
 *
 * El motivo es OBLIGATORIO en la regla, pero viaja como opcional aquí: la
 * respuesta tiene que ser 422 `MOTIVO_REQUERIDO` —el contrato D40 de regla de
 * negocio, el mismo código que ya usa E3-13— y no el 400 del `ValidationPipe`.
 */
export class CambiarEstadoCuentaDto {
  @IsIn(['ACTIVO', 'SUSPENDIDO'])
  estadoCuenta!: 'ACTIVO' | 'SUSPENDIDO';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
