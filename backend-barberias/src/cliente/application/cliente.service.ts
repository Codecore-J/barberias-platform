import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  ROL_ADMINISTRADOR,
  ROL_ADMIN_BARBERIA,
  ROL_BARBERO,
  alcanceCumple,
} from '../../iam/domain/roles.js';

/**
 * MAPA-1 · L5: la ficha y las notas de un cliente tienen ALCANCE DE ROL.
 *
 * D16 define al BARBERO como «vista limitada»: no puede leer el nombre, el
 * teléfono ni las notas de alguien que no ha pasado por su agenda. Ocultar la
 * columna en el navegador no limitaba nada, porque `GET .../clients/:id/profile`
 * y `POST .../notes` respondían a cualquier barbero de la sede. El recorte vive
 * aquí —y no en el controlador— para que valga igual para la pantalla, para la
 * app móvil o para una petición directa a la API.
 */
@Injectable()
export class ClienteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Traduce los roles del token al alcance que tiene en ESTA sede.
   *
   * `sede`: `ADMIN_BARBERIA` (o el `ADMINISTRADOR` global) atiende el catálogo
   * completo. `barbero`: solo sus clientes. Cualquier otra cosa —un rol de otra
   * sede o un token sin roles detallados— no alcanza la ficha: fail-closed.
   */
  private alcanceEnSede(
    barberiaId: string,
    user?: UsuarioAutenticado | null,
  ): 'sede' | 'barbero' {
    const roles = (user?.rolesDetallados ?? []).filter((rol) =>
      alcanceCumple(rol, barberiaId),
    );

    if (roles.some((rol) => rol.nombre === ROL_ADMIN_BARBERIA || rol.nombre === ROL_ADMINISTRADOR)) {
      return 'sede';
    }

    if (roles.some((rol) => rol.nombre === ROL_BARBERO)) {
      return 'barbero';
    }

    throw new ForbiddenException('No tienes acceso a los clientes de esta barbería.');
  }

  async obtenerFicha(clienteId: string, barberiaId: string, user: UsuarioAutenticado) {
    const alcance = this.alcanceEnSede(barberiaId, user);
    const soloBarbero = alcance === 'barbero';

    // La relación se comprueba ANTES de leer el usuario: un 403 no debe servir
    // para averiguar si el id existe. Para el barbero, la consulta de reservas
    // ya trae el filtro y sirve a la vez de comprobación y de totales.
    const reservas = await this.prisma.reserva.findMany({
      where: {
        clienteId,
        barberiaId,
        ...(soloBarbero ? { barberoId: user.id } : {}),
      },
    });

    if (soloBarbero && reservas.length === 0) {
      throw new ForbiddenException(
        'Solo puedes ver la ficha de los clientes que han pasado por tu agenda.',
      );
    }

    const cliente = await this.prisma.usuario.findUnique({
      where: { id: clienteId },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const totalCitas = reservas.filter((r) => r.estado === 'COMPLETADA').length;
    const totalCanceladas = reservas.filter(
      (r) => r.estado === 'NO_ASISTIO' || r.estado === 'CANCELADA_TARDE',
    ).length;

    const antecedentes = await this.prisma.antecedente.findMany({
      where: { usuarioId: clienteId, barberiaOrigenId: barberiaId },
      orderBy: { creadoAt: 'desc' },
    });

    return {
      id: cliente.id,
      nombre: cliente.nombreCompleto,
      telefono: cliente.telefono,
      totalCitas,
      totalCanceladas,
      notas: antecedentes.map((a) => ({
        id: a.id,
        contenido: a.contenido,
        fechaCreacion: a.creadoAt?.toISOString() || new Date().toISOString(),
      })),
    };
  }

  async guardarNota(
    clienteId: string,
    barberiaId: string,
    user: UsuarioAutenticado,
    contenido: string,
  ) {
    const alcance = this.alcanceEnSede(barberiaId, user);

    if (alcance === 'barbero') {
      const relacion = await this.prisma.reserva.findFirst({
        where: { clienteId, barberiaId, barberoId: user.id },
        select: { id: true },
      });

      if (!relacion) {
        throw new ForbiddenException(
          'Solo puedes anotar sobre los clientes que han pasado por tu agenda.',
        );
      }
    }

    // Fase 5: una nota ya no nace APROBADA. Entra como solicitud PENDIENTE y
    // la plataforma la resuelve por el mismo flujo que el resto de antecedentes.
    const solicitud = await this.prisma.solicitudAntecedente.create({
      data: {
        barberiaId,
        solicitanteId: user.id,
        clienteId,
        motivo: contenido,
        estado: 'PENDIENTE',
      },
    });

    return {
      id: solicitud.id,
      contenido: solicitud.motivo,
      fechaCreacion: solicitud.creadoAt?.toISOString() || new Date().toISOString(),
      estado: solicitud.estado,
    };
  }
}
