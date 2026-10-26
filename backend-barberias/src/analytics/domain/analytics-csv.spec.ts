import { describe, it, expect } from 'vitest';
import { construirCsvAnaliticas, escaparCelda, type AnalyticsCsvData } from './analytics-csv.js';

const DATOS: AnalyticsCsvData = {
  periodo: { desde: '2026-10-01', hasta: '2026-10-31' },
  resumenCitas: {
    total: 10,
    porEstado: { COMPLETADA: 6, INASISTENCIA: 1, NO_PRESENTADO: 1, CANCELADA: 2 },
  },
  retencion: {
    tasaInasistencia: 20,
    tasaCancelacion: 20,
    recordatoriosEnviados: 5,
    cuposListaEsperaNotificados: 3,
  },
  ingresos: {
    totalRecaudado: 1500,
    ticketPromedio: 750,
    porMetodoPago: { EFECTIVO: 1000, TARJETA: 500 },
  },
  rendimientoPorBarbero: [
    {
      barberoId: 'b1',
      nombre: 'Juan Pérez',
      citasCompletadas: 4,
      inasistencias: 1,
      ingresosGenerados: 1200,
    },
  ],
};

describe('escaparCelda', () => {
  it('deja intacto el texto simple', () => {
    expect(escaparCelda('Juan')).toBe('Juan');
  });

  it('entrecomilla las celdas con coma, comilla o salto de linea', () => {
    expect(escaparCelda('Pérez, Juan')).toBe('"Pérez, Juan"');
    expect(escaparCelda('di "hola"')).toBe('"di ""hola"""');
    expect(escaparCelda('linea1\nlinea2')).toBe('"linea1\nlinea2"');
  });

  it('neutraliza formulas de hoja de calculo', () => {
    expect(escaparCelda('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escaparCelda('+1')).toBe("'+1");
    expect(escaparCelda('-1')).toBe("'-1");
    expect(escaparCelda('@cmd')).toBe("'@cmd");
  });

  it('mantiene los numeros y vacia null/undefined', () => {
    expect(escaparCelda(1500)).toBe('1500');
    expect(escaparCelda(null)).toBe('');
    expect(escaparCelda(undefined)).toBe('');
  });
});

describe('construirCsvAnaliticas', () => {
  const csv = construirCsvAnaliticas('shop-123', DATOS);
  const lineas = csv.replace(/^\uFEFF/, '').split('\r\n');

  it('empieza con BOM UTF-8 para que Excel respete los acentos', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true);
  });

  it('incluye cabecera, rango y totales del periodo', () => {
    expect(lineas[0]).toBe('Reporte de analíticas,');
    expect(lineas[1]).toBe('Barbería,shop-123');
    expect(lineas[2]).toBe('Desde,2026-10-01');
    expect(lineas[3]).toBe('Hasta,2026-10-31');
    expect(lineas).toContain('Ingresos,1500.00');
    expect(lineas).toContain('Citas,10');
  });

  it('suma las inasistencias de todos sus estados', () => {
    expect(lineas).toContain('Inasistencias,2');
    expect(lineas).toContain('Canceladas,2');
    expect(lineas).toContain('Tasa de inasistencia (%),20.00');
  });

  it('incluye la tabla de rendimiento por barbero con montos a dos decimales', () => {
    expect(lineas).toContain('Barbero,Citas completadas,Inasistencias,Ingresos generados');
    expect(lineas).toContain('Juan Pérez,4,1,1200.00');
  });

  it('mantiene una sola fila por barbero aunque el nombre lleve comas', () => {
    const conComa = construirCsvAnaliticas('shop-123', {
      ...DATOS,
      rendimientoPorBarbero: [{ ...DATOS.rendimientoPorBarbero[0], nombre: 'Pérez, Juan' }],
    });
    expect(conComa).toContain('"Pérez, Juan",4,1,1200.00');
  });
});
