import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ESTADOS } from '../../shared/domain/estados.js';
import {
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';
import { errorDeConflicto, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { CreateServicioDto } from './dto/create-servicio.dto.js';
import { UpdateServicioDto } from './dto/update-servicio.dto.js';
import { esAdministradorGlobal } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Injectable()
export class ServiciosService {
  private readonly logger = new Logger(ServiciosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Sin sede no hay consulta: un `where` sin `barberiaId` es una fuga. */
  private static exigirSede(barberiaId: string | undefined | null): string {
    if (typeof barberiaId !== 'string' || barberiaId.trim() === '') {
      throw new BadRequestException(
        'No se indicó la barbería: es obligatorio acotar el catálogo a una sede.',
      );
    }
    return barberiaId.trim();
  }

  async create(barberiaId: string, dto: CreateServicioDto) {
    const duracion = dto.duracionEstimada ?? dto.duracionMinutos ?? 30;
    const servicio = await this.prisma.servicio.create({
      data: {
        barberiaId,
        nombre: dto.nombre,
        precio: dto.precio,
        duracionEstimada: duracion,
        margenOperativo: dto.margenOperativo ?? 0,
        destacado: dto.destacado ?? false,
        estado: 'ACTIVO',
      },
    });
    this.logger.log(`Servicio creado: ${servicio.id} para barberia: ${barberiaId}`);
    return servicio;
  }

  /**
   * E1-06: la sede es obligatoria y el filtro va SIEMPRE en el `where`.
   *
   * Antes el filtro se caía a propósito cuando no llegaba sede, y Prisma, al
   * ignorar los campos `undefined`, devolvía el catálogo de TODAS las barberías
   * desde una ruta con `@Roles`. Ahora la ausencia es un 400 en el servicio y el
   * `where` lleva siempre `barberiaId`.
   */
  async findAll(barberiaId: string, usuario?: UsuarioAutenticado) {
    const sede = ServiciosService.exigirSede(barberiaId);
    const esAdmin =
      esAdministradorGlobal(usuario) ||
      usuario?.rolesDetallados?.some(
        (rol) =>
          rol.barberiaId === sede &&
          (rol.nombre === 'ADMIN_BARBERIA' || rol.nombre === 'ADMINISTRADOR'),
      );
    return this.prisma.servicio.findMany({
      where: {
        barberiaId: sede,
        ...(esAdmin ? {} : { estado: 'ACTIVO' }),
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(barberiaId: string, id: string) {
    const sede = ServiciosService.exigirSede(barberiaId);
    const servicio = await this.prisma.servicio.findFirst({
      where: { id, barberiaId: sede },
    });
    if (!servicio) {
      throw new NotFoundException(`Servicio con ID ${id} no encontrado en esta barbería`);
    }
    return servicio;
  }

  async update(barberiaId: string, id: string, dto: UpdateServicioDto) {
    const servicio = await this.findOne(barberiaId, id);

    return this.prisma.servicio.update({
      where: { id: servicio.id },
      data: dto,
    });
  }

  /**
   * E2-07 · D29: desactivar es un CAMBIO DE ESTADO, no un borrado. El verbo de
   * la ruta lo dice —`PATCH :id/desactivar`— y las tres reglas del backlog
   * deciden cuándo se puede:
   *
   *  1. Se BLOQUEA (422 `SERVICIO_EN_USO`) si hay reservas `PENDIENTE` o
   *     `PROPUESTA_PENDIENTE` que usan el servicio: todavía pueden confirmarse y
   *     su hueco se calculó con este catálogo.
   *  2. Se BLOQUEA (422 `SERVICIO_EN_COMBO_ACTIVO`) si el servicio está dentro de
   *     un combo ACTIVO; el mensaje trae la lista para que la sede resuelva el
   *     combo primero (lo que se vende es el combo).
   *  3. Se PERMITE si solo hay reservas CONFIRMADAS o terminales: cuentan con un
   *     snapshot inmutable en `participante_servicios` (`precio_historico`,
   *     `duracion_historica`, `margen_historico`), así que su precio y su
   *     duración no dependen del catálogo.
   *
   * Idempotente: sobre un servicio ya INACTIVO no escribe ni falla.
   */
  async desactivar(barberiaId: string, id: string) {
    const servicio = await this.findOne(barberiaId, id);

    if (servicio.estado === 'INACTIVO') {
      return servicio;
    }

    await this.exigirSinReservasAbiertas(barberiaId, id);
    await this.exigirSinCombosActivos(barberiaId, id);

    const desactivado = await this.prisma.servicio.update({
      where: { id: servicio.id },
      data: { estado: 'INACTIVO' },
    });

    this.logger.log(`Servicio desactivado: ${id}`);
    return desactivado;
  }

  /**
   * E2-07: volver a ACTIVO no tiene reglas propias —el servicio solo vuelve a
   * ofrecerse— pero sí exige existir en esa sede y es idempotente.
   */
  async reactivar(barberiaId: string, id: string) {
    const servicio = await this.findOne(barberiaId, id);

    if (servicio.estado === 'ACTIVO') {
      return servicio;
    }

    const reactivado = await this.prisma.servicio.update({
      where: { id: servicio.id },
      data: { estado: 'ACTIVO' },
    });

    this.logger.log(`Servicio reactivado: ${id}`);
    return reactivado;
  }

  /**
   * Regla 1: una reserva `PENDIENTE` o `PROPUESTA_PENDIENTE` todavía
   * puede confirmarse, así que el catálogo no puede cambiar bajo sus pies.
   */
  private async exigirSinReservasAbiertas(barberiaId: string, servicioId: string): Promise<void> {
    const pendientes = await this.prisma.reserva.findMany({
      where: {
        barberiaId,
        // Los dos estados «abiertos» desde el catálogo, nunca literales.
        estado: { in: [ESTADOS.PENDIENTE, ESTADOS.PROPUESTA_PENDIENTE] },
        participantes: {
          some: {
            participanteServicios: {
              some: {
                servicioId,
              },
            },
          },
        },
      },
      select: {
        id: true,
        fechaCita: true,
        horaInicio: true,
      },
    });

    if (pendientes.length === 0) {
      return;
    }

    // Etiquetas DATE/TIME por partes UTC, sin `toISOString()` sobre
    // fechas de cita.
    const citasDesc = pendientes
      .map((r) => `${fechaCalendarioISO(r.fechaCita)} a las ${horaRelojHHMM(r.horaInicio)}`)
      .join(', ');

    throw errorDeConflicto(
      'SERVICIO_EN_USO',
      `No se puede desactivar el servicio porque tiene ${pendientes.length} solicitud(es) de reserva por confirmar: ${citasDesc}`,
    );
  }

  /**
   * Regla 2: un combo ACTIVO se vende con sus servicios dentro, así que
   * desactivar uno lo dejaría incoherente. El mensaje trae los combos por nombre
   * y id para que la sede los apague o los edite antes.
   */
  private async exigirSinCombosActivos(barberiaId: string, servicioId: string): Promise<void> {
    const combos = await this.prisma.combo.findMany({
      where: {
        barberiaId,
        estado: 'ACTIVO',
        comboItemsAsParent: { some: { servicioId } },
      },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });

    if (combos.length === 0) {
      return;
    }

    throw errorDeConflicto(
      'SERVICIO_EN_COMBO_ACTIVO',
      `El servicio pertenece a ${combos.length} combo(s) activo(s): ${combos.map((c) => c.nombre).join(', ')}. Desactiva o edita el combo antes de desactivar el servicio.`,
    );
  }
}
