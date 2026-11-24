import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  errorDeConflicto,
  errorDePermiso,
  errorDeSolicitud,
  reglaDeNegocio,
} from '../../shared/errors/d40.errors.js';
import {
  CloudinaryService,
  TAMANO_MAXIMO_IMAGEN,
  TIPOS_IMAGEN_PERMITIDOS,
  type ArchivoSubido,
} from '../../shared/cloudinary/cloudinary.service.js';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

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

  /** T-23 · opcional: se recorta y el vacío se guarda como NULL, no como "". */
  private static normalizarDescripcion(
    descripcion: string | undefined | null,
  ): string | null {
    if (descripcion === undefined || descripcion === null) {
      return null;
    }
    const limpia = descripcion.trim();
    return limpia === '' ? null : limpia;
  }

  /**
   * T-20 · la categoría tiene que existir en el catálogo GLOBAL y estar activa.
   * Antes se buscaba con `barberiaId` porque cada sede tenía sus copias; ahora
   * `barberia_id` es NULL para todas las categorías vivas.
   *
   * T-23 · si la categoría no existe o quedó como fila heredada de una sede
   * (`barberia_id` no NULL), la respuesta es 422 `CATEGORIA_INVALIDA` y no 404:
   * la petición es válida, lo que impide publicar es el estado del catálogo.
   */
  private async exigirCategoriaGlobal(categoriaId: string) {
    const categoria = await this.prisma.categoriaServicio.findFirst({
      where: { id: categoriaId, barberiaId: null },
      select: { id: true, nombre: true, activa: true },
    });

    if (!categoria) {
      // Segunda búsqueda solo para distinguir el mensaje: un id que no existe
      // en ninguna tabla no es lo mismo que una fila antigua atada a una sede.
      const heredada = await this.prisma.categoriaServicio.findFirst({
        where: { id: categoriaId, barberiaId: { not: null } },
        select: { id: true },
      });

      throw reglaDeNegocio(
        'CATEGORIA_INVALIDA',
        heredada
          ? 'La categoría indicada pertenece a una sede y no al catálogo global: elige una categoría global para publicar el servicio.'
          : 'La categoría indicada no existe en el catálogo global: elige una categoría válida para publicar el servicio.',
        { categoriaId },
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
    await this.exigirCategoriaGlobal(dto.categoriaId);
    await this.exigirNombreLibre(barberoId, dto.categoriaId, nombre);

    const servicio = await this.prisma.servicioBarbero.create({
      data: {
        barberoId,
        barberiaId: sede,
        categoriaId: dto.categoriaId,
        nombrePersonalizado: nombre,
        descripcion: ServiciosBarberoService.normalizarDescripcion(dto.descripcion),
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
      where: { barberoId, barberiaId: sede },
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
      where: { id, barberoId, barberiaId: sede },
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
      descripcion?: string | null;
      precio?: number;
      duracionMinutos?: number;
      activo?: boolean;
    } = {};

    const categoriaDestino = dto.categoriaId ?? actual.categoriaId;

    if (dto.categoriaId !== undefined && dto.categoriaId !== actual.categoriaId) {
      await this.exigirCategoriaGlobal(dto.categoriaId);
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

    if (dto.descripcion !== undefined) {
      datos.descripcion = ServiciosBarberoService.normalizarDescripcion(dto.descripcion);
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
   * T-24 · imagen del servicio propio.
   *
   * El archivo no toca el disco ni la base: se valida (tipo y 2 MB), se borra
   * la imagen anterior en Cloudinary —el usuario pidió reemplazar, no acumular—
   * y se sube la nueva. Solo la URL queda en `servicios_barbero.imagen_url`.
   *
   * Sin `CLOUDINARY_URL` responde 503 con un mensaje que dice qué falta: una
   * subida «silenciosa» que no guarda nada es peor que un error explícito.
   */
  async actualizarImagen(
    barberiaId: string,
    barberoId: string,
    id: string,
    archivo: ArchivoSubido | undefined,
  ) {
    const sede = ServiciosBarberoService.exigirSede(barberiaId);

    if (!archivo?.buffer || archivo.buffer.length === 0) {
      throw errorDeSolicitud(
        'IMAGEN_REQUERIDA',
        'Adjunta la imagen del servicio en el campo «archivo».',
      );
    }

    if (!TIPOS_IMAGEN_PERMITIDOS.includes(archivo.mimetype as (typeof TIPOS_IMAGEN_PERMITIDOS)[number])) {
      throw errorDeSolicitud(
        'IMAGEN_TIPO_INVALIDO',
        'La imagen debe ser JPG, PNG o WEBP.',
      );
    }

    const tamano = archivo.size || archivo.buffer.length;
    if (tamano > TAMANO_MAXIMO_IMAGEN) {
      throw errorDeSolicitud('IMAGEN_DEMASIADO_GRANDE', 'La imagen no puede superar los 2 MB.');
    }

    const actual = await this.prisma.servicioBarbero.findFirst({
      where: { id, barberoId, barberiaId: sede },
      select: { id: true, imagenUrl: true },
    });

    if (!actual) {
      throw new NotFoundException('Servicio no encontrado entre los tuyos en esta barbería.');
    }

    if (!this.cloudinary.configurado()) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        codigo: 'IMAGEN_NO_CONFIGURADA',
        mensaje:
          'La subida de imágenes no está disponible: falta CLOUDINARY_URL en el entorno del servidor.',
      });
    }

    const publicIdAnterior = CloudinaryService.publicIdDe(actual.imagenUrl);
    if (publicIdAnterior) {
      await this.cloudinary.borrar(publicIdAnterior);
    }

    const subida = await this.cloudinary.subir(archivo.buffer, `servicios/${sede}`);

    const actualizado = await this.prisma.servicioBarbero.update({
      where: { id: actual.id },
      data: { imagenUrl: subida.url },
      select: { id: true, imagenUrl: true },
    });

    this.logger.log(`Imagen del servicio actualizada: ${id} (sede: ${sede})`);
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
      where: { barberiaId: null, activa: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      include: {
        servicios: {
          where: { activo: true, barberiaId: sede },
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
          descripcion: servicio.descripcion,
          imagenUrl: servicio.imagenUrl,
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
