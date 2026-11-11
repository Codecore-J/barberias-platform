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
import {
  type DiaPlantillaBarberoResponse,
  type PlantillaBaseBarberoResponse,
} from './dto/plantilla-base-barbero.dto.js';
import { OrigenModificacionHorario } from '@prisma/client';
import { validateTimeRange } from "../domain/time.utils.js";
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

  /**
   * ¿Es este usuario OPERADOR de la sede (responsable, ADMIN_BARBERIA o
   * ADMINISTRADOR global)? Es la única definición de «puede tocar la sede» en
   * este servicio; `validateAccess` y la autoría de las excepciones la comparten
   * para no decidir dos veces con criterios distintos.
   */
  private async esOperadorDeSede(usuarioId: string, barberiaId: string): Promise<boolean> {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { responsableId: true },
    });

    if (!barberia) {
      throw new NotFoundException('Barbería no encontrada');
    }

    if (barberia.responsableId === usuarioId) return true;

    // E1-04 (D05): el rol global es ADMINISTRADOR.
    if (await esAdministradorGlobalPorId(this.prisma, usuarioId)) return true;

    const rolAdmin = await this.prisma.usuarioRol.findFirst({
      where: { usuarioId, barberiaId, rol: { nombre: 'ADMIN_BARBERIA' } },
    });

    return !!rolAdmin;
  }

  private async validateAccess(usuarioId: string, barberiaId: string) {
    if (!(await this.esOperadorDeSede(usuarioId, barberiaId))) {
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

  /**
   * V3 · ORIGEN del cambio de horario: quien toca su propia agenda es el
   * BARBERO; quien toca la de otro tiene que ser operador de la sede y queda
   * como ADMIN_SEDE. El usuario concreto se guarda aparte, en
   * `modificadoPorId`, para que la auditoría no dependa de un solo campo.
   *
   * Un barbero que intente escribir la agenda de un compañero recibe 403 aquí y
   * no un 404: el recurso existe, lo que falta es el permiso.
   */
  private async resolverOrigenDeModificacion(
    usuarioId: string,
    barberiaId: string,
    barberoId: string,
  ): Promise<OrigenModificacionHorario> {
    if (usuarioId === barberoId) {
      return OrigenModificacionHorario.BARBERO;
    }

    if (await this.esOperadorDeSede(usuarioId, barberiaId)) {
      return OrigenModificacionHorario.ADMIN_SEDE;
    }

    const rolDeBarbero = await this.prisma.usuarioRol.findFirst({
      where: { usuarioId, barberiaId, rol: { nombre: 'BARBERO' } },
    });

    if (rolDeBarbero) {
      throw new ForbiddenException(
        'Solo puedes modificar tu propia agenda: la de otro barbero la gestiona el responsable de la sede.',
      );
    }

    throw new ForbiddenException('No tienes permisos para modificar horarios de esta barbería');
  }

  async addBarberException(usuarioId: string, barberiaId: string, barberoId: string, dto: CreateExcepcionHorarioDto) {
    const modificadoPor = await this.resolverOrigenDeModificacion(usuarioId, barberiaId, barberoId);

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
        modificadoPor,
        modificadoPorId: usuarioId,
      },
      create: {
        barberiaId,
        barberoId,
        fecha,
        tipo: dto.tipo,
        horaInicio: inicio,
        horaFin: fin,
        motivo: dto.motivo,
        modificadoPor,
        modificadoPorId: usuarioId,
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

  // ── V3 · plantilla base semanal (sin sede) ───────────────────────────────

  /**
   * Valida UN día de la plantilla y lo traduce a lo que se escribe en la base.
   *
   * Reglas (las mismas que impone el CHECK de la migración, aquí con mensajes
   * que el barbero puede leer):
   *  - un día ACTIVO necesita entrada y salida, con entrada < salida;
   *  - un día apagado puede venir sin horas: significa «no crees/bloques este
   *    día», y el servicio solo apaga la fila si ya existía;
   *  - las horas que sí vienen se validan siempre, aunque el día esté apagado:
   *    guardar «9:5» para luego encenderlo dejaría una fila inservible.
   */
  private validarDiaDePlantilla(dia: {
    diaSemana: number;
    activo?: boolean;
    horaInicio?: string | null;
    horaFin?: string | null;
  }) {
    const activo = dia.activo ?? true;

    if (!dia.horaInicio || !dia.horaFin) {
      if (activo) {
        throw new BadRequestException(
          `El día ${dia.diaSemana} está activo: indica horaInicio y horaFin.`,
        );
      }

      return { diaSemana: dia.diaSemana, horaInicio: null, horaFin: null, activo: false };
    }

    validateTimeRange(dia.horaInicio, dia.horaFin);

    return {
      diaSemana: dia.diaSemana,
      horaInicio: dia.horaInicio,
      horaFin: dia.horaFin,
      activo,
    };
  }

  /**
   * La plantilla del barbero autenticado, con los siete días.
   *
   * Es una plantilla GLOBAL: no cuelga de una sede, así que el `barberiaId` no
   * filtra la lectura. La sede del path solo sirve para autorizar (el barbero
   * tiene que tener rol en ella, `exigirBarberoDeSede`).
   */
  async obtenerPlantillaBase(usuarioId: string): Promise<PlantillaBaseBarberoResponse> {
    const filas = await this.prisma.horarioBaseBarbero.findMany({
      where: { barberoId: usuarioId },
      orderBy: { diaSemana: 'asc' },
    });

    return {
      barberoId: usuarioId,
      sinPlantilla: filas.length === 0,
      dias: DIAS_SEMANA.map((diaSemana): DiaPlantillaBarberoResponse => {
        const fila = filas.find((candidata) => candidata.diaSemana === diaSemana);

        return {
          diaSemana,
          horaInicio: fila?.horaInicio ?? null,
          horaFin: fila?.horaFin ?? null,
          // Sin fila no hay bloque: `activo` describe el bloque, no el día.
          activo: fila?.activo ?? false,
        };
      }),
    };
  }

  /**
   * Guarda la plantilla con un UPSERT MASIVO: solo se tocan los días enviados.
   *
   * No reemplaza la semana como `configurarMiHorario` porque la plantilla se
   * edita bloque a bloque desde otra pantalla: borrar lo no enviado convertiría
   * un envío parcial en una pérdida silenciosa. Tampoco borra filas —el campo
   * `activo` existe justo para apagar un bloque sin perder sus horas—, así que
   * el vocabulario del proyecto (E2-07) se mantiene intacto.
   *
   * Las validaciones corren ANTES de abrir la transacción: un día inválido no
   * debe dejar media plantilla escrita.
   */
  async guardarPlantillaBase(
    usuarioId: string,
    barberiaId: string,
    dto: { dias: { diaSemana: number; activo?: boolean; horaInicio?: string | null; horaFin?: string | null }[] },
  ): Promise<PlantillaBaseBarberoResponse> {
    await this.exigirBarberoDeSede(usuarioId, barberiaId);

    const diasVistos = new Set<number>();

    const dias = dto.dias.map((dia) => {
      if (diasVistos.has(dia.diaSemana)) {
        throw new BadRequestException(
          `El día ${dia.diaSemana} viene repetido: envía una sola fila por día.`,
        );
      }
      diasVistos.add(dia.diaSemana);

      return this.validarDiaDePlantilla(dia);
    });

    await this.prisma.$transaction(async (tx) => {
      for (const dia of dias) {
        if (!dia.horaInicio || !dia.horaFin) {
          // Día apagado y sin horas: no hay bloque que crear. Si ya existía, se
          // apaga; si no, `updateMany` no toca ninguna fila y no se inventa una
          // con horas falsas (las columnas son NOT NULL).
          await tx.horarioBaseBarbero.updateMany({
            where: { barberoId: usuarioId, diaSemana: dia.diaSemana },
            data: { activo: false },
          });
          continue;
        }

        await tx.horarioBaseBarbero.upsert({
          where: {
            barberoId_diaSemana: { barberoId: usuarioId, diaSemana: dia.diaSemana },
          },
          update: {
            horaInicio: dia.horaInicio,
            horaFin: dia.horaFin,
            activo: dia.activo,
          },
          create: {
            barberoId: usuarioId,
            diaSemana: dia.diaSemana,
            horaInicio: dia.horaInicio,
            horaFin: dia.horaFin,
            activo: dia.activo,
          },
        });
      }
    });

    return this.obtenerPlantillaBase(usuarioId);
  }
}
