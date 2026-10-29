import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { errorDeConflicto, errorDePermiso, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { ROL_BARBERO } from '../../iam/domain/roles.js';
import { CreateServicioBarberoDto } from './dto/create-servicio-barbero.dto.js';
import { UpdateServicioBarberoDto } from './dto/update-servicio-barbero.dto.js';

/**
 * V3 · Catálogo híbrido: servicios propios del barbero dentro de las categorías
 * de la sede.
 *
 * Reglas del modelo:
 *  - La categoría es de la SEDE y la crea su ADMIN_BARBERIA (`CategoriasService`).
 *  - El nombre, el precio y la duración son LIBRES y del BARBERO; por eso el
 *    `barberoId` sale del JWT y nunca del cuerpo.
 *  - La pertenencia del barbero a la sede se comprueba contra `usuario_roles`
 *    (rol BARBERO). `VinculoBarberiaGuard` acepta cualquier vínculo —incluso el
 *    de un ADMIN_BARBERIA o un CLIENTE—, así que sin esta comprobación un usuario
 *    con rol en la sede pero sin rol de barbero publicaría servicios.
 *  - Nada se borra: `activo: false` retira el servicio del catálogo (§9).
 */
@Injectable()
export class ServiciosBarberoService {
  private readonly logger = new Logger(ServiciosBarberoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Sin sede no hay consulta: un `where` sin la sede es una fuga de tenant. */
  private static exigirSede(barberiaId: string | undefined | null): string {
    if (typeof barberiaId !== 'string' || barberiaId.trim() === '') {
      throw new BadRequestException(
        'No se indicó la barbería: es obligatorio acotar los servicios a una sede.',
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

  /** La categoría tiene que existir en ESA sede y estar activa. */
  private async exigirCategoriaDeSede(barberiaId: string, categoriaId: string) {
    const categoria = await this.prisma.categoriaServicio.findFirst({
      where: { id: categoriaId, barberiaId },
      select: { id: true, nombre: true, activa: true },
    });

    if (!categoria) {
      throw new NotFoundException(
        'La categoría indicada no existe en esta barbería.',
      );
    }

    if (!categoria.activa) {
      throw reglaDeNegocio(
        'CATEGORIA_INACTIVA',
        `La categoría «${categoria.nombre}» está desactivada: pide al administrador de la sede que la reactive antes de publicar servicios en ella.`,
        { categoriaId: categoria.id },
      );
    }

    return categoria;
  }

  /**
   * El `barberoId` del JWT tiene que ser BARBERO de ESA sede y tener la cuenta
   * activa. La segunda parte importa: una cuenta suspendida no debe seguir
   * publicando servicios aunque conserve el vínculo.
   */
  private async exigirBarberoDeSede(barberiaId: string, barberoId: string): Promise<void> {
    const asignacion = await this.prisma.usuarioRol.findFirst({
      where: {
        usuarioId: barberoId,
        barberiaId,
        rol: { nombre: ROL_BARBERO },
      },
      select: { usuario: { select: { estadoCuenta: true } } },
    });

    if (!asignacion) {
      throw errorDePermiso(
        'BARBERO_NO_PERTENECE_A_SEDE',
        'Tu cuenta no tiene el rol BARBERO en esta sede: solo un barbero de la sede puede publicar servicios aquí.',
      );
    }

    if (asignacion.usuario?.estadoCuenta && asignacion.usuario.estadoCuenta !== 'ACTIVO') {
      throw reglaDeNegocio(
        'BARBERO_INACTIVO',
        'Tu cuenta no está activa: no puedes publicar ni editar servicios en esta sede.',
      );
    }
  }

  private async exigirNombreLibre(
    barberoId: string,
    categoriaId: string,
    nombre: string,
    excluirId?: string,
  ): Promise<void> {
    const existente = await this.prisma.servicioBarbero.findFirst({
      where: {
        barberoId,
        categoriaId,
        nombrePersonalizado: { equals: nombre, mode: 'insensitive' },
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
      select: { id: true, nombrePersonalizado: true, activo: true },
    });

    if (!existente) {
      return;
    }

    throw errorDeConflicto(
      'SERVICIO_BARBERO_DUPLICADO',
      existente.activo
        ? `Ya tienes un servicio llamado «${existente.nombrePersonalizado}» en esa categoría.`
        : `Ya tuviste un servicio llamado «${existente.nombrePersonalizado}» en esa categoría: reactívalo en lugar de crear otro.`,
      { servicioId: existente.id },
    );
  }

  async crear(barberiaId: string, barberoId: string, dto: CreateServicioBarberoDto) {
    const sede = ServiciosBarberoService.exigirSede(barberiaId);
    const nombre = ServiciosBarberoService.normalizarNombre(dto.nombre);

    await this.exigirBarberoDeSede(sede, barberoId);
    await this.exigirCategoriaDeSede(sede, dto.categoriaId);
    await this.exigirNombreLibre(barberoId, dto.categoriaId, nombre);

    const servicio = await this.prisma.servicioBarbero.create({
      data: {
        barberoId,
        categoriaId: dto.categoriaId,
        nombrePersonalizado: nombre,
        precio: dto.precio,
        duracionMinutos: dto.duracionMinutos,
      },
      include: { categoria: { select: { id: true, nombre: true } } },
    });

    this.logger.log(
      `Servicio de barbero creado: ${servicio.id} (barbero: ${barberoId}, sede: ${sede})`,
    );
    return servicio;
  }

  /**
   * Los servicios del barbero que inicia sesión en esa sede. Devuelve también los
   * inactivos: es su propio panel y necesita verlos para reactivarlos.
   */
  async listarMios(barberiaId: string, barberoId: string) {
    const sede = ServiciosBarberoService.exigirSede(barberiaId);

    return this.prisma.servicioBarbero.findMany({
      where: { barberoId, categoria: { barberiaId: sede } },
      orderBy: [{ activo: 'desc' }, { nombrePersonalizado: 'asc' }],
      include: { categoria: { select: { id: true, nombre: true, activa: true } } },
    });
  }

  /**
   * Edita un servicio PROPIO. Un servicio de otro barbero responde 404 y no 403:
   * el panel no debe confirmar que existe un recurso ajeno.
   */
  async actualizar(
    barberiaId: string,
    barberoId: string,
    id: string,
    dto: UpdateServicioBarberoDto,
  ) {
    const sede = ServiciosBarberoService.exigirSede(barberiaId);

    const actual = await this.prisma.servicioBarbero.findFirst({
      where: { id, barberoId, categoria: { barberiaId: sede } },
      select: {
        id: true,
        categoriaId: true,
        nombrePersonalizado: true,
        precio: true,
        duracionMinutos: true,
        activo: true,
      },
    });

    if (!actual) {
      throw new NotFoundException(
        'Servicio no encontrado entre los tuyos en esta barbería.',
      );
    }

    const datos: {
      categoriaId?: string;
      nombrePersonalizado?: string;
      precio?: number;
      duracionMinutos?: number;
      activo?: boolean;
    } = {};

    const categoriaDestino = dto.categoriaId ?? actual.categoriaId;

    if (dto.categoriaId !== undefined && dto.categoriaId !== actual.categoriaId) {
      await this.exigirCategoriaDeSede(sede, dto.categoriaId);
      datos.categoriaId = dto.categoriaId;
    }

    if (dto.nombre !== undefined) {
      const nombre = ServiciosBarberoService.normalizarNombre(dto.nombre);
      if (nombre !== actual.nombrePersonalizado) {
        await this.exigirNombreLibre(barberoId, categoriaDestino, nombre, actual.id);
        datos.nombrePersonalizado = nombre;
      }
    } else if (datos.categoriaId) {
      // Cambiar de categoría sin cambiar de nombre también tiene que respetar la
      // unicidad (barbero + categoría + nombre).
      await this.exigirNombreLibre(barberoId, categoriaDestino, actual.nombrePersonalizado, actual.id);
    }

    if (dto.precio !== undefined) {
      datos.precio = dto.precio;
    }

    if (dto.duracionMinutos !== undefined) {
      datos.duracionMinutos = dto.duracionMinutos;
    }

    if (dto.activo !== undefined) {
      datos.activo = dto.activo;
    }

    if (Object.keys(datos).length === 0) {
      return actual;
    }

    const actualizado = await this.prisma.servicioBarbero.update({
      where: { id: actual.id },
      data: datos,
      include: { categoria: { select: { id: true, nombre: true, activa: true } } },
    });

    this.logger.log(`Servicio de barbero actualizado: ${id} (sede: ${sede})`);
    return actualizado;
  }

  /**
   * Catálogo que consume el frontend del cliente: un array de CATEGORÍAS y,
   * dentro de cada una, los servicios activos con el barbero que los realiza.
   *
   * Las categorías sin servicios activos se omiten: el cliente no debe ver una
   * sección vacía. Las categorías inactivas tampoco se devuelven, y con ellas
   * caen todos sus servicios (aunque estén `activo = true`): desactivar la
   * categoría es la forma de retirar la sección entera del catálogo.
   */
  async catalogoAnidado(barberiaId: string) {
    const sede = ServiciosBarberoService.exigirSede(barberiaId);

    const categorias = await this.prisma.categoriaServicio.findMany({
      where: { barberiaId: sede, activa: true },
      orderBy: { nombre: 'asc' },
      include: {
        servicios: {
          where: { activo: true },
          orderBy: { nombrePersonalizado: 'asc' },
          include: { barbero: { select: { id: true, nombreCompleto: true } } },
        },
      },
    });

    return categorias
      .filter((categoria) => categoria.servicios.length > 0)
      .map((categoria) => ({
        id: categoria.id,
        nombre: categoria.nombre,
        descripcion: categoria.descripcion,
        servicios: categoria.servicios.map((servicio) => ({
          id: servicio.id,
          nombre: servicio.nombrePersonalizado,
          precio: servicio.precio,
          duracionMinutos: servicio.duracionMinutos,
          barbero: {
            id: servicio.barbero.id,
            nombre: servicio.barbero.nombreCompleto,
          },
        })),
      }));
  }
}
