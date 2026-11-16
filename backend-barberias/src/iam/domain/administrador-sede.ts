import { errorDeConflicto } from '../../shared/errors/d40.errors.js';
import { ROL_ADMIN_BARBERIA } from './roles.js';

/**
 * Fase 1 · un solo `ADMIN_BARBERIA` ACTIVO por sede.
 *
 * La regla es de dominio, no del `ValidationPipe`: el DTO no puede saber cuántos
 * administradores tiene una sede. Se aplica en LOS DOS caminos que pueden
 * asignar el rol (`POST /plataforma/usuarios` e `invitarPersonal`) y también al
 * promover un miembro en `PATCH /shops/:shopId/staff/:userId`, porque dejar
 * cualquiera de las tres puertas abierta produce el mismo daño: dos dueños con
 * control total del mismo local.
 *
 * `estado: 'ACTIVO'` es deliberado: un vínculo revocado no administra nada y no
 * debe impedir nombrar un reemplazo. (Una cuenta suspendida conserva su vínculo
 * ACTIVO y por eso bloquea la sede hasta que se regularice desde la bandeja de
 * plataforma: preferimos fallar cerrado antes que dejar dos administradores.)
 *
 * La comprobación debe ejecutarse DENTRO de la transacción del alta: fuera de
 * ella, dos operadores creando dueños a la vez en la misma sede pasan los dos.
 * Los llamadores usan `withSerializableTransaction`, que reintenta la
 * transacción completa ante un choque de serialización; en el reintento la
 * consulta ve al ganador y responde 409 en lugar de duplicar.
 */

export const CODIGO_SEDE_YA_TIENE_ADMIN = 'SEDE_YA_TIENE_ADMIN';
export const CODIGO_ADMIN_NO_SE_DEGRADA = 'ADMIN_NO_SE_DEGRADA';

/** Datos mínimos del administrador que ya ocupa la sede (D40 · contexto). */
export interface AdminActualDto {
  id: string;
  correo: string;
  nombreCompleto: string;
}

/** Cliente mínimo de Prisma que necesita la comprobación (sirve `tx` y el cliente). */
interface ClienteDeAdministradores {
  usuarioRol: {
    findFirst(args: unknown): Promise<unknown>;
  };
}

/**
 * Lanza 409 `SEDE_YA_TIENE_ADMIN` con `adminActual` si la sede ya tiene un
 * administrador ACTIVO distinto de `excluirUsuarioId`.
 *
 * `adminActual` viaja en el cuerpo para que la interfaz pueda decir QUIÉN es el
 * dueño actual y ofrecer reemplazarlo, en vez de obligar al operador a buscar el
 * correo a mano en la bandeja.
 */
export async function asegurarSedeSinAdmin(
  prisma: ClienteDeAdministradores,
  barberiaId: string,
  excluirUsuarioId?: string,
): Promise<void> {
  const asignacion = (await prisma.usuarioRol.findFirst({
    where: {
      barberiaId,
      estado: 'ACTIVO',
      rol: { nombre: ROL_ADMIN_BARBERIA },
      // F4 · la cuenta tiene que estar ACTIVA: un dueño suspendido no puede
      // entrar y, por tanto, no debe bloquear la sede. Antes el vínculo ACTIVO
      // de una cuenta suspendida devolvía 409 y dejaba la sede sin nadie que
      // pudiera nombrar un reemplazo (fallar cerrado hasta el absurdo).
      usuario: { estadoCuenta: 'ACTIVO' },
      ...(excluirUsuarioId ? { usuarioId: { not: excluirUsuarioId } } : {}),
    },
    select: {
      usuario: { select: { id: true, correo: true, nombreCompleto: true } },
    },
  })) as { usuario: AdminActualDto } | null;

  if (!asignacion?.usuario) return;

  throw errorDeConflicto(
    CODIGO_SEDE_YA_TIENE_ADMIN,
    'La sede ya tiene un administrador activo.',
    { adminActual: asignacion.usuario },
  );
}
