import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { TipoExcepcionHorario } from '../../horario/application/dto/create-excepcion-horario.dto.js';
import { esAdministradorGlobalPorId, perteneceABarberia } from '../../iam/domain/roles.js';

export interface Intervalo {
  inicio: Date;
  fin: Date;
}

export interface SolicitudDisponibilidad {
  barberiaId: string;
  fecha: Date;
  duracionTotal: number; // en minutos
  margenRequerido: number; // en minutos (solo al final de todo el bloque)
}

@Injectable()
export class DisponibilidadService {
  private readonly logger = new Logger(DisponibilidadService.name);

  constructor(private readonly prisma: PrismaService) {}

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
   */
  async calcularDisponibilidad(solicitud: SolicitudDisponibilidad, txClient?: any): Promise<Intervalo[]> {
    const db = txClient ?? this.prisma;
    const { barberiaId, fecha, duracionTotal, margenRequerido } = solicitud;
    const duracionConMargen = duracionTotal + margenRequerido;
    
    // 1. Obtener horario base para el día de la semana
    const diaSemana = fecha.getDay() === 0 ? 7 : fecha.getDay(); // Ajustar Domingo a 7 si aplica, o 0-6 según convención (asumimos 1=Lunes, 7=Domingo)
    
    const horarioBase = await db.horario.findFirst({
      where: { barberiaId, diaSemana },
    });

    // 2. Obtener excepciones para ese día
    const excepcion = await db.excepcionHorario.findFirst({
      where: { barberiaId, fecha },
    });

    if (excepcion && excepcion.tipo === TipoExcepcionHorario.CERRADA) {
      return []; // No hay disponibilidad
    }

    let inicioJornada = horarioBase ? this.mergeDateAndTime(fecha, horarioBase.horaInicio) : null;
    let finJornada = horarioBase ? this.mergeDateAndTime(fecha, horarioBase.horaFin) : null;

    if (excepcion && excepcion.tipo === TipoExcepcionHorario.HORARIO_ESPECIAL) {
      if (excepcion.horaInicio && excepcion.horaFin) {
        inicioJornada = this.mergeDateAndTime(fecha, excepcion.horaInicio);
        finJornada = this.mergeDateAndTime(fecha, excepcion.horaFin);
      }
    }

    if (!inicioJornada || !finJornada) {
      return []; // No hay horario definido
    }

    // 3. Obtener bloqueos de agenda
    const bloqueos = await db.bloqueosAgenda.findMany({
      where: { barberiaId, fecha },
    });

    // 4. Obtener reservas confirmadas/pendientes
    // Considerar que ocupan desde horaInicio hasta horaFin + margenGrupalHistorico
    const reservas = await db.reserva.findMany({
      where: {
        barberiaId,
        fechaCita: fecha,
        estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
      },
    });

    // 5. Construir los rangos ocupados
    const ocupados: Intervalo[] = [];
    
    for (const b of bloqueos) {
      ocupados.push({
        inicio: this.mergeDateAndTime(fecha, b.horaInicio),
        fin: this.mergeDateAndTime(fecha, b.horaFin),
      });
    }

    for (const r of reservas) {
      const finOcupado = this.mergeDateAndTime(fecha, r.horaFin);
      if (r.margenGrupalHistorico) {
        finOcupado.setMinutes(finOcupado.getMinutes() + r.margenGrupalHistorico);
      }
      ocupados.push({
        inicio: this.mergeDateAndTime(fecha, r.horaInicio),
        fin: finOcupado,
      });
    }

    // Fusionar intervalos ocupados solapados
    const ocupadosFusionados = this.fusionarIntervalos(ocupados);

    // 6. Extraer los rangos libres y dividirlos en Time Slots
    const disponibles: Intervalo[] = [];
    const duracionSlot = 30; // Intervalos de 30 mins (o 15, configurable)
    
    let cursor = new Date(inicioJornada);

    while (cursor < finJornada) {
      const intentoFin = new Date(cursor);
      intentoFin.setMinutes(intentoFin.getMinutes() + duracionConMargen);

      if (intentoFin <= finJornada && !this.estaSolapado({ inicio: cursor, fin: intentoFin }, ocupadosFusionados)) {
        disponibles.push({ inicio: new Date(cursor), fin: new Date(intentoFin) });
      }

      // Avanzar el cursor
      cursor.setMinutes(cursor.getMinutes() + duracionSlot);
    }

    return disponibles;
  }

  private mergeDateAndTime(date: Date, timeInfo: Date): Date {
    const result = new Date(date);
    result.setHours(timeInfo.getUTCHours(), timeInfo.getUTCMinutes(), 0, 0);
    return result;
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
