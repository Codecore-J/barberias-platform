import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { errorDeConflicto, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';
import type { CambiarEstadoCuentaDto } from './dto/cambiar-estado-cuenta.dto.js';
import { UsuarioListResponseDto } from './dto/usuario-list-response.dto.js';

/** Lo que devuelve el cambio de estado de una cuenta. */
export interface CambioEstadoCuentaResultado {
  id: string;
  estadoCuenta: 'ACTIVO' | 'SUSPENDIDO';
  /** Versión vigente del token: sube al suspender (D24). */
  tokenVersion: number;
  /** `true` si esta llamada dejó inválidos los tokens ya emitidos. */
  sesionesCerradas: boolean;
}

/**
 * E4-03/5 · D09/D24 · suspensión y reactivación de la CUENTA global.
 *
 * Este servicio es el ÚNICO camino del sistema que cambia `usuarios.estado_cuenta`
 * después del alta: D48 prohíbe expresamente que el contador de inasistencias de
 * una sede suspenda una cuenta, y `test/estado-cuenta-guard.spec.ts` lo vigila
 * sobre el código fuente. Suspender es una decisión manual, motivada y auditada
 * del ADMINISTRADOR de la plataforma.
 *
 * Al suspender se sube `token_version`: los JWT ya firmados llevan la versión
 * anterior y el `JwtStrategy` los rechaza, de modo que las sesiones se cierran en
 * todos los dispositivos y NO vuelven a abrirse al reactivar la cuenta. Reactivar
 * no toca la versión (no hay nada que cerrar).
 *
 * Todo ocurre en UNA transacción con la auditoría dentro: si el evento no se
 * escribe, el estado tampoco cambia (D28).
 */
@Injectable()
export class UsuariosPlataformaService {
  private readonly logger = new Logger(UsuariosPlataformaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async cambiarEstado(
    usuarioId: string,
    solicitante: UsuarioAutenticado,
    dto: CambiarEstadoCuentaDto,
  ): Promise<CambioEstadoCuentaResultado> {
    const motivo = dto.motivo?.trim();

    if (!motivo) {
      throw reglaDeNegocio(
        'MOTIVO_REQUERIDO',
        'Suspender o reactivar una cuenta exige un motivo: queda en la auditoría.',
      );
    }

    const suspender = dto.estadoCuenta === 'SUSPENDIDO';

    const resultado = await withSerializableTransaction(this.prisma, async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { id: usuarioId },
        select: { id: true, correo: true, estadoCuenta: true, tokenVersion: true },
      });

      if (!usuario) {
        throw new NotFoundException('Usuario no encontrado.');
      }

      if (usuario.estadoCuenta === dto.estadoCuenta) {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `La cuenta ya está en estado ${dto.estadoCuenta}.`,
        );
      }

      const tokenVersion = suspender ? usuario.tokenVersion + 1 : usuario.tokenVersion;

      await tx.usuario.update({
        where: { id: usuarioId },
        data: { estadoCuenta: dto.estadoCuenta, tokenVersion },
      });

      await this.auditoria.registrarEvento(
        {
          usuarioId: solicitante.id,
          accion: suspender ? 'CUENTA_SUSPENDIDA' : 'CUENTA_REACTIVADA',
          entidad: 'usuarios',
          entidadId: usuarioId,
          contexto: {
            motivo,
            // D28: valor anterior y nuevo, explícitos. `tokenVersion` va incluido
            // porque es la prueba de que las sesiones quedaron cerradas.
            anterior: {
              estadoCuenta: usuario.estadoCuenta,
              tokenVersion: usuario.tokenVersion,
            },
            nuevo: {
              estadoCuenta: dto.estadoCuenta,
              tokenVersion,
            },
            sesionesCerradas: suspender,
          },
        },
        tx,
      );

      this.logger.warn(
        suspender
          ? `Cuenta ${usuario.correo} suspendida por ${solicitante.correo}: ${motivo}`
          : `Cuenta ${usuario.correo} reactivada por ${solicitante.correo}: ${motivo}`,
      );

      return {
        id: usuarioId,
        estadoCuenta: dto.estadoCuenta,
        tokenVersion,
        sesionesCerradas: suspender,
      } satisfies CambioEstadoCuentaResultado;
    });

    return resultado;
  }

  /**
   * Lista todos los usuarios de la plataforma.
   *
   * Contrato:
   * - `GET /plataforma/usuarios` → `200` con `UsuarioListResponseDto[]`.
   * - Solo `ADMINISTRADOR` (D05), aprobado por `RolesGuard` + `@Roles`.
   * - Orden: `fecha_registro DESC` (la columna se llama `creado_at`).
   * - `roles` sale como un array de strings con los nombres, sin repetir: un
   *   `ADMIN_BARBERIA` con tres sedes aparece una sola vez.
   *
   * El `select` es explícito a propósito: `password_hash`, `token_version` y
   * `cedula` no se leen, así que no hay forma de que se cuelen en la respuesta.
   */
  async obtenerTodosLosUsuarios(): Promise<UsuarioListResponseDto[]> {
    const usuarios = await this.prisma.usuario.findMany({
      orderBy: { creadoAt: 'desc' },
      select: {
        id: true,
        nombreCompleto: true,
        correo: true,
        telefono: true,
        estadoCuenta: true,
        creadoAt: true,
        usuarioRoles: {
          select: {
            rol: {
              select: { nombre: true },
            },
          },
        },
      },
    });

    return usuarios.map((usuario) => ({
      id: usuario.id,
      nombreCompleto: usuario.nombreCompleto,
      correo: usuario.correo,
      telefono: usuario.telefono,
      estadoCuenta: usuario.estadoCuenta,
      fechaRegistro: usuario.creadoAt,
      roles: [...new Set(usuario.usuarioRoles.map(({ rol }) => rol.nombre))],
    }));
  }
}
