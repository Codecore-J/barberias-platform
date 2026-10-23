/** Quién ejecutó el evento (columna `auditoria.usuario_id`). */
export interface AuditoriaActorDto {
  id: string;
  nombreCompleto: string;
  correo: string;
}

/**
 * Evento del historial de una cuenta, tal y como lo devuelve
 * `GET /plataforma/usuarios/:id/auditoria`.
 *
 * `contexto` viaja completo porque es donde viven la comparación
 * `anterior`/`nuevo`, el `sesionesCerradas` de una suspensión y el `rol` de un
 * alta. `motivo` se extrae además a primer nivel porque es lo que la bandeja
 * muestra sin abrir el detalle (y el backend lo exige en D09/D24).
 */
export class UsuarioAuditoriaResponseDto {
  id: string;

  /** `CUENTA_SUSPENDIDA`, `CUENTA_REACTIVADA`, `USUARIO_CREADO`, … */
  accion: string;

  entidad: string;

  entidadId: string | null;

  barberiaId: string | null;

  /** `contexto.motivo` cuando existe (suspensión, reactivación, rechazo…). */
  motivo: string | null;

  contexto: Record<string, unknown> | null;

  /** Administrador que ejecutó la acción; `null` si el evento es del sistema. */
  actor: AuditoriaActorDto | null;

  creadoAt: Date | null;
}
