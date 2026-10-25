import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * E2-07 · D29 (vocabulario del diseño). Spec 01 §9: «nunca eliminación física
 * para representar un cambio de estado».
 *
 * El backend tenía CUATRO `@Delete` que la incumplían —catálogo de servicios y
 * combos, bloqueos de agenda y el borrado lógico de la sede— y esta prueba
 * impide que vuelvan. No es un grep decorativo: lee el árbol completo de `src/`
 * y reporta cada hallazgo con archivo y línea, para que el fallo diga qué
 * desactivar.
 *
 * Se comprueba en los DOS sentidos: que no hay `@Delete` ni borrados de datos, y
 * que los verbos que los sustituyeron siguen declarados. Quitar las rutas nuevas
 * también rompería el vocabulario que esta tarea entrega.
 *
 * P-SD-5 (2026-10-15) · la guarda vigilaba solo DECORADORES. Una ruta sin
 * `@Delete` podía borrar filas igual, con `prisma.*.delete()`; y el frontend
 * quedaba fuera del radar aunque su vocabulario también es diseño. Ahora cubre
 * los tres niveles:
 *
 *   1. RUTAS      · ningún `@Delete` en los controladores.
 *   2. DATOS      · ninguna llamada `prisma.*.delete/deleteMany` ni `DELETE` por
 *                   SQL crudo, salvo las cuatro excepciones de
 *                   `BORRADOS_AUTORIZADOS`, cada una con su porqué escrito.
 *   3. FRONTEND   · ninguna petición HTTP `DELETE`, y el vocabulario de
 *                   `core/services/` limitado a los alias documentados.
 *
 * La allowlist es EXACTA en los dos sentidos: si el código gana un borrado que
 * no está listado, el test falla; y si una entrada listada ya no corresponde a
 * ningún borrado del código, el test también falla. Una allowlist que solo crece
 * y nunca se comprueba es justo el papel que P-SD-5 vino a retirar.
 */

const RAIZ_SRC = join(process.cwd(), 'src');

/** `frontend-barberias/` es hermano del backend en el mismo repositorio. */
const RAIZ_FRONTEND_APP = join(process.cwd(), '..', 'frontend-barberias', 'src', 'app');
const RAIZ_FRONTEND_SERVICIOS = join(RAIZ_FRONTEND_APP, 'core', 'services');

/**
 * Un motivo de tres palabras no es una justificación. El umbral existe para que
 * «borrado necesario» o «excepción» no puedan ocupar el hueco del porqué.
 */
const MOTIVO_MINIMO = 40;

/**
 * Borrados de datos autorizados, con su porqué. La clave es
 * `ruta/al/archivo.ts:modelo.metodo`, tal y como la compone `borradosDeDatos()`.
 *
 * Se comprobó uno a uno que ninguno representa un cambio de estado sobre una
 * entidad (Spec 01 §9): los cuatro son sustitución de un conjunto, purga por
 * caducidad o mecánica de un movimiento, y ninguno es la forma de «apagar» algo
 * que debería cambiar de estado.
 */
const BORRADOS_AUTORIZADOS: Record<string, string> = {
  'horario/application/horario.service.ts:horario.deleteMany':
    'La rejilla semanal de la sede se guarda como SUSTITUCIÓN completa: se borra la rejilla de esa sede y se insertan las filas nuevas dentro de la MISMA transacción, así que no se pierde ningún estado observable ni hay ventana en que la sede quede sin horario. No es el estado de una entidad, es el conjunto entero.',
  'horario/application/horario.service.ts:horarioBarbero.deleteMany':
    'Mismo caso en la rejilla del barbero (`configureBarberSchedules`): se reemplaza el horario completo del barbero en esa sede dentro de una transacción, y las filas nuevas entran a continuación. Sustitución, no borrado con pérdida.',
  'auditoria/application/auditoria.service.ts:auditoria.deleteMany':
    'Purga por RETENCIÓN (T8.2): el rastro de auditoría no se desactiva, CADUCA. Se eliminan los registros anteriores a la fecha de corte (365 días por defecto) desde un job cron. Es la única forma de que el log no crezca sin límite y no representa un cambio de estado de ninguna entidad.',
  'barberia/application/solicitud-cambio.service.ts:usuarioRol.deleteMany':
    'El rol ADMIN_BARBERIA se MUEVE de un responsable al otro (E3-13): retirar el vínculo del anterior es la mitad del movimiento y va seguido del `upsert` del nuevo en la misma transacción. El filtro `usuarioId: { not: nuevo.id }` deja intacto al entrante, así que el vínculo nunca queda sin dueño.',
};

/**
 * Alias del vocabulario del frontend autorizados, con su porqué. La clave es
 * `archivo.ts:identificador` relativo a `core/services/`.
 */
const VOCABULARIO_FRONTEND_AUTORIZADO: Record<string, string> = {
  'servicios.service.ts:eliminarServicio':
    'Alias del nombre antiguo que delega en `desactivarServicio` (`PATCH .../desactivar`). No borra nada: conserva el nombre solo para no romper las llamadas que ya existen, y el backend responde 422 si la desactivación no procede.',
  'horarios.service.ts:eliminarBloqueo':
    'Alias documentado en el propio método: llama a `POST .../bloqueos/:id/liberar`. El bloqueo no se borra, se LIBERA (fija `liberado_at` y conserva el rastro); lo que no cambia es lo que ve la pantalla, y por eso el nombre se conservó.',
  'tenant.service.ts:removeItem':
    '`localStorage.removeItem` no toca datos de dominio: quita la clave de la sede activa del almacenamiento del NAVEGADOR. El vocabulario del diseño (Spec 01 §9) habla de persistencia del dominio, no de la caché local del cliente.',
};

/** Todas las rutas de archivos que acepta `aceptar`, recorriendo el árbol. */
function archivosBajo(raiz: string, aceptar: (nombre: string) => boolean): string[] {
  const encontrados: string[] = [];

  for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
    const completo = join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      encontrados.push(...archivosBajo(completo, aceptar));
      continue;
    }
    if (!aceptar(entrada.name)) continue;
    if (statSync(completo).size === 0) continue;
    encontrados.push(completo);
  }

  return encontrados;
}

/**
 * Código de producción: `.ts` sin los specs. Los specs quedan fuera a propósito
 * —el E2E limpia sus datos con `prisma.*.deleteMany` y el spec del frontend
 * nombra los métodos que prueba—: lo que esta guarda vigila es lo que se
 * despliega, no las herramientas que lo comprueban.
 */
const esCodigoDeProduccion = (nombre: string) =>
  nombre.endsWith('.ts') && !nombre.endsWith('.spec.ts');

/** Código de producción del backend. */
function archivosFuente(): string[] {
  return archivosBajo(RAIZ_SRC, esCodigoDeProduccion);
}

function rutaRelativa(raiz: string, archivo: string): string {
  return relative(raiz, archivo).replace(/\\/g, '/');
}

interface Linea {
  /** Número de línea real en el archivo, para que el fallo diga dónde mirar. */
  numero: number;
  texto: string;
}

/**
 * Líneas con código, ya recortadas. Los comentarios documentan el cambio de
 * verbo —y citan los nombres antiguos—, así que no cuentan como si declararan
 * algo ni como si un método borrado siguiera existiendo.
 */
function lineasDeCodigo(archivo: string): Linea[] {
  const lineas: Linea[] = [];

  readFileSync(archivo, 'utf8')
    .split(/\r?\n/)
    .forEach((texto, indice) => {
      const recortada = texto.trim();
      if (recortada.startsWith('*') || recortada.startsWith('//') || recortada.startsWith('/*')) return;
      lineas.push({ numero: indice + 1, texto: recortada });
    });

  return lineas;
}

/** `@Delete(...)` declarados en los controladores, con archivo y línea. */
function rutasDelete(): string[] {
  const hallazgos: string[] = [];

  for (const archivo of archivosFuente()) {
    const relativo = rutaRelativa(RAIZ_SRC, archivo);

    for (const { numero, texto } of lineasDeCodigo(archivo)) {
      if (!/@Delete\s*\(/.test(texto)) continue;
      hallazgos.push(`${relativo}:${numero} · ${texto}`);
    }
  }

  return hallazgos;
}

/**
 * Llamadas de borrado de datos: `cliente.modelo.delete(...)` o `...deleteMany(...)`.
 *
 * Se exigen DOS niveles a propósito. El único `.delete(` de un solo nivel de
 * `src/` es el de un `Set` en memoria (`combo-cycle.detector.ts · recursionStack
 * .delete(nodeId)`), que no toca ninguna tabla; cualquier borrado de Prisma —con
 * `this.prisma` o con el alias de la transacción (`tx`)— tiene los dos. El
 * detector es genérico a propósito: si alguien renombra el alias de la
 * transacción, el borrado sigue apareciendo.
 */
const REGEX_BORRADO_DATOS = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.(delete|deleteMany)\s*\(/;

/**
 * `DELETE` por SQL crudo: saltarse Prisma es otra forma de borrar filas, y la
 * guarda no puede vigilar solo el cliente. (Hoy: cero en `src/`.)
 */
const REGEX_DELETE_CRUDO = /\bDELETE\s+FROM\b/i;

interface Borrado {
  /** Clave de allowlist: `ruta.ts:modelo.metodo`. */
  clave: string;
  /** Descripción para el mensaje de fallo: `ruta.ts:linea · modelo.metodo`. */
  detalle: string;
}

function borradosDeDatos(): Borrado[] {
  const hallazgos: Borrado[] = [];

  for (const archivo of archivosFuente()) {
    const relativo = rutaRelativa(RAIZ_SRC, archivo);

    for (const { numero, texto } of lineasDeCodigo(archivo)) {
      const prisma = REGEX_BORRADO_DATOS.exec(texto);

      if (prisma) {
        hallazgos.push({
          clave: `${relativo}:${prisma[2]}.${prisma[3]}`,
          detalle: `${relativo}:${numero} · ${prisma[2]}.${prisma[3]}`,
        });
        continue;
      }

      if (REGEX_DELETE_CRUDO.test(texto)) {
        hallazgos.push({
          clave: `${relativo}:sql-crudo`,
          detalle: `${relativo}:${numero} · SQL crudo · ${texto}`,
        });
      }
    }
  }

  return hallazgos;
}

/** Concatenado de `src/`, para comprobar que los verbos nuevos existen. */
function fuenteCompleta(): string {
  return archivosFuente()
    .map((archivo) => readFileSync(archivo, 'utf8'))
    .join('\n');
}

/** Peticiones HTTP `DELETE` emitidas por el frontend, con archivo y línea. */
const REGEX_HTTP_DELETE = /\bhttp\.delete\s*\(|\.delete\s*</;

function peticionesDeleteDelFrontend(): string[] {
  const hallazgos: string[] = [];

  for (const archivo of archivosBajo(RAIZ_FRONTEND_APP, esCodigoDeProduccion)) {
    const relativo = rutaRelativa(RAIZ_FRONTEND_APP, archivo);

    for (const { numero, texto } of lineasDeCodigo(archivo)) {
      // El verbo en mayúsculas también delata un `delete` montado a mano (por
      // ejemplo con `method: 'DELETE'` o en un interceptor).
      if (!REGEX_HTTP_DELETE.test(texto) && !/['"]DELETE['"]/.test(texto)) continue;
      hallazgos.push(`${relativo}:${numero} · ${texto}`);
    }
  }

  return hallazgos;
}

/**
 * El verbo «eliminar» en identificadores del frontend: `eliminarServicio`,
 * `borrarPantalla`, `deleteRow`, `removeItem`… Se busca sobre los servicios de
 * datos, que son los que hablan con la API.
 */
const REGEX_VERBO_ELIMINAR = /\b(eliminar|borrar|remover|delete|remove)([A-Z][\w$]*)?/g;

function verboEliminarDelFrontend(): Borrado[] {
  const hallazgos = new Map<string, string>();

  for (const archivo of archivosBajo(RAIZ_FRONTEND_SERVICIOS, esCodigoDeProduccion)) {
    const relativo = rutaRelativa(RAIZ_FRONTEND_SERVICIOS, archivo);

    for (const { numero, texto } of lineasDeCodigo(archivo)) {
      for (const coincidencia of texto.matchAll(REGEX_VERBO_ELIMINAR)) {
        const identificador = coincidencia[0];
        const clave = `${relativo}:${identificador}`;
        if (!hallazgos.has(clave)) hallazgos.set(clave, `${relativo}:${numero} · ${identificador}`);
      }
    }
  }

  return [...hallazgos].map(([clave, detalle]) => ({ clave, detalle }));
}

/** Entradas de una allowlist cuyo porqué no llega al mínimo exigido. */
function motivosInsuficientes(allowlist: Record<string, string>): string[] {
  return Object.entries(allowlist)
    .filter(([, motivo]) => motivo.trim().length < MOTIVO_MINIMO)
    .map(([clave, motivo]) => `${clave} · ${motivo.trim().length} caracteres`);
}

/**
 * Comprueba una allowlist contra lo que hay de verdad en el código, en los dos
 * sentidos: lo que aparece sin autorización y lo autorizado que ya no aparece.
 * Devuelve el mensaje de fallo, o cadena vacía si todo cuadra.
 */
function desviacionesDeAllowlist(
  hallazgos: Borrado[],
  allowlist: Record<string, string>,
): string {
  const autorizados = new Set(Object.keys(allowlist));
  const encontrados = new Set(hallazgos.map((hallazgo) => hallazgo.clave));

  const sinAutorizar = hallazgos.filter((hallazgo) => !autorizados.has(hallazgo.clave));
  const obsoletos = [...autorizados].filter((clave) => !encontrados.has(clave));
  const sinMotivo = motivosInsuficientes(allowlist);

  const partes: string[] = [];
  if (sinAutorizar.length > 0) {
    partes.push(
      `borrados sin autorizar (usa un cambio de estado; si de verdad es un borrado legítimo, añádelo a la allowlist CON el porqué):\n${sinAutorizar
        .map((hallazgo) => `  ${hallazgo.detalle}`)
        .join('\n')}`,
    );
  }
  if (obsoletos.length > 0) {
    partes.push(
      `entradas de la allowlist que ya no corresponden a ningún borrado del código (retíralas):\n${obsoletos
        .map((clave) => `  ${clave}`)
        .join('\n')}`,
    );
  }
  if (sinMotivo.length > 0) {
    partes.push(
      `entradas sin porqué suficiente (mínimo ${MOTIVO_MINIMO} caracteres):\n${sinMotivo
        .map((clave) => `  ${clave}`)
        .join('\n')}`,
    );
  }

  return partes.join('\n\n');
}

describe('E2-07 · vocabulario del diseño en el backend', () => {
  it('ninguna ruta se declara `@Delete`', () => {
    const hallazgos = rutasDelete();

    expect(
      hallazgos.length === 0
        ? ''
        : `rutas @Delete que Spec 01 §9 prohíbe (usa PATCH :id/deactivate, PATCH :id/estado o POST :id/release):\n${hallazgos.join('\n')}`,
    ).toBe('');
    // La comprobación de que la allowlist no engorda sin control ya no es «está
    // vacía» (dejó de estarlo al cubrir los borrados de datos de P-SD-5): ahora
    // es la comparación exacta contra el código, en el test de abajo.
  });

  it('los verbos que sustituyeron a `@Delete` siguen declarados', () => {
    const fuente = fuenteCompleta();

    const esperados = [
      // Fase 5 (Punto 5.3): el vocabulario E2-07 viaja ahora en rutas anidadas
      // en inglés (`/shops/:shopId/...`), pero los verbos siguen siendo los mismos.
      "@Patch(':id/deactivate')",
      "@Patch(':id/reactivate')",
      "@Patch(':id/estado')",
      "@Post('blocks/:id/release')",
    ];

    const faltantes = esperados.filter((verbo) => !fuente.includes(verbo));
    expect(
      faltantes.length === 0 ? '' : `verbos E2-07 ausentes:\n${faltantes.join('\n')}`,
    ).toBe('');
  });

  it('ningún borrado de datos sin autorización explícita (prisma.delete / SQL crudo)', () => {
    const hallazgos = borradosDeDatos();

    expect(desviacionesDeAllowlist(hallazgos, BORRADOS_AUTORIZADOS)).toBe('');

    // El test no puede pasar por no haber mirado nada: si el detector dejara de
    // encontrar los cuatro borrados conocidos, la allowlist los delataría como
    // obsoletos, y esto lo deja escrito explícitamente.
    expect(hallazgos.length).toBeGreaterThan(0);
  });
});

describe('E2-07 · vocabulario del diseño en el frontend', () => {
  it('el árbol del frontend está disponible para esta guarda', () => {
    expect(
      existsSync(RAIZ_FRONTEND_APP)
        ? ''
        : `no se encontró el frontend en ${RAIZ_FRONTEND_APP}: la guarda de P-SD-5 vigila también el frontend, así que la suite debe ejecutarse desde el monorepo (el directorio frontend-barberias/ es hermano del backend). Sin él, la guarda no vigilaría nada y pasaría en falso.`,
    ).toBe('');
  });

  it('el frontend no emite ninguna petición HTTP DELETE', () => {
    const hallazgos = peticionesDeleteDelFrontend();

    // Sin allowlist: en el vocabulario del diseño (Spec 01 §9) no existe ningún
    // borrado por HTTP. Desactivar es `PATCH`, liberar es `POST`, y la sede se
    // suspende con `PATCH :id/estado`.
    expect(
      hallazgos.length === 0
        ? ''
        : `peticiones HTTP DELETE en el frontend:\n${hallazgos.map((hallazgo) => `  ${hallazgo}`).join('\n')}`,
    ).toBe('');
  });

  it('los servicios de datos no usan el verbo eliminar salvo alias documentados', () => {
    const hallazgos = verboEliminarDelFrontend();

    expect(desviacionesDeAllowlist(hallazgos, VOCABULARIO_FRONTEND_AUTORIZADO)).toBe('');
    expect(hallazgos.length).toBeGreaterThan(0);
  });
});
