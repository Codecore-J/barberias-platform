import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D48 (E4-03/5) · el contador de inasistencias de una sede NO puede suspender
 * una cuenta, y suspenderla es una decisión MANUAL del ADMINISTRADOR.
 *
 * Esta prueba lo comprueba sobre el CÓDIGO FUENTE, no sobre el comportamiento de
 * un caso: busca las ESCRITURAS de `estadoCuenta` (propiedades asignadas en un
 * `data:` de Prisma) en todo `src/` y exige que solo existan en los dos sitios
 * autorizados. Un camino automático nuevo —por ejemplo «5 inasistencias y
 * suspendo la cuenta»— hace fallar esta prueba aunque sus tests de negocio pasen.
 *
 * No es un grep decorativo: se lee el árbol completo y cada escritura se reporta
 * con archivo y línea para que el fallo diga qué desactivar.
 */

const RAIZ_SRC = join(process.cwd(), 'src');

/** Sitios autorizados a escribir `usuarios.estado_cuenta`, con su porqué. */
const ESCRITORES_AUTORIZADOS: Record<string, string> = {
  'iam/application/auth.service.ts':
    'alta de la cuenta: el registro nace ACTIVO (nunca otro estado)',
  'iam/application/usuarios-plataforma.service.ts':
    'suspensión/reactivación manual del ADMINISTRADOR (D09/D24), auditada',
};

/** Todas las rutas de archivos `.ts` de `src/`, sin los specs. */
function archivosFuente(directorio: string): string[] {
  const encontrados: string[] = [];

  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const completo = join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      encontrados.push(...archivosFuente(completo));
      continue;
    }
    if (!entrada.name.endsWith('.ts') || entrada.name.endsWith('.spec.ts')) continue;
    if (statSync(completo).size === 0) continue;
    encontrados.push(completo);
  }

  return encontrados;
}

/** Líneas que ESCRIBEN `estadoCuenta` (no las que lo leen ni lo comparan). */
function escriturasDeEstadoCuenta(): { archivo: string; linea: number; texto: string }[] {
  const escrituras: { archivo: string; linea: number; texto: string }[] = [];

  for (const archivo of archivosFuente(RAIZ_SRC)) {
    const lineas = readFileSync(archivo, 'utf8').split(/\r?\n/);

    lineas.forEach((texto, indice) => {
      const recortada = texto.trim();
      // Las líneas de comentario documentan el estado, no lo escriben.
      if (recortada.startsWith('*') || recortada.startsWith('//') || recortada.startsWith('/*')) {
        return;
      }

      const sinComentario = texto.replace(/\/\/.*$/, '');

      // Asignación suelta: `estadoCuenta = 'SUSPENDIDO'` (nunca una comparación).
      const asignacion = /\bestadoCuenta\s*=(?!=)/.exec(sinComentario);
      // Propiedad de un objeto: `estadoCuenta: <algo>`.
      const propiedad = /\bestadoCuenta\s*:\s*(\S+)/.exec(sinComentario);

      if (!asignacion && !propiedad) return;

      if (propiedad && !asignacion) {
        const valor = propiedad[1].replace(/[,;]$/, '');
        // `select: { estadoCuenta: true }` es una LECTURA de Prisma.
        if (valor === 'true' || valor === 'false') return;
        // `estadoCuenta: string` es un tipo.
        if (valor === 'string') return;
        // Una UNION de tipos (`'ACTIVO' | 'SUSPENDIDO'`) es una declaración de
        // DTO/interfaz. Un literal suelto (`estadoCuenta: 'ACTIVO'`) SÍ escribe.
        const resto = sinComentario.slice((propiedad.index ?? 0) + propiedad[0].length);
        if (valor.endsWith('|') || /^[^;{}]*\|/.test(resto)) return;
      }

      escrituras.push({
        archivo: relative(RAIZ_SRC, archivo).replace(/\\/g, '/'),
        linea: indice + 1,
        texto: recortada,
      });
    });
  }

  return escrituras;
}

describe('D48 · quién puede escribir `usuarios.estado_cuenta`', () => {
  it('solo el alta de la cuenta y la suspensión manual auditada', () => {
    const escrituras = escriturasDeEstadoCuenta();
    const archivos = [...new Set(escrituras.map((e) => e.archivo))].sort();

    const informe = escrituras.map((e) => `${e.archivo}:${e.linea} · ${e.texto}`).join('\n');

    expect(
      archivos.length > 0 ? '' : 'no se encontró ninguna escritura de estadoCuenta: revisar el patrón',
    ).toBe('');

    const noAutorizados = archivos.filter((archivo) => !(archivo in ESCRITORES_AUTORIZADOS));
    expect(
      noAutorizados.length === 0
        ? ''
        : `escrituras de estado_cuenta fuera de los caminos autorizados:\n${noAutorizados.join('\n')}\n\n--- detalle ---\n${informe}`,
    ).toBe('');

    // Y al revés: los autorizados siguen existiendo (si un archivo se renombra,
    // la lista de arriba deja de ser cierta).
    const faltantes = Object.keys(ESCRITORES_AUTORIZADOS).filter(
      (archivo) => !archivos.includes(archivo),
    );
    expect(
      faltantes.length === 0
        ? ''
        : `los escritores autorizados ya no escriben (¿se movieron?):\n${faltantes.join('\n')}`,
    ).toBe('');
  });
});
