import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CreateHorarioDto } from './dto/create-horario.dto.js';
import { CreateExcepcionHorarioDto, TipoExcepcionHorario } from './dto/create-excepcion-horario.dto.js';
import { validateTimeRange, parseTime } from '../domain/time.utils.js';
import { esAdministradorGlobalPorId } from '../../iam/domain/roles.js';

@Injectable()
export class HorarioService {
  constructor(private prisma: PrismaService) {}

  private async validateAccess(usuarioId: string, barberiaId: string) {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { responsableId: true },
    });

    if (!barberia) {
      throw new NotFoundException('Barbería no encontrada');
    }

    const rolesUser = await this.prisma.usuarioRol.findMany({
      where: { usuarioId, barberiaId },
      include: { rol: true }
    });

    const isResponsable = barberia.responsableId === usuarioId;
    // E1-04 (D05): el rol global es ADMINISTRADOR.
    const esGlobal = await esAdministradorGlobalPorId(this.prisma, usuarioId);

    if (!isResponsable && !esGlobal && !rolesUser.some(ur => ur.rol.nombre === 'ADMIN_BARBERIA')) {
      throw new ForbiddenException('No tienes permisos para modificar horarios de esta barbería');
    }
  }

  async configureSchedules(usuarioId: string, barberiaId: string, schedules: CreateHorarioDto[]) {
    await this.validateAccess(usuarioId, barberiaId);

    // Validate all schedules first
    for (const schedule of schedules) {
      validateTimeRange(schedule.horaInicio, schedule.horaFin);
    }

    return this.prisma.$transaction(async (tx) => {
      // Clear existing schedule
      await tx.horario.deleteMany({
        where: { barberiaId },
      });

      // Insert new schedules
      const data = schedules.map(schedule => {
        const { inicio, fin } = validateTimeRange(schedule.horaInicio, schedule.horaFin);
        return {
          barberiaId,
          diaSemana: schedule.diaSemana,
          horaInicio: inicio,
          horaFin: fin,
        };
      });

      await tx.horario.createMany({ data });
      return { success: true, message: 'Horarios configurados correctamente' };
    });
  }

  async getSchedules(barberiaId: string) {
    return this.prisma.horario.findMany({
      where: { barberiaId },
      orderBy: { diaSemana: 'asc' },
    });
  }

  async addException(usuarioId: string, barberiaId: string, dto: CreateExcepcionHorarioDto) {
    await this.validateAccess(usuarioId, barberiaId);

    let inicio: Date | undefined;
    let fin: Date | undefined;

    if (dto.tipo === TipoExcepcionHorario.HORARIO_ESPECIAL) {
      if (!dto.horaInicio || !dto.horaFin) {
        throw new BadRequestException('Para HORARIO_ESPECIAL se requiere horaInicio y horaFin');
      }
      const parsed = validateTimeRange(dto.horaInicio, dto.horaFin);
      inicio = parsed.inicio;
      fin = parsed.fin;
    }

    const fecha = new Date(dto.fecha);

    return this.prisma.excepcionHorario.upsert({
      where: {
        uk_excepcion_fecha: {
          barberiaId,
          fecha,
        }
      },
      update: {
        tipo: dto.tipo,
        horaInicio: inicio,
        horaFin: fin,
        motivo: dto.motivo,
      },
      create: {
        barberiaId,
        fecha,
        tipo: dto.tipo,
        horaInicio: inicio,
        horaFin: fin,
        motivo: dto.motivo,
      }
    });
  }

  async getExceptions(barberiaId: string, from: Date, to: Date) {
    return this.prisma.excepcionHorario.findMany({
      where: {
        barberiaId,
        fecha: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { fecha: 'asc' },
    });
  }

  async configureBarberSchedules(usuarioId: string, barberiaId: string, schedules: CreateHorarioDto[]) {
    // Check if user is barbero in this barberia
    const isBarbero = await this.prisma.usuarioRol.findFirst({
      where: { usuarioId, barberiaId, rol: { nombre: 'BARBERO' } }
    });
    
    // Admin/Responsable can also configure a barber's schedule if they pass the barberoId, but for now we assume they configure their own
    if (!isBarbero) {
       // Check if they are admin, maybe we can let admins configure it in the future
    }

    for (const schedule of schedules) {
      validateTimeRange(schedule.horaInicio, schedule.horaFin);
    }

    return this.prisma.$transaction(async (tx) => {
      // Clear existing barber schedule
      await tx.horarioBarbero.deleteMany({
        where: { barberiaId, barberoId: usuarioId },
      });

      // Insert new schedules
      const data = schedules.map(schedule => {
        const { inicio, fin } = validateTimeRange(schedule.horaInicio, schedule.horaFin);
        return {
          barberiaId,
          barberoId: usuarioId,
          diaSemana: schedule.diaSemana,
          horaInicio: inicio,
          horaFin: fin,
        };
      });

      await tx.horarioBarbero.createMany({ data });
      return { success: true, message: 'Horarios del barbero configurados correctamente' };
    });
  }

  async getBarberSchedules(barberiaId: string, barberoId: string) {
    return this.prisma.horarioBarbero.findMany({
      where: { barberiaId, barberoId },
      orderBy: { diaSemana: 'asc' },
    });
  }

  async addBarberException(usuarioId: string, barberiaId: string, barberoId: string, dto: CreateExcepcionHorarioDto) {
    // Admin validation or self
    if (usuarioId !== barberoId) {
      await this.validateAccess(usuarioId, barberiaId);
    }

    let inicio: Date | undefined;
    let fin: Date | undefined;

    if (dto.tipo === TipoExcepcionHorario.HORARIO_ESPECIAL) {
      if (!dto.horaInicio || !dto.horaFin) {
        throw new BadRequestException('Para HORARIO_ESPECIAL se requiere horaInicio y horaFin');
      }
      const parsed = validateTimeRange(dto.horaInicio, dto.horaFin);
      inicio = parsed.inicio;
      fin = parsed.fin;
    }

    const fecha = new Date(dto.fecha);

    return this.prisma.excepcionHorarioBarbero.upsert({
      where: {
        uk_excepcion_barbero_fecha: {
          barberiaId,
          barberoId,
          fecha,
        }
      },
      update: {
        tipo: dto.tipo,
        horaInicio: inicio,
        horaFin: fin,
        motivo: dto.motivo,
      },
      create: {
        barberiaId,
        barberoId,
        fecha,
        tipo: dto.tipo,
        horaInicio: inicio,
        horaFin: fin,
        motivo: dto.motivo,
      }
    });
  }

  async getBarberExceptions(barberiaId: string, barberoId: string, from: Date, to: Date) {
    return this.prisma.excepcionHorarioBarbero.findMany({
      where: {
        barberiaId,
        barberoId,
        fecha: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { fecha: 'asc' },
    });
  }
}
