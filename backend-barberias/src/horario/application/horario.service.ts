import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';
import { CreateHorarioDto } from './dto/create-horario.dto.js';
import { CreateExcepcionHorarioDto, TipoExcepcionHorario } from './dto/create-excepcion-horario.dto.js';
import { DiaHorarioBarberoDto } from './dto/dia-horario-barbero.dto.js';
import { ConfigurarMiHorarioDto } from './dto/configurar-mi-horario.dto.js';
import type {
  DiaHorarioBarberoResponse,
  MiHorarioResponse,
} from './dto/mi-horario-response.dto.js';
import { validateTimeRange, parseTime } from '../domain/time.utils.js';
import { esAdministradorGlobalPorId } from '../../iam/domain/roles.js';
import { horaRelojHHMM } from '../../shared/time/tiempo.service.js';

/** ISO: 1 = lunes … 7 = domingo, la numeración de `TiempoService.diaSemana`. */
const DIAS_SEMANA = [1, 2, 3, 4, 5, 6, 7] as const;

@Injectable()
export class HorarioService {
  constructor(
    private prisma: PrismaService,
    // E2-04: las fechas de excepción son etiquetas `DATE`; se construyen por el
    // servicio central para no depender de `new Date(str)` ni de la zona del
    // servidor al escribirlas.
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
  ) {}

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

    const fecha = this.tiempo.fechaDeCalendario(dto.fecha);

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

  // ── V3 fase 5 · semana propia del barbero (días libres y descansos) ──────

  /**
   * El horario propio lo gestiona quien lo vive: el BARBERO con rol en esa
   * sede. Un admin no escribe aquí «como» el barbero; si necesitara cubrirlo,
   * el camino es una excepción de sede o asignar el turno a otro barbero.
   */
  private async exigirBarberoDeSede(usuarioId: string, barberiaId: string): Promise<void> {
    const rol = await this.prisma.usuarioRol.findFirst({
      where: { usuarioId, barberiaId, rol: { nombre: 'BARBERO' } },
    });

    if (!rol) {
      throw new ForbiddenException(
        'Solo el barbero de esta sede puede gestionar su propio horario.',
      );
    }
  }

  /**
   * Valida UN día y lo convierte a la fila de Prisma.
   *
   * Reglas (las mismas que impone el CHECK de la migración, aquí con mensajes
   * que el barbero puede leer):
   *  - día libre → sin horas ni descanso;
   *  - día trabajado → entrada y salida, con entrada < salida;
   *  - descanso opcional pero COMPLETO y siempre dentro de la jornada.
   */
  private validarDia(dia: DiaHorarioBarberoDto) {
    if (dia.esDiaLibre) {
      if (dia.horaInicioDescanso || dia.horaFinDescanso) {
        throw new BadRequestException(
          `El ${dia.diaSemana} es día libre: no puede tener un descanso configurado.`,
        );
      }

      return {
        diaSemana: dia.diaSemana,
        esDiaLibre: true,
        horaInicio: null,
        horaFin: null,
        horaInicioDescanso: null,
        horaFinDescanso: null,
      };
    }

    if (!dia.horaInicio || !dia.horaFin) {
      throw new BadRequestException(
        `El ${dia.diaSemana} no es libre: indica la hora de entrada y la de salida.`,
      );
    }

    const { inicio, fin } = validateTimeRange(dia.horaInicio, dia.horaFin);

    const tieneInicioDescanso = !!dia.horaInicioDescanso;
    const tieneFinDescanso = !!dia.horaFinDescanso;

    if (tieneInicioDescanso !== tieneFinDescanso) {
      throw new BadRequestException(
        'El descanso necesita las dos horas: inicio y fin.',
      );
    }

    let descansoInicio: Date | null = null;
    let descansoFin: Date | null = null;

    if (tieneInicioDescanso && tieneFinDescanso) {
      const descanso = validateTimeRange(dia.horaInicioDescanso!, dia.horaFinDescanso!);

      if (descanso.inicio < inicio || descanso.fin > fin) {
        throw new BadRequestException(
          `El descanso del ${dia.diaSemana} debe estar dentro de la jornada (${dia.horaInicio}–${dia.horaFin}).`,
        );
      }

      descansoInicio = descanso.inicio;
      descansoFin = descanso.fin;
    }

    return {
      diaSemana: dia.diaSemana,
      esDiaLibre: false,
      horaInicio: inicio,
      horaFin: fin,
      horaInicioDescanso: descansoInicio,
      horaFinDescanso: descansoFin,
    };
  }

  private aDiaResponse(
    diaSemana: number,
    fila?: {
      esDiaLibre: boolean;
      horaInicio: Date | null;
      horaFin: Date | null;
      horaInicioDescanso: Date | null;
      horaFinDescanso: Date | null;
    },
  ): DiaHorarioBarberoResponse {
    // Las horas de un `TIME` llegan como `1970-01-01T08:00:00.000Z`; la etiqueta
    // `HH:mm` es lo que pinta un `<input type="time">` sin errores de formato.
    const etiqueta = (valor: Date | null | undefined) => (valor ? horaRelojHHMM(valor) : null);

    return {
      diaSemana,
      esDiaLibre: fila?.esDiaLibre ?? false,
      horaInicio: etiqueta(fila?.horaInicio),
      horaFin: etiqueta(fila?.horaFin),
      horaInicioDescanso: etiqueta(fila?.horaInicioDescanso),
      horaFinDescanso: etiqueta(fila?.horaFinDescanso),
    };
  }

  /**
   * Semana completa del barbero. Los días sin fila vuelven en `null` (la
   * pantalla decide sus valores por defecto) y `heredaHorarioSede` avisa de que
   * todavía no configuró nada, que es cuando el motor usa el horario de la sede.
   */
  async getMiHorario(usuarioId: string, barberiaId: string): Promise<MiHorarioResponse> {
    await this.exigirBarberoDeSede(usuarioId, barberiaId);

    const filas = await this.prisma.horarioBarbero.findMany({
      where: { barberiaId, barberoId: usuarioId },
      orderBy: { diaSemana: 'asc' },
    });

    return {
      barberiaId,
      barberoId: usuarioId,
      heredaHorarioSede: filas.length === 0,
      dias: DIAS_SEMANA.map((diaSemana) =>
        this.aDiaResponse(
          diaSemana,
          filas.find((fila) => fila.diaSemana === diaSemana),
        ),
      ),
    };
  }

  /**
   * Reemplaza la semana completa: la pantalla manda los siete días y lo que no
   * venga se considera no configurado. El reemplazo es transaccional para que
   * un fallo a mitad no deje al barbero con media semana.
   */
  async configurarMiHorario(
    usuarioId: string,
    barberiaId: string,
    dto: ConfigurarMiHorarioDto,
  ): Promise<MiHorarioResponse> {
    await this.exigirBarberoDeSede(usuarioId, barberiaId);

    const diasVistos = new Set<number>();

    const data = dto.dias.map((dia) => {
      if (diasVistos.has(dia.diaSemana)) {
        throw new BadRequestException(
          `El día ${dia.diaSemana} viene repetido: envía una sola fila por día.`,
        );
      }
      diasVistos.add(dia.diaSemana);

      return {
        barberiaId,
        barberoId: usuarioId,
        ...this.validarDia(dia),
      };
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.horarioBarbero.deleteMany({
        where: { barberiaId, barberoId: usuarioId },
      });

      await tx.horarioBarbero.createMany({ data });
    });

    return this.getMiHorario(usuarioId, barberiaId);
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

    const fecha = this.tiempo.fechaDeCalendario(dto.fecha);

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
