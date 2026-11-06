import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * I-05 · el único rol que el panel de plataforma puede dar o quitar sin
 * ambigüedad: `ADMINISTRADOR` es GLOBAL (D05), no vive en ninguna sede.
 *
 * `BARBERO` y `ADMIN_BARBERIA` son de ámbito sede y se asignan donde tienen
 * sentido (`PATCH /shops/:shopId/staff/:userId`); ofrecerlos aquí crearía filas
 * con `barberia_id` nulo que no dan acceso a nada.
 *
 * Retirar el rol apaga el vínculo (`estado = INACTIVO`), no lo borra: este
 * backend no tiene rutas `@Delete` (Spec 01 §9) y `login`/`JwtStrategy` ya
 * ignoran los vínculos inactivos.
 */
export class AdministradorCuentaDto {
  /** `true` concede el rol global; `false` lo retira. */
  @IsBoolean()
  habilitado!: boolean;

  /** Queda en la auditoría; no es obligatorio (a diferencia de la suspensión). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

/** Un vínculo de rol del usuario, con la sede a la que pertenece si la tiene. */
export interface RolDeUsuarioResponseDto {
  id: string;
  rolNombre: string;
  /** `GLOBAL` o `BARBERIA`, del catálogo de roles. */
  ambito: string;
  estado: string;
  barberiaId: string | null;
  barberiaNombre: string | null;
}
