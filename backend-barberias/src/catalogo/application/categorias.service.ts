import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { errorDeConflicto } from '../../shared/errors/d40.errors.js';
import { CreateCategoriaServicioDto } from './dto/create-categoria-servicio.dto.js';
import { UpdateCategoriaServicioDto } from './dto/update-categoria-servicio.dto.js';

/**
 * V3 · Categorías de servicio de una sede.
 *
 * El modelo de negocio es «categorización estricta con nomenclatura libre»: el
 * ADMIN_BARBERIA define las categorías de SU sede y los barberos publican dentro
 * de ellas (`ServiciosBarberoService`). La categoría nunca se borra (§9): se
 * desactiva con `activa = false` y deja de ofrecerse al cliente.
 *
 * Todas las consultas van acotadas por `barberiaId`. Sin ese filtro, el `where`
 * de Prisma ignora el campo y devuelve las categorías de TODAS las sedes —el
 * mismo fallo que E1-06 cerró en el catálogo—, así que la sede se exige aquí y no
 * se confía en que la ruta la traiga.
 */
@Injectable()
export class CategoriasService {
  private readonly logger = new Logger(CategoriasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Sin sede no hay consulta: un `where` sin `barberiaId` es una fuga. */
  private static exigirSede(barberiaId: string | undefined | null): string {
    if (typeof barberiaId !== 'string' || barberiaId.trim() === '') {
      throw new BadRequestException(
        'No se indicó la barbería: es obligatorio acotar las categorías a una sede.',
      );
    }
    return barberiaId.trim();
  }

  /**
   * Normaliza el nombre y comprueba que la sede no tenga ya uno igual. La
   * comparación es insensible a mayúsculas y espacios repetidos: «Corte» y
   * «corte » son la misma categoría para el cliente que la elige y para el
   * barbero que publica en ella.
   */
  private static normalizarNombre(nombre: string | undefined | null): string {
    const limpio = (nombre ?? '').trim().replace(/\s+/g, ' ');
    if (limpio === '') {
      throw new BadRequestException('El nombre de la categoría es obligatorio.');
    }
    return limpio;
  }

  private async exigirNombreLibre(
    barberiaId: string,
    nombre: string,
    excluirId?: string,
  ): Promise<void> {
    const existente = await this.prisma.categoriaServicio.findFirst({
      where: {
        barberiaId,
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
      select: { id: true, nombre: true, activa: true },
    });

    if (!existente) {
      return;
    }

    throw errorDeConflicto(
      'CATEGORIA_DUPLICADA',
      existente.activa
        ? `La sede ya tiene una categoría llamada «${existente.nombre}».`
        : `La sede ya tuvo una categoría llamada «${existente.nombre}»: reactívala en lugar de crear otra.`,
      { categoriaId: existente.id },
    );
  }

  async crear(barberiaId: string, dto: CreateCategoriaServicioDto) {
    const sede = CategoriasService.exigirSede(barberiaId);
    const nombre = CategoriasService.normalizarNombre(dto.nombre);

    await this.exigirNombreLibre(sede, nombre);

    const categoria = await this.prisma.categoriaServicio.create({
      data: {
        barberiaId: sede,
        nombre,
        descripcion: dto.descripcion?.trim() || null,
      },
    });

    this.logger.log(`Categoría creada: ${categoria.id} para barberia: ${sede}`);
    return categoria;
  }

  /**
   * Listado para el personal de la sede: incluye las inactivas (para poder
   * reactivarlas, igual que el catálogo de E2-07) y el número de servicios
   * activos de cada una, que es lo que la pantalla muestra.
   */
  async listar(barberiaId: string) {
    const sede = CategoriasService.exigirSede(barberiaId);

    const categorias = await this.prisma.categoriaServicio.findMany({
      where: { barberiaId: sede },
      orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
      include: {
        servicios: { where: { activo: true }, select: { id: true } },
      },
    });

    return categorias.map(({ servicios, ...categoria }) => ({
      ...categoria,
      serviciosActivos: servicios.length,
    }));
  }

  async obtener(barberiaId: string, id: string) {
    const sede = CategoriasService.exigirSede(barberiaId);

    const categoria = await this.prisma.categoriaServicio.findFirst({
      where: { id, barberiaId: sede },
      include: { servicios: { where: { activo: true }, select: { id: true } } },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoría con ID ${id} no encontrada en esta barbería`);
    }

    const { servicios, ...resto } = categoria;
    return { ...resto, serviciosActivos: servicios.length };
  }

  async actualizar(barberiaId: string, id: string, dto: UpdateCategoriaServicioDto) {
    const actual = await this.obtener(barberiaId, id);
    const sede = CategoriasService.exigirSede(barberiaId);

    const datos: { nombre?: string; descripcion?: string | null; activa?: boolean } = {};

    if (dto.nombre !== undefined) {
      const nombre = CategoriasService.normalizarNombre(dto.nombre);
      if (nombre !== actual.nombre) {
        await this.exigirNombreLibre(sede, nombre, actual.id);
        datos.nombre = nombre;
      }
    }

    if (dto.descripcion !== undefined) {
      datos.descripcion = dto.descripcion.trim() || null;
    }

    if (dto.activa !== undefined) {
      datos.activa = dto.activa;
    }

    if (Object.keys(datos).length === 0) {
      return actual;
    }

    const actualizada = await this.prisma.categoriaServicio.update({
      where: { id: actual.id },
      data: datos,
    });

    this.logger.log(`Categoría actualizada: ${id} (barberia: ${sede})`);
    return actualizada;
  }
}
