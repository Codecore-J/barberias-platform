import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  errorDeConflicto,
  errorDePermiso,
  errorDeSolicitud,
  reglaDeNegocio,
} from '../../shared/errors/d40.errors.js';
import { ROL_BARBERO } from '../../iam/domain/roles.js';
import { CrearSolicitudServicioDto } from './dto/solicitud-servicio.dto.js';

/**
 * T-27 / T-28 · el barbero pide, el ADMIN_BARBERIA de la sede resuelve.
 *
 * El flujo no borra nada: la solicitud cambia de estado y guarda quién la
 * resolvió y cuándo. Aprobar un `ALTA` publica el servicio en las dos tablas
 * del catálogo —`Servicio` para la sede y los combos, `ServicioBarbero` para el
 * barbero que lo pidió con su precio— dentro de la misma transacción: si una de
 * las dos escrituras falla, no queda media aprobación.
 */
@Injectable()
export class SolicitudesServicioService {
  private readonly logger = new Logger(SolicitudesServicioService.name);

  constructor(private readonly prisma: PrismaService) {}

  private static exigirSede(barberiaId: string | undefined | null): string {
    if (typeof barberiaId !== 'string' || barberiaId.trim() === '') {
      throw new BadRequestException(
        'No se indicó la barbería: es obligatorio acotar las solicitudes a una sede.',
      );
    }
    return barberiaId.trim();
  }

  private static normalizarNombre(nombre: string | undefined | null): string {
    const limpio = (nombre ?? '').trim().replace(/\s+/g, ' ');
    if (limpio === '') {
      throw new BadRequestException('El nombre del servicio es obligatorio.');
    }
    return limpio;
  }

  private static normalizarDescripcion(descripcion: string | undefined | null): string | null {
    if (descripcion === undefined || descripcion === null) return null;
    const limpia = descripcion.trim();
    return limpia === '' ? null : limpia;
  }

  private async exigirBarberoDeSede(barberiaId: string, barberoId: string): Promise<void> {
    const asignacion = await this.prisma.usuarioRol.findFirst({
      where: { usuarioId: barberoId, barberiaId, rol: { nombre: ROL_BARBERO } },
      select: { usuario: { select: { estadoCuenta: true } } },
    });

    if (!asignacion) {
      throw errorDePermiso(
        'BARBERO_NO_PERTENECE_A_SEDE',
        'Tu cuenta no tiene el rol BARBERO en esta sede: solo un barbero de la sede puede pedir servicios aquí.',
      );
    }

    if (asignacion.usuario?.estadoCuenta && asignacion.usuario.estadoCuenta !== 'ACTIVO') {
      throw reglaDeNegocio(
        'BARBERO_INACTIVO',
        'Tu cuenta no está activa: no puedes enviar solicitudes en esta sede.',
      );
    }
  }

  /** La categoría del alta tiene que existir en el catálogo GLOBAL y estar activa. */
  private async exigirCategoriaGlobal(categoriaId: string | undefined) {
    if (!categoriaId) {
      throw errorDeSolicitud(
        'CATEGORIA_REQUERIDA',
        'Elige una categoría global para pedir el servicio.',
      );
    }

    const categoria = await this.prisma.categoriaServicio.findFirst({
      where: { id: categoriaId, barberiaId: null },
      select: { id: true, nombre: true, activa: true },
    });

    if (!categoria) {
      throw reglaDeNegocio(
        'CATEGORIA_INVALIDA',
        'La categoría indicada no existe en el catálogo global: elige una categoría válida.',
        { categoriaId },
      );
    }

    if (!categoria.activa) {
      throw reglaDeNegocio(
        'CATEGORIA_INACTIVA',
        `La categoría «${categoria.nombre}» está desactivada: pide al administrador que la reactive.`,
        { categoriaId: categoria.id },
      );
    }

    return categoria;
  }

  private async exigirSinPendiente(where: Record<string, unknown>): Promise<void> {
    const pendiente = await this.prisma.solicitudServicioBarbero.findFirst({
      where: { ...where, estado: 'PENDIENTE' },
      select: { id: true },
    });

    if (pendiente) {
      throw errorDeConflicto(
        'SOLICITUD_PENDIENTE',
        'Ya tienes una solicitud pendiente igual: espera a que la sede la resuelva.',
        { solicitudId: pendiente.id },
      );
    }
  }

  async crear(barberiaId: string, barberoId: string, dto: CrearSolicitudServicioDto) {
    const sede = SolicitudesServicioService.exigirSede(barberiaId);
    await this.exigirBarberoDeSede(sede, barberoId);

    if (dto.tipo === 'DESACTIVACION') {
      if (!dto.servicioId) {
        throw errorDeSolicitud(
          'SERVICIO_REQUERIDO',
          'Indica el servicio publicado que quieres retirar.',
        );
      }

      const propio = await this.prisma.servicioBarbero.findFirst({
        where: { id: dto.servicioId, barberoId, barberiaId: sede, activo: true },
        select: { id: true },
      });

      if (!propio) {
        throw new NotFoundException(
          'Servicio no encontrado entre los tuyos y activos en esta barbería.',
        );
      }

      await this.exigirSinPendiente({
        barberiaId: sede,
        barberoId,
        tipo: 'DESACTIVACION',
        servicioId: dto.servicioId,
      });

      const solicitud = await this.prisma.solicitudServicioBarbero.create({
        data: {
          barberiaId: sede,
          barberoId,
          tipo: 'DESACTIVACION',
          estado: 'PENDIENTE',
          servicioId: dto.servicioId,
        },
      });

      this.logger.log(`Solicitud de desactivación creada: ${solicitud.id} (sede: ${sede})`);
      return solicitud;
    }

    const nombre = SolicitudesServicioService.normalizarNombre(dto.nombre);
    await this.exigirCategoriaGlobal(dto.categoriaId);

    if (dto.precio === undefined || dto.duracionMinutos === undefined) {
      throw errorDeSolicitud(
        'DATOS_SERVICIO_REQUERIDOS',
        'El alta del servicio necesita precio y duración.',
      );
    }

    await this.exigirSinPendiente({
      barberiaId: sede,
      barberoId,
      tipo: 'ALTA',
      categoriaId: dto.categoriaId,
      nombrePersonalizado: { equals: nombre, mode: 'insensitive' },
    });

    const solicitud = await this.prisma.solicitudServicioBarbero.create({
      data: {
        barberiaId: sede,
        barberoId,
        tipo: 'ALTA',
        estado: 'PENDIENTE',
        categoriaId: dto.categoriaId,
        nombrePersonalizado: nombre,
        descripcion: SolicitudesServicioService.normalizarDescripcion(dto.descripcion),
        precio: dto.precio,
        duracionMinutos: dto.duracionMinutos,
      },
    });

    this.logger.log(`Solicitud de alta creada: ${solicitud.id} (sede: ${sede})`);
    return solicitud;
  }

  /** Bandeja de la sede: por defecto solo lo que le toca resolver. */
  async listar(barberiaId: string, estado?: string) {
    const sede = SolicitudesServicioService.exigirSede(barberiaId);

    return this.prisma.solicitudServicioBarbero.findMany({
      where: { barberiaId: sede, estado: estado?.trim() || 'PENDIENTE' },
      orderBy: { creadoAt: 'asc' },
      include: {
        barbero: { select: { id: true, nombreCompleto: true } },
        categoria: { select: { id: true, nombre: true } },
      },
    });
  }
}
