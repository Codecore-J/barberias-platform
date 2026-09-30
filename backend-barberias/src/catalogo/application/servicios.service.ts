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

  async findAll(barberiaId?: string) {
    const where: any = { estado: 'ACTIVO' };
    if (barberiaId) {
      where.barberiaId = barberiaId;
    }
    return this.prisma.servicio.findMany({
      where,
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

    // T3.1 / FUNC-01: Regla de desactivación protegida
    // Bloquear la desactivación si hay solicitudes PENDIENTES.
    // Se PERMITE si solo existen reservas CONFIRMADAS, ya que cuentan con un snapshot
    // inmutable congelado en participanteServicio (precioHistorico, duracionHistorica, margenHistorico).
    const reservasPendientes = await this.prisma.reserva.findMany({
      where: {
        barberiaId,
        estado: 'PENDIENTE',
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

    if (reservasPendientes.length > 0) {
      const citasDesc = reservasPendientes
        .map((r) => `${r.fechaCita.toISOString().split('T')[0]} a las ${r.horaInicio.toISOString().split('T')[1].substring(0, 5)}`)
        .join(', ');
      throw new BadRequestException(
        `No se puede desactivar el servicio porque tiene ${reservasPendientes.length} solicitud(es) de reserva pendiente(s) por confirmar: ${citasDesc}`
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
