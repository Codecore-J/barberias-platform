/**
 * Contratos de salida de las analíticas.
 *
 * Existen por el caché: lo que se guarda es exactamente lo que se devuelve, y
 * una interfaz explícita impide que el objeto cacheado y el calculado se
 * separen sin que el compilador lo note.
 */

export interface PeriodoAnaliticas {
  /** Etiqueta `YYYY-MM-DD` local. */
  desde: string;
  /** Etiqueta `YYYY-MM-DD` local. */
  hasta: string;
}

export interface RendimientoBarbero {
  barberoId: string;
  nombre: string;
  citasCompletadas: number;
  inasistencias: number;
  ingresosGenerados: number;
}

export interface AnaliticasSede {
  periodo: PeriodoAnaliticas;
  resumenCitas: {
    total: number;
    porEstado: Record<string, number>;
  };
  retencion: {
    tasaInasistencia: number;
    tasaCancelacion: number;
    recordatoriosEnviados: number;
    cuposListaEsperaNotificados: number;
  };
  ingresos: {
    totalRecaudado: number;
    ticketPromedio: number;
    porMetodoPago: Record<string, number>;
  };
  rendimientoPorBarbero: RendimientoBarbero[];
}

export interface SedeOverview {
  barberiaId: string;
  nombre: string;
  activa: boolean;
  ingresos: number;
  totalCitas: number;
  citasCompletadas: number;
  tasaInasistencia: number;
  recordatoriosEnviados: number;
}

export interface OverviewSedes {
  periodo: PeriodoAnaliticas;
  totalesGlobales: {
    ingresosConsolidados: number;
    totalCitas: number;
    tasaGlobalInasistencia: number;
    tasaGlobalCancelacion: number;
  };
  sedes: SedeOverview[];
}
