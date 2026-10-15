import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CreateComboDto } from './dto/create-combo.dto.js';
import { UpdateComboDto } from './dto/update-combo.dto.js';
import { ComboCycleDetector } from '../domain/combo-cycle.detector.js';
import { esAdministradorGlobal } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Injectable()
export class CombosService {
  private readonly logger = new Logger(CombosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * E1-06: sin sede no se consulta. En Prisma `where: { barberiaId: undefined }`
   * no filtra, el motor descarta el campo y salen los combos de todas las sedes.
   */
  private static exigirSede(barberiaId: string | undefined | null): string {
    if (typeof barberiaId !== 'string' || barberiaId.trim() === '') {
      throw new BadRequestException(
        'No se indicó la barbería: es obligatorio acotar el catálogo a una sede.',
      );
    }
    return barberiaId.trim();
  }

  async create(barberiaId: string, dto: CreateComboDto) {
    if (dto.items && dto.items.length > 0) {
      await this.validateCycles(barberiaId, 'NEW_COMBO', dto.items.map(i => i.subComboId).filter(id => id !== undefined) as string[]);
    }

    const combo = await this.prisma.combo.create({
      data: {
        barberiaId,
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        precioEspecial: dto.precioEspecial,
        duracionPropia: dto.duracionPropia,
        margenPropio: dto.margenPropio ?? 0,
        destacado: dto.destacado ?? false,
        estado: 'ACTIVO',
        comboItemsAsParent: {
          create: dto.items?.map(item => ({
            servicioId: item.servicioId,
            subComboId: item.subComboId,
          })) || [],
        }
      },
      include: {
        comboItemsAsParent: true,
      }
    });

    this.logger.log(`Combo creado: ${combo.id} en barberia: ${barberiaId}`);
    return combo;
  }

  async findAll(barberiaId: string, usuario?: UsuarioAutenticado) {
    const sede = CombosService.exigirSede(barberiaId);
    const esAdmin =
      esAdministradorGlobal(usuario) ||
      usuario?.rolesDetallados?.some(
        (rol) =>
          rol.barberiaId === sede &&
          (rol.nombre === 'ADMIN_BARBERIA' || rol.nombre === 'ADMINISTRADOR'),
      );
    return this.prisma.combo.findMany({
      where: {
        barberiaId: sede,
        ...(esAdmin ? {} : { estado: 'ACTIVO' }),
      },
      include: { comboItemsAsParent: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(barberiaId: string, id: string) {
    const sede = CombosService.exigirSede(barberiaId);
    const combo = await this.prisma.combo.findFirst({
      where: { id, barberiaId: sede },
      include: { comboItemsAsParent: true },
    });
    if (!combo) {
      throw new NotFoundException(`Combo con ID ${id} no encontrado.`);
    }
    return combo;
  }

  async update(barberiaId: string, id: string, dto: UpdateComboDto) {
    const combo = await this.findOne(barberiaId, id);

    if (dto.items) {
      await this.validateCycles(barberiaId, id, dto.items.map(i => i.subComboId).filter(subId => subId !== undefined) as string[]);
    }

    return this.prisma.combo.update({
      where: { id: combo.id },
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        precioEspecial: dto.precioEspecial,
        duracionPropia: dto.duracionPropia,
        margenPropio: dto.margenPropio,
        destacado: dto.destacado,
        estado: dto.estado,
        ...(dto.items && {
          comboItemsAsParent: {
            deleteMany: {}, // Borrar items viejos
            create: dto.items.map(item => ({
              servicioId: item.servicioId,
              subComboId: item.subComboId,
            })),
          },
        }),
      },
      include: { comboItemsAsParent: true },
    });
  }

  /**
   * E2-07 · D29: el combo tampoco se borra, se desactiva.
   *
   * El backlog pone las reglas de bloqueo en el SERVICIO que está dentro del
   * combo (422 `SERVICIO_EN_COMBO_ACTIVO`): apagar el combo es justo la acción que
   * desbloquea esa regla, así que aquí no hay comprobaciones que hacer. Un combo
   * desactivado no se bloquea por las reservas abiertas que lo referencian: sus
   * participantes conservan el snapshot y la reserva sigue siendo válida.
   */
  async desactivar(barberiaId: string, id: string) {
    const combo = await this.findOne(barberiaId, id);
    if (combo.estado === 'INACTIVO') {
      return combo;
    }

    const desactivado = await this.prisma.combo.update({
      where: { id: combo.id },
      data: { estado: 'INACTIVO' },
    });

    this.logger.log(`Combo desactivado: ${id}`);
    return desactivado;
  }

  /** E2-07: la vuelta atrás explícita, idempotente. */
  async reactivar(barberiaId: string, id: string) {
    const combo = await this.findOne(barberiaId, id);
    if (combo.estado === 'ACTIVO') {
      return combo;
    }

    const reactivado = await this.prisma.combo.update({
      where: { id: combo.id },
      data: { estado: 'ACTIVO' },
    });

    this.logger.log(`Combo reactivado: ${id}`);
    return reactivado;
  }

  private async validateCycles(barberiaId: string, currentComboId: string, propuestosSubCombosIds: string[]) {
    const allCombos = await this.prisma.combo.findMany({
      where: { barberiaId },
      include: { comboItemsAsParent: true }
    });

    const adjList: Record<string, string[]> = {};
    for (const c of allCombos) {
      if (c.id === currentComboId) {
        adjList[c.id] = propuestosSubCombosIds;
      } else {
        adjList[c.id] = c.comboItemsAsParent
          .filter(i => i.subComboId != null)
          .map(i => i.subComboId!);
      }
    }

    if (!adjList[currentComboId]) {
      adjList[currentComboId] = propuestosSubCombosIds;
    }

    ComboCycleDetector.validateNoCycles(adjList);
  }
}
