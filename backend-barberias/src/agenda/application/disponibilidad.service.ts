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
import {
  PASO_DISPONIBILIDAD_MINUTOS,
  elegirAlternativas,
  proyectarTramosLibres,
  type Intervalo,
} from '../domain/huecos.js';
import { capacidadDeGrupoExcedida } from '../../reserva/domain/reserva-grupal.js';

export type { Intervalo };

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

/** E4-02 · solicitud de alternativas para UN día. */
export interface SolicitudDeAlternativas
  extends Omit<SolicitudDisponibilidad, 'margenRequerido' | 'duracionTotal'> {
  /** Servicios + margen: el bloque completo que tiene que caber. */
  duracionRequeridaMinutos: number;
  /** Hora pedida, para ordenar las alternativas por cercanía. */
  horaObjetivo?: string;
  /** Máximo de alternativas a devolver (5 por defecto). */
  maximo?: number;
}

/** E4-02 · una alternativa ya en etiquetas de la sede (lo que ve el cliente). */
export interface AlternativaEtiquetada {
  fecha: string;
  horaInicio: string;
  horaFin: string;
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

    await this.exigirPertenencia(db, solicitud.barberiaId, solicitanteId);

    return this.calcularDisponibilidad(solicitud, txClient);
  }

  /** E4-02: misma pertenencia que `calcularDisponibilidadDeSolicitante`. */
  async buscarAlternativasDeSolicitante(
    solicitud: SolicitudDeAlternativas,
    solicitanteId: string,
  ): Promise<AlternativaEtiquetada[]> {
    await this.exigirPertenencia(this.prisma, solicitud.barberiaId, solicitanteId);
    return this.buscarAlternativas(solicitud);
  }

  private async exigirPertenencia(db: any, barberiaId: string, solicitanteId: string): Promise<void> {
    if (!(await esAdministradorGlobalPorId(db, solicitanteId))) {
      const pertenece = await perteneceABarberia(db, solicitanteId, barberiaId);
      if (!pertenece) {
        throw new ForbiddenException(
          'No perteneces a esta barbería: no puedes consultar su disponibilidad.',
        );
      }
    }
  }

  /**
   * E3-02 · datos del día que comparten la disponibilidad y las alternativas:
   * la jornada efectiva (horario base, sobrescrito por una excepción) y las
   * ocupaciones según §5.3 (D37): bloqueos y reservas `PENDIENTE`/`CONFIRMADA`.
   */
  private async datosDelDia(db: any, barberiaId: string, fecha?: Date | string, excluirReservaId?: string) {
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
      return { tz, fechaIso, fechaEtiqueta, jornada: null as Intervalo | null, ocupados: [] as Intervalo[] };
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
      return { tz, fechaIso, fechaEtiqueta, jornada: null as Intervalo | null, ocupados: [] as Intervalo[] };
    }

    // 3. Obtener bloqueos de agenda
    // E2-07 · D29: un bloqueo LIBERADO ya no ocupa agenda. La fila se conserva
    // (para la auditoría), así que el filtro tiene que ser explícito.
    const bloqueos = await db.bloqueosAgenda.findMany({
      where: { barberiaId, fecha: fechaEtiqueta, liberadoAt: null },
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
        // E3-04: la reserva que se está revalidando sigue PENDIENTE mientras se
        // revalida su propio hueco; sin excluirla se bloquearía a sí misma.
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

    return {
      tz,
      fechaIso,
      fechaEtiqueta,
      jornada: { inicio: inicioJornada, fin: finJornada } as Intervalo,
      ocupados,
    };
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

    const datos = await this.datosDelDia(db, barberiaId, fecha, excluirReservaId);
    if (!datos.jornada) {
      return [];
    }

    // E4-02/D47: la proyección es la función pura del dominio, la misma que
    // alimenta las alternativas. El paso sigue siendo el histórico de 30 min.
    return proyectarTramosLibres(
      datos.jornada,
      datos.ocupados,
      duracionConMargen,
      PASO_DISPONIBILIDAD_MINUTOS,
    );
  }

  /**
   * E4-02 · Carril B (§E4-02/8, D22): huecos de espacio que la sede expone a
   * sus clientes.
   *
   * Es el MISMO cálculo que las alternativas del error (`buscarAlternativas`),
   * que a su vez es la proyección pura de E3-02 (D47). Un único algoritmo de
   * huecos alimenta ambos carriles.
   *
   * Reglas que gobiernan la exposición:
   *  - la bandera `oportunidades_espacio_activas` puede apagarlas (200 + []);
   *  - no se ofrece nada de un tipo que la sede no acepta (§E4-02/3);
   *  - el grupo tiene que caber (D46): si no cabe NUNCA en esa sede, no hay
   *    alternativa que ofrecer.
   *
   * SOLO LECTURA: no acepta cliente transaccional y no toma locks (D37/H41).
   */
  async huecosDeLaSede(
    barberiaId: string,
    solicitanteId: string,
    consulta: { fecha?: string; duracionTotal: number; participantes: number },
  ): Promise<AlternativaEtiquetada[]> {
    await this.exigirPertenencia(this.prisma, barberiaId, solicitanteId);

    const config = await this.prisma.configuracionBarberia.findUnique({
      where: { barberiaId },
    });

    // §E4-02/8 (D22): la sede puede apagarlas. Con la bandera en falso el
    // endpoint responde 200 y lista vacía, nunca 403: el contrato del endpoint
    // no depende de la configuración de cada tenant.
    if (!config || !config.oportunidadesEspacioActivas) {
      return [];
    }

    // §E4-02/3: no se ofrece ninguna alternativa si la sede no acepta ese tipo
    // de reserva, ni siquiera cuando el horario estuviera libre.
    const esGrupo = consulta.participantes > 1;
    if (esGrupo && !config.aceptaGrupal) return [];
    if (!esGrupo && !config.aceptaIndividual) return [];

    // §E4-02/3: el tamaño real del grupo (D46). Un grupo que no cabe en esa
    // sede no tiene alternativa posible.
    const excedida = capacidadDeGrupoExcedida(consulta.participantes, {
      maxPersonasTotal: config.maxPersonasTotal,
      maxNinos: config.maxNinos,
    });
    if (excedida) return [];

    return this.buscarAlternativas({
      barberiaId,
      fecha: consulta.fecha,
      duracionRequeridaMinutos: consulta.duracionTotal,
    });
  }

  /**
   * E4-02 · alternativas para un bloque que no cabe.
   *
   * **SOLO LECTURA, por diseño:** este método no acepta un cliente transaccional
   * (no hay parámetro `txClient`), así que no puede ejecutarse dentro de la
   * transacción que sostiene el `FOR UPDATE` de la sede, y no toma ningún lock
   * (D37/H41). La sugerencia no retiene nada: se revalida al confirmar.
   *
   * D47: usa el MISMO cálculo que la disponibilidad y la misma proyección pura.
   */
  async buscarAlternativas(solicitud: SolicitudDeAlternativas): Promise<AlternativaEtiquetada[]> {
    const datos = await this.datosDelDia(this.prisma, solicitud.barberiaId, solicitud.fecha);
    if (!datos.jornada) {
      return [];
    }

    const horaObjetivo = solicitud.horaObjetivo
      ? this.tiempo.aInstante(datos.fechaIso, solicitud.horaObjetivo, datos.tz)
      : undefined;

    const alternativas = elegirAlternativas({
      jornada: datos.jornada,
      ocupados: datos.ocupados,
      duracionRequeridaMinutos: solicitud.duracionRequeridaMinutos,
      ahora: this.tiempo.ahora(),
      horaObjetivo,
      maximo: solicitud.maximo,
    });

    return alternativas.map((alternativa) => {
      const inicio = this.tiempo.desdeInstante(alternativa.inicio, datos.tz);
      const fin = this.tiempo.desdeInstante(alternativa.fin, datos.tz);
      return {
        fecha: inicio.fecha,
        horaInicio: inicio.hora,
        horaFin: fin.fecha === inicio.fecha ? fin.hora : `${fin.hora} (+1d)`,
      };
    });
  }
}
