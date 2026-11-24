import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCIONES,
  RUTA_ACCION,
  RUTAS_BRECHA_MATRIZ,
  RUTAS_BRECHA_ROL,
} from '../src/iam/domain/matriz.js';

/**
 * T-10 · Matriz objetivo en código: mapa ruta → acción.
 *
 * `docs/MATRIZ_PERMISOS_OBJETIVO.md` tiene las 30 acciones y
 * `docs/MATRIZ_RUTAS_ACCIONES.md` (§3) decide qué acción le toca a cada una de
 * las rutas del inventario (la última suma de T-24: la imagen del servicio,
 * sin acción propia porque la gobierna el rol BARBERO). Este test comprueba que `src/iam/domain/matriz.ts` reproduce esa
 * decisión sin inventar ni perder filas.
 *
 * El inventario de rutas es `POLITICA_DECLARADA`, en `permisos-matriz.spec.ts`,
 * y el test existente ya falla si el servidor descubre una ruta que no esté ahí.
 * Aquí se lee ese diccionario del propio archivo (no se puede importar sin
 * ejecutar sus `describe`) y se compara con `RUTA_ACCION`: con las dos
 * comprobaciones juntas, ninguna ruta del servidor queda sin decisión de acción.
 *
 * No arranca `AppModule` ni toca la base de datos: es lectura de datos y texto.
 */

const RUTA_SPEC = fileURLToPath(new URL('./permisos-matriz.spec.ts', import.meta.url));

/** Las 125 claves de `POLITICA_DECLARADA`, leídas de su literal. */
function clavesDePoliticaDeclarada(): string[] {
  const fuente = readFileSync(RUTA_SPEC, 'utf8').replace(/\r/g, '');
  const inicio = fuente.indexOf('const POLITICA_DECLARADA');
  const apertura = fuente.indexOf('{', inicio);
  const cierre = fuente.indexOf('\n};', apertura);
  const bloque = fuente.slice(apertura, cierre);

  const claves = [...bloque.matchAll(/^\s*'([A-Z]+ [^']+)'\s*:/gm)].map((m) => m[1]);

  // Si el diccionario se reformatea y la extracción se queda corta, el test lo
  // dice aquí en lugar de dar por buena una comparación vacía.
  if (claves.length === 0) {
    throw new Error(
      `No pude leer ninguna clave de POLITICA_DECLARADA en ${RUTA_SPEC}: revisa el formato del diccionario.`,
    );
  }

  return claves.sort();
}

/** Las 12 rutas de §6 del documento: `sin acción` marcadas como brecha. */
const BRECHAS_MATRIZ = [
  'GET /plataforma/solicitudes-cambio/',
  'POST /plataforma/solicitudes-cambio/:id/resolver',
  'GET /plataforma/vinculaciones/pendientes',
  'POST /plataforma/vinculaciones/:id/aprobar',
  'POST /plataforma/vinculaciones/:id/rechazar',
  'GET /shops/:shopId/settings/',
  'PATCH /shops/:shopId/settings/',
  'GET /shops/:shopId/restricted-clients/',
  'POST /shops/:shopId/restricted-clients/:clientId/reactivate',
  'POST /shops/:shopId/appointments/:id/propose-time',
  'POST /shops/:shopId/payments/',
  'POST /pagos/cobrar',
].sort();

/** Las 12 rutas de §2: tenían acción, pero el rol del código contradecía la matriz. T-11 las cerró. */
const BRECHAS_ROL: string[] = [];

/**
 * Las nueve acciones aprobadas que todavía no tienen endpoint: las cubren las
 * rutas nuevas de T-12 (§7.2 y §8 del documento). Cuando una deje de estar
 * huérfana, este conjunto se actualiza a propósito.
 */
const SIN_RUTA_TODAVIA = [
  'cita.propia.proponer_horario',
  'configuracion.sede.gestionar',
  'configuracion.sede.ver',
  'horario.base.aprobar',
  'pagos.cobrar',
  'plataforma.solicitudes_cambio.gestionar',
  'plataforma.vinculaciones.gestionar',
  'restringidos_locales.gestionar',
  'restringidos_locales.ver',
].sort();

const RUTAS = Object.keys(RUTA_ACCION);

describe('Matriz objetivo ruta → acción (T-10)', () => {
  it('declara las 30 acciones con identificador de dominio, sin duplicados', () => {
    expect(ACCIONES.length).toBe(30);
    expect(new Set(ACCIONES).size).toBe(30);

    const malFormadas = ACCIONES.filter((accion) => !/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/.test(accion));
    expect(malFormadas).toEqual([]);
  });

  it('cubre exactamente las 125 rutas del inventario', () => {
    const claves = clavesDePoliticaDeclarada();

    expect(claves.length).toBe(125);
    expect(RUTAS.length).toBe(new Set(RUTAS).size);

    const sinDecision = claves.filter((clave) => !(clave in RUTA_ACCION));
    expect(
      sinDecision.length === 0
        ? ''
        : `rutas del inventario sin decision de accion:\n${sinDecision.join('\n')}`,
    ).toBe('');

    const sobrantes = RUTAS.filter((clave) => !claves.includes(clave));
    expect(
      sobrantes.length === 0
        ? ''
        : `rutas del mapa que ya no existen en el inventario:\n${sobrantes.join('\n')}`,
    ).toBe('');
  });

  it('reparte 71 rutas con acción y 54 sin acción (42 fuera + 12 brechas)', () => {
    const conAccion = RUTAS.filter((clave) => RUTA_ACCION[clave].length > 0);
    const sinAccion = RUTAS.filter((clave) => RUTA_ACCION[clave].length === 0);

    expect(conAccion.length).toBe(71);
    expect(sinAccion.length).toBe(54);
    expect(conAccion.length + sinAccion.length).toBe(125);

    // De las 54 sin acción, doce son brecha de la matriz y las otras 42 quedan
    // fuera de su alcance (identidad, autoservicio, vitrina, integración).
    expect(RUTAS_BRECHA_MATRIZ.length).toBe(12);
    expect(sinAccion.length - RUTAS_BRECHA_MATRIZ.length).toBe(42);
  });

  it('las 12 brechas de §6 no tienen acción y son las del documento', () => {
    expect([...RUTAS_BRECHA_MATRIZ].sort()).toEqual(BRECHAS_MATRIZ);

    const conAccion = RUTAS_BRECHA_MATRIZ.filter((clave) => RUTA_ACCION[clave]?.length > 0);
    expect(
      conAccion.length === 0 ? '' : `brechas que ya tienen accion asignada:\n${conAccion.join('\n')}`,
    ).toBe('');
  });

  it('no queda ninguna brecha de rol de §2 (las cerró T-11)', () => {
    expect([...RUTAS_BRECHA_ROL].sort()).toEqual(BRECHAS_ROL);

    const sinAccion = RUTAS_BRECHA_ROL.filter((clave) => RUTA_ACCION[clave]?.length === 0);
    expect(
      sinAccion.length === 0
        ? ''
        : `brechas de rol sin accion en la matriz:\n${sinAccion.join('\n')}`,
    ).toBe('');
  });

  it('solo las nueve acciones aprobadas sin endpoint quedan sin ruta', () => {
    const referenciadas = new Set(RUTAS.flatMap((clave) => RUTA_ACCION[clave]));
    const desconocidas = [...referenciadas].filter(
      (accion) => !(ACCIONES as readonly string[]).includes(accion),
    );
    expect(desconocidas).toEqual([]);

    const sinRuta = ACCIONES.filter((accion) => !referenciadas.has(accion)).sort();
    expect(sinRuta).toEqual(SIN_RUTA_TODAVIA);
  });
});
