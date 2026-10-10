import { Injectable, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { TipoExcepcionHorario } from '../../horario/application/dto/create-excepcion-horario.dto.js';
import { esAdministradorGlobalPorId, perteneceABarberia } from '../../iam/domain/roles.js';
import { ESTADOS } from '../../shared/domain/estados.js';
import {
  TiempoService,
  ZONA_POR_DEFECTO,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';

export interface Intervalo {
  inicio: Date;
  fin: Date;
}

export interface SolicitudDisponibilidad {
  barberiaId: string;
  /**
   * E2-04: acepta la etiqueta `YYYY-MM-DD` (preferida) o un `Date` de calendario;
   * si falta, se usa "hoy" en la zona de la sede.
   */
  fecha?: Date | string;
  duracionTotal: number; // en minutos
  margenRequerido: number; // en minutos (solo al final de todo el bloque)
  /**
   * E3-04: reserva que NO debe contar como ocupación.
   *
   * Aceptar una solicitud revalida su propio hueco bajo el lock de la sede, y
   * esa reserva sigue en `PENDIENTE` mientras se revalida: sin excluirla se
   * bloquearía a sí misma y un aceptar legítimo daría siempre 409.
   */
  excluirReservaId?: string;
}

@Injectable()
export class DisponibilidadService {
  private readonly logger = new Logger(DisponibilidadService.name);

  constructor(
    private readonly prisma: PrismaService,
    // E2-04: el reloj/zona es inyectable; el fallback permite construir el
    // servicio en pruebas unitarias que no montan el módulo compartido.
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
  ) {}

  /**
   * E2-04: la zona horaria de la sede sale de `barberias.zona_horaria`. El
   * `DEFAULT` de la columna ya trae la del catálogo; el fallback aquí cubre una
   * fila creada antes de la migración o un mock de prueba.
   */
  private async zonaDeSede(db: any, barberiaId: string): Promise<string> {
    const barberia = await db.barberia.findUnique({
      where: { id: barberiaId },
      select: { zonaHoraria: true },
    });
    return barberia?.zonaHoraria || ZONA_POR_DEFECTO;
  }

  /**
   * Compone el instante real de una etiqueta de calendario (`fecha`) más una
   * etiqueta horaria (`TIME`) en la zona de la sede. Es la sustitución directa
   * del viejo `mergeDateAndTime`, que usaba `setHours` del servidor.
   */
  private instanteDeEtiqueta(fechaIso: string, hora: Date, tz: string): Date {
    return this.tiempo.aInstante(fechaIso, horaRelojHHMM(hora), tz);
  }

  /**
   * E1-06 · parte 3: la disponibilidad es lectura de agenda de UNA sede.
   *
   * El guard y el decorador comprueban el ROL, pero el `CLIENTE` es GLOBAL con
   * `barberia_id` nulo, así que `alcanceCumple` lo admitía contra cualquier sede:
   * con solo la cabecera `x-barberia-id` un cliente autenticado leía los horarios
   * de una barbería ajena. Aquí se exige la PERTENENCIA real.
   *
   * El ADMINISTRADOR global se acepta aparte: es transversal por diseño (D05).
   */
  async calcularDisponibilidadDeSolicitante(
    solicitud: SolicitudDisponibilidad,
    solicitanteId: string,
    txClient?: any,
  ): Promise<Intervalo[]> {
    const db = txClient ?? this.prisma;

    if (!(await esAdministradorGlobalPorId(db, solicitanteId))) {
      const pertenece = await perteneceABarberia(db, solicitanteId, solicitud.barberiaId);
      if (!pertenece) {
        throw new ForbiddenException(
          'No perteneces a esta barbería: no puedes consultar su disponibilidad.',
        );
      }
    }

    return this.calcularDisponibilidad(solicitud, txClient);
  }

  /**
   * Calcula los Time Slots (intervalos) disponibles en una fecha para una duración dada.
   *
   * E2-04/H36: el día de la semana y la jornada se leen en la zona de la SEDE.
   * `fecha.getDay()` usaba la zona del servidor y con Render en UTC-4 (o el
   * proceso en `America/Santo_Domingo`) devolvía el día anterior; los slots se
   * componían con `setHours` del servidor, no como instantes reales.
   */
  async calcularDisponibilidad(solicitud: SolicitudDisponibilidad, txClient?: any): Promise<Intervalo[]> {
    const db = txClient ?? this.prisma;
    const { barberiaId, fecha, duracionTotal, margenRequerido, excluirReservaId } = solicitud;
    const duracionConMargen = duracionTotal + margenRequerido;

    const tz = await this.zonaDeSede(db, barberiaId);

    // E2-04: la fecha es una ETIQUETA de calendario. Si llega como cadena se usa
    // tal cual; si llega como `Date` se toman sus partes UTC (como la guarda un
    // `DATE`); si no llega, se resuelve "hoy" en la zona de la SEDE.
    let fechaIso: string;
    if (typeof fecha === 'string' && fecha.length >= 10) {
      fechaIso = fecha.slice(0, 10);
    } else if (fecha instanceof Date) {
      fechaIso = fechaCalendarioISO(fecha);
    } else {
      fechaIso = this.tiempo.fechaLocal(this.tiempo.ahora(), tz);
    }
    const fechaEtiqueta = this.tiempo.fechaDeCalendario(fechaIso);

    // 1. Obtener horario base para el día de la semana
    const diaSemana = this.tiempo.diaSemana(fechaIso, tz);

    const horarioBase = await db.horario.findFirst({
      where: { barberiaId, diaSemana },
    });

    // 2. Obtener excepciones para ese día
    const excepcion = await db.excepcionHorario.findFirst({
      where: { barberiaId, fecha: fechaEtiqueta },
    });

    if (excepcion && excepcion.tipo === TipoExcepcionHorario.CERRADA) {
      return []; // No hay disponibilidad
    }

    let inicioJornada = horarioBase ? this.instanteDeEtiqueta(fechaIso, horarioBase.horaInicio, tz) : null;
    let finJornada = horarioBase ? this.instanteDeEtiqueta(fechaIso, horarioBase.horaFin, tz) : null;

    if (excepcion && excepcion.tipo === TipoExcepcionHorario.HORARIO_ESPECIAL) {
      if (excepcion.horaInicio && excepcion.horaFin) {
        inicioJornada = this.instanteDeEtiqueta(fechaIso, excepcion.horaInicio, tz);
        finJornada = this.instanteDeEtiqueta(fechaIso, excepcion.horaFin, tz);
      }
    }

    if (!inicioJornada || !finJornada) {
      return []; // No hay horario definido
    }

    // 3. Obtener bloqueos de agenda
    const bloqueos = await db.bloqueosAgenda.findMany({
      where: { barberiaId, fecha: fechaEtiqueta },
    });

    // 4. Obtener reservas confirmadas/pendientes
    // Considerar que ocupan desde horaInicio hasta horaFin + margenGrupalHistorico
    const reservas = await db.reserva.findMany({
      where: {
        barberiaId,
        fechaCita: fechaEtiqueta,
        // E2-02: los dos estados desde los que una reserva ocupa agenda hoy
        // (§5.3). El conjunto NO cambia aquí: sumar PROPUESTA_PENDIENTE es la
        // decisión de D37/E3-02, documentada como H41.
        estado: { in: [ESTADOS.PENDIENTE, ESTADOS.CONFIRMADA] },
        ...(excluirReservaId ? { id: { not: excluirReservaId } } : {}),
      },
    });

    // 5. Construir los rangos ocupados
    const ocupados: Intervalo[] = [];

    for (const b of bloqueos) {
      ocupados.push({
        inicio: this.instanteDeEtiqueta(fechaIso, b.horaInicio, tz),
        fin: this.instanteDeEtiqueta(fechaIso, b.horaFin, tz),
      });
    }

    for (const r of reservas) {
      const inicioOcupado = this.instanteDeEtiqueta(fechaIso, r.horaInicio, tz);
      const finBase = this.instanteDeEtiqueta(fechaIso, r.horaFin, tz);
      const finOcupado = new Date(finBase.getTime() + (r.margenGrupalHistorico ?? 0) * 60000);
      ocupados.push({ inicio: inicioOcupado, fin: finOcupado });
    }

    // Fusionar intervalos ocupados solapados
    const ocupadosFusionados = this.fusionarIntervalos(ocupados);

    // 6. Extraer los rangos libres y dividirlos en Time Slots
    const disponibles: Intervalo[] = [];
    const duracionSlot = 30; // Intervalos de 30 mins (o 15, configurable)

    let cursor = inicioJornada.getTime();
    const finJornadaMs = finJornada.getTime();

    while (cursor < finJornadaMs) {
      const intentoInicio = new Date(cursor);
      const intentoFin = new Date(cursor + duracionConMargen * 60000);

      if (
        intentoFin.getTime() <= finJornadaMs &&
        !this.estaSolapado({ inicio: intentoInicio, fin: intentoFin }, ocupadosFusionados)
      ) {
        disponibles.push({ inicio: intentoInicio, fin: intentoFin });
      }

      // Avanzar el cursor
      cursor += duracionSlot * 60000;
    }

    return disponibles;
  }

  private fusionarIntervalos(intervalos: Intervalo[]): Intervalo[] {
    if (intervalos.length === 0) return [];
    intervalos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

    const fusionados = [intervalos[0]];
    for (let i = 1; i < intervalos.length; i++) {
      const last = fusionados[fusionados.length - 1];
      const actual = intervalos[i];
      if (actual.inicio <= last.fin) {
        last.fin = new Date(Math.max(last.fin.getTime(), actual.fin.getTime()));
      } else {
        fusionados.push(actual);
      }
    }
    return fusionados;
  }

  private estaSolapado(intento: Intervalo, ocupados: Intervalo[]): boolean {
    for (const o of ocupados) {
      // Hay solapamiento si el inicio del intento está antes del fin del ocupado
      // Y el fin del intento está después del inicio del ocupado
      if (intento.inicio < o.fin && intento.fin > o.inicio) {
        return true;
      }
    }
    return false;
  }
}
