import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CreateServicioDto } from './dto/create-servicio.dto.js';
import { UpdateServicioDto } from './dto/update-servicio.dto.js';

@Injectable()
export class ServiciosService {
  private readonly logger = new Logger(ServiciosService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(barberiaId: string, dto: CreateServicioDto) {
    const servicio = await this.prisma.servicio.create({
      data: {
        barberiaId,
        nombre: dto.nombre,
        precio: dto.precio,
        duracionEstimada: dto.duracionEstimada,
        margenOperativo: dto.margenOperativo ?? 0,
        destacado: dto.destacado ?? false,
        estado: 'ACTIVO',
      },
    });
    this.logger.log(`Servicio creado: ${servicio.id} para barberia: ${barberiaId}`);
    return servicio;
  }

  async findAll(barberiaId: string) {
    return this.prisma.servicio.findMany({
      where: { barberiaId, estado: 'ACTIVO' },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(barberiaId: string, id: string) {
    const servicio = await this.prisma.servicio.findFirst({
      where: { id, barberiaId },
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

  async deactivate(barberiaId: string, id: string) {
    const servicio = await this.findOne(barberiaId, id);

    if (servicio.estado === 'INACTIVO') {
      return servicio;
    }

    // T3.1: Regla de desactivación protegida
    // Buscar si existen reservas futuras PENDIENTE o CONFIRMADA con este servicio
    const reservasFuturas = await this.prisma.reserva.findMany({
      where: {
        barberiaId,
        estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
        fechaCita: { gte: new Date() }, // Futuras o de hoy
        participantes: {
          some: {
            participanteServicios: {
              some: {
                servicioId: id,
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

    if (reservasFuturas.length > 0) {
      const citasDesc = reservasFuturas
        .map((r) => `${r.fechaCita.toISOString().split('T')[0]} a las ${r.horaInicio.toISOString().split('T')[1].substring(0, 5)}`)
        .join(', ');
      throw new BadRequestException(
        `No se puede desactivar el servicio porque tiene ${reservasFuturas.length} reserva(s) futura(s) activa(s): ${citasDesc}`
      );
    }

    const deactivated = await this.prisma.servicio.update({
      where: { id: servicio.id },
      data: { estado: 'INACTIVO' },
    });

    this.logger.log(`Servicio desactivado: ${id}`);
    return deactivated;
  }
}
