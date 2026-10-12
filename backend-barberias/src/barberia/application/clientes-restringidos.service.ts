import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { alcanceCumple, esAdministradorGlobal } from '../../iam/domain/roles.js';

/** Fila que devuelve la bandeja de la sede. Nunca datos de otras sedes. */
export interface ClienteRestringidoDto {
  clienteId: string;
  nombreCompleto: string;
  correo: string;
  telefono: string | null;
  contadorNoPresentado: number;
  motivoRestriccion: string | null;
  /** Alta de la vinculación con ESTA sede (no es la fecha de la restricción). */
  vinculadoDesde: Date | null;
}

export interface ReactivacionDto {
  barberiaId: string;
  clienteId: string;
  estaRestringido: false;
  motivoRestriccion: null;
  /** El perdón reinicia el contador de ESA sede (ver decisión del reporte E4-03). */
  contadorNoPresentado: 0;
}

/**
 * E4-03 · Gestión local de la lista de restringidos (spec 01 §5.8, D48).
 *
 * La penalización por inasistencias es de la SEDE: aquí solo se lee y se
 * levanta el estado de una fila de `cliente_barberias`. Nada de este servicio
 * toca `usuarios.estado_cuenta` — suspender la cuenta global es una decisión
 * manual del ADMINISTRADOR de la plataforma (D09/D24) y el aislamiento entre
 * sedes (principio 2) lo prohíbe.
 */
@Injectable()
export class ClientesRestringidosService {
  private readonly logger = new Logger(ClientesRestringidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * El actor tiene que ser el ADMIN_BARBERIA de ESA sede o el ADMINISTRADOR
   * global (transversal, E1-04). El `RolesGuard` no puede comprobarlo: la ruta
   * usa `:id`, no `:barberiaId`, así que el acotado por tenant es de servicio
   * (misma regla que E3-13 en `POST /barberias/:id/solicitudes-cambio`).
   */
  private exigirAdminDeLaSede(
    barberiaId: string,
    solicitante: UsuarioAutenticado,
    accion: string,
  ): void {
    const esAdminDeLaSede = (solicitante.rolesDetallados ?? []).some(
      (rol) => rol.nombre === 'ADMIN_BARBERIA' && alcanceCumple(rol, barberiaId),
    );

    if (esAdministradorGlobal(solicitante) || esAdminDeLaSede) {
      return;
    }

    throw new ForbiddenException(`No tienes permisos para ${accion} en esta barbería.`);
  }

  /**
   * `GET /barberias/:id/clientes-restringidos` · solo las filas restringidas de
   * ESA sede, con el contador y el motivo que la propia restricción guardó.
   */
  async listar(barberiaId: string, solicitante: UsuarioAutenticado): Promise<ClienteRestringidoDto[]> {
    this.exigirAdminDeLaSede(barberiaId, solicitante, 'ver los clientes restringidos');

    const vinculados = await this.prisma.clienteBarberia.findMany({
      where: { barberiaId, estaRestringido: true },
      include: {
        usuario: {
          select: { id: true, nombreCompleto: true, correo: true, telefono: true },
        },
      },
      orderBy: { creadoAt: 'desc' },
    });

    return vinculados.map((vinculo) => ({
      clienteId: vinculo.usuarioId,
      nombreCompleto: vinculo.usuario.nombreCompleto,
      correo: vinculo.usuario.correo,
      telefono: vinculo.usuario.telefono,
      contadorNoPresentado: vinculo.contadorNoPresentado,
      motivoRestriccion: vinculo.motivoRestriccion,
      vinculadoDesde: vinculo.creadoAt,
    }));
  }

  /**
   * `POST /barberias/:id/clientes/:clienteId/reactivar` · el perdón de la sede:
   * levanta la restricción, borra el motivo y reinicia el contador de ESA fila.
   * Todo en una transacción y auditado con el valor anterior y el nuevo (D28).
   *
   * 404 si no hay vinculación (una restricción no puede existir sin fila) y 422
   * `SIN_RESTRICCION` si el cliente no está restringido: perdonar dos veces no
   * es idempotente, es un error de la sede.
   */
  async reactivar(
    barberiaId: string,
    clienteId: string,
    solicitante: UsuarioAutenticado,
    motivo?: string,
  ): Promise<ReactivacionDto> {
    this.exigirAdminDeLaSede(barberiaId, solicitante, 'reactivar clientes restringidos');

    return withSerializableTransaction(this.prisma, async (tx) => {
      const vinculo = await tx.clienteBarberia.findUnique({
        where: { uk_cliente_barberia: { usuarioId: clienteId, barberiaId } },
      });

      if (!vinculo) {
        throw new NotFoundException('El cliente no está vinculado a esta barbería.');
      }

      if (!vinculo.estaRestringido) {
        throw reglaDeNegocio(
          'SIN_RESTRICCION',
          'El cliente no está restringido en esta barbería.',
        );
      }

      await tx.clienteBarberia.update({
        where: { id: vinculo.id },
        data: {
          estaRestringido: false,
          motivoRestriccion: null,
          contadorNoPresentado: 0,
        },
      });

      await this.auditoria.registrarEvento(
        {
          usuarioId: solicitante.id,
          accion: 'RESTRICCION_LEVANTADA',
          entidad: 'cliente_barberias',
          entidadId: vinculo.id,
          contexto: {
            barberiaId,
            clienteId,
            motivo: motivo ?? null,
            anterior: {
              estaRestringido: vinculo.estaRestringido,
              motivoRestriccion: vinculo.motivoRestriccion,
              contadorNoPresentado: vinculo.contadorNoPresentado,
            },
            nuevo: {
              estaRestringido: false,
              motivoRestriccion: null,
              contadorNoPresentado: 0,
            },
          },
        },
        tx,
      );

      this.logger.log(
        `Restricción levantada en la barbería ${barberiaId} para el cliente ${clienteId}`,
      );

      return {
        barberiaId,
        clienteId,
        estaRestringido: false,
        motivoRestriccion: null,
        contadorNoPresentado: 0,
      };
    });
  }
}
