import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { errorDeConflicto } from '../../shared/errors/d40.errors.js';
import { CreateCategoriaServicioDto } from './dto/create-categoria-servicio.dto.js';
import { UpdateCategoriaServicioDto } from './dto/update-categoria-servicio.dto.js';

/**
 * V3 · Categorías de servicio GLOBALES de la plataforma.
 *
 * T-20 (23 nov 2026): la taxonomía dejó de pertenecer a una sede. El
 * ADMINISTRADOR la define una vez (`barberia_id` NULL = global) y los barberos
 * publican dentro de ella con su propio nombre, precio y duración
 * (`ServiciosBarberoService`). Antes cada sede tenía su copia del mismo nombre y
 * renombrar «Corte» en una no cambiaba las demás.
 *
 * La sede del path ya NO acota la consulta: `exigirSede` sigue validando que la
 * ruta traiga una sede —es lo que autoriza `VinculoBarberiaGuard`—, pero el
 * `where` filtra por `barberiaId: null`. La categoría nunca se borra (§9): se
 * desactiva con `activa = false` y deja de ofrecerse al cliente.
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

  /**
   * T-20 · el nombre es único en el catálogo GLOBAL. La comparación no lleva
   * `barberiaId`: dos sedes ya no pueden tener cada una su «Corte».
   */
  private async exigirNombreLibre(
    nombre: string,
    excluirId?: string,
  ): Promise<void> {
    const existente = await this.prisma.categoriaServicio.findFirst({
      where: {
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
        ? `El catálogo ya tiene una categoría llamada «${existente.nombre}».`
        : `El catálogo ya tuvo una categoría llamada «${existente.nombre}»: reactívala en lugar de crear otra.`,
      { categoriaId: existente.id },
    );
  }

  async crear(barberiaId: string, dto: CreateCategoriaServicioDto) {
    // La sede solo valida el parámetro de la ruta; la fila nace global.
    CategoriasService.exigirSede(barberiaId);
    const nombre = CategoriasService.normalizarNombre(dto.nombre);

    await this.exigirNombreLibre(nombre);

    const categoria = await this.prisma.categoriaServicio.create({
      data: {
        barberiaId: null,
        nombre,
        descripcion: dto.descripcion?.trim() || null,
        orden: 0,
      },
    });

    this.logger.log(`Categoría global creada: ${categoria.id}`);
    return categoria;
  }

  /**
   * Listado para el personal de la sede: incluye las inactivas (para poder
   * reactivarlas, igual que el catálogo de E2-07) y el número de servicios
   * activos de cada una, que es lo que la pantalla muestra.
   */
  async listar(barberiaId: string) {
    CategoriasService.exigirSede(barberiaId);

    const categorias = await this.prisma.categoriaServicio.findMany({
      where: { barberiaId: null },
      orderBy: [{ activa: 'desc' }, { orden: 'asc' }, { nombre: 'asc' }],
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
    CategoriasService.exigirSede(barberiaId);

    const categoria = await this.prisma.categoriaServicio.findFirst({
      where: { id, barberiaId: null },
      include: { servicios: { where: { activo: true }, select: { id: true } } },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoría con ID ${id} no encontrada en el catálogo global`);
    }

    const { servicios, ...resto } = categoria;
    return { ...resto, serviciosActivos: servicios.length };
  }

  async actualizar(barberiaId: string, id: string, dto: UpdateCategoriaServicioDto) {
    const actual = await this.obtener(barberiaId, id);

    const datos: { nombre?: string; descripcion?: string | null; activa?: boolean } = {};

    if (dto.nombre !== undefined) {
      const nombre = CategoriasService.normalizarNombre(dto.nombre);
      if (nombre !== actual.nombre) {
        await this.exigirNombreLibre(nombre, actual.id);
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

    this.logger.log(`Categoría global actualizada: ${id}`);
    return actualizada;
  }

  /**
   * T-21 · borrado REAL de una categoría global, con una única condición: que no
   * la use ningún servicio de barbero.
   *
   * El camino normal sigue siendo desactivarla (`activa = false`), así que el
   * borrado es la excepción para una categoría creada por error. La cuenta NO
   * filtra por `activo`: un servicio desactivado sigue apuntando a la categoría y
   * borrarla lo dejaría huérfano. El 409 devuelve `servicios` para que el panel
   * pueda decir cuántos la bloquean.
   */
  async eliminar(barberiaId: string, id: string) {
    CategoriasService.exigirSede(barberiaId);

    const categoria = await this.prisma.categoriaServicio.findFirst({
      where: { id, barberiaId: null },
      select: { id: true, nombre: true },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoría con ID ${id} no encontrada en el catálogo global`);
    }

    const servicios = await this.prisma.servicioBarbero.count({
      where: { categoriaId: id },
    });

    if (servicios > 0) {
      throw errorDeConflicto(
        'CATEGORIA_CON_SERVICIOS',
        `No se puede eliminar la categoría «${categoria.nombre}» porque la usan ${servicios} servicio(s) de barbero. Desactívala en lugar de borrarla.`,
        { servicios },
      );
    }

    await this.prisma.categoriaServicio.delete({ where: { id } });

    this.logger.log(`Categoría global eliminada: ${id}`);
    return { id: categoria.id, nombre: categoria.nombre, eliminada: true };
  }
}
