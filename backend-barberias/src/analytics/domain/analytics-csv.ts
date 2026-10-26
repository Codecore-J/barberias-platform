/**
 * Paso 13 · CSV del reporte financiero y operativo de una sede.
 *
 * Sin librerías: el formato es pequeño y controlado. Se cuida lo que rompe una
 * hoja de cálculo de verdad:
 *  - delimitador coma, fin de línea CRLF y BOM UTF-8 para que Excel respete los
 *    acentos al abrir el archivo;
 *  - comillas dobles alrededor de toda celda con coma, comilla o salto de línea;
 *  - neutralización de fórmulas: una celda que empieza por `=`, `+`, `-` o `@`
 *    se antepone con un apóstrofo para que la hoja no la ejecute.
 */

const DELIMITADOR = ',';
const FIN_LINEA = '\r\n';
const BOM = '\uFEFF';

export interface AnalyticsCsvData {
  periodo: { desde: string; hasta: string };
  resumenCitas: { total: number; porEstado: Record<string, number> };
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
  rendimientoPorBarbero: {
    barberoId: string;
    nombre: string;
    citasCompletadas: number;
    inasistencias: number;
    ingresosGenerados: number;
  }[];
}

/** Escapa una celda y neutraliza su posible interpretación como fórmula. */
export function escaparCelda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : '';

  let texto = valor;
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  if (/[",\r\n;]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

/** Construye el CSV completo del reporte de una sede. */
export function construirCsvAnaliticas(barberiaId: string, data: AnalyticsCsvData): string {
  const inasistencias =
    (data.resumenCitas.porEstado['INASISTENCIA'] ?? 0) +
    (data.resumenCitas.porEstado['NO_PRESENTADO'] ?? 0);
  const canceladas = data.resumenCitas.porEstado['CANCELADA'] ?? 0;

  const filas: (string | number | null | undefined)[][] = [
    ['Reporte de analíticas', ''],
    ['Barbería', barberiaId],
    ['Desde', data.periodo.desde],
    ['Hasta', data.periodo.hasta],
    [],
    ['Totales', 'Valor'],
    ['Ingresos', data.ingresos.totalRecaudado.toFixed(2)],
    ['Ticket promedio', data.ingresos.ticketPromedio.toFixed(2)],
    ['Citas', data.resumenCitas.total],
    ['Inasistencias', inasistencias],
    ['Canceladas', canceladas],
    ['Tasa de inasistencia (%)', data.retencion.tasaInasistencia.toFixed(2)],
    ['Tasa de cancelación (%)', data.retencion.tasaCancelacion.toFixed(2)],
    ['Recordatorios enviados', data.retencion.recordatoriosEnviados],
    ['Cupos de lista de espera notificados', data.retencion.cuposListaEsperaNotificados],
    [],
    ['Rendimiento por barbero'],
    ['Barbero', 'Citas completadas', 'Inasistencias', 'Ingresos generados'],
    ...data.rendimientoPorBarbero.map((b) => [
      b.nombre || b.barberoId,
      b.citasCompletadas,
      b.inasistencias,
      b.ingresosGenerados.toFixed(2),
    ]),
  ];

  return BOM + filas.map((fila) => fila.map(escaparCelda).join(DELIMITADOR)).join(FIN_LINEA) + FIN_LINEA;
}
