import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * E2-07 · D29 (vocabulario del diseño). Spec 01 §9: «nunca eliminación física
 * para representar un cambio de estado».
 *
 * El backend tenía CUATRO `@Delete` que la incumplían —catálogo de servicios y
 * combos, bloqueos de agenda y el borrado lógico de la sede— y esta prueba
 * impide que vuelvan. No es un grep decorativo: lee el árbol completo de `src/`
 * y reporta cada `@Delete` con archivo y línea, para que el fallo diga qué
 * desactivar.
 *
 * Se comprueba en los DOS sentidos: que no hay `@Delete` y que los verbos que lo
 * sustituyeron siguen declarados. Quitar las rutas nuevas también rompería el
 * vocabulario que esta tarea entrega.
 */

const RAIZ_SRC = join(process.cwd(), 'src');

/** Borrados definitivos autorizados, con su porqué. (Hoy: ninguno.) */
const BORRADOS_AUTORIZADOS: Record<string, string> = {};

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

/** `@Delete(...)` declarados en los controladores, con archivo y línea. */
function rutasDelete(): string[] {
  const hallazgos: string[] = [];

  for (const archivo of archivosFuente(RAIZ_SRC)) {
    const relativo = relative(RAIZ_SRC, archivo).replace(/\\/g, '/');

    readFileSync(archivo, 'utf8')
      .split(/\r?\n/)
      .forEach((texto, indice) => {
        const recortada = texto.trim();
        // Los comentarios documentan el cambio de verbo; no son rutas.
        if (recortada.startsWith('*') || recortada.startsWith('//') || recortada.startsWith('/*')) return;
        if (!/@Delete\s*\(/.test(texto)) return;
        hallazgos.push(`${relativo}:${indice + 1} · ${recortada}`);
      });
  }

  return hallazgos;
}

/** Concatenado de `src/`, para comprobar que los verbos nuevos existen. */
function fuenteCompleta(): string {
  return archivosFuente(RAIZ_SRC)
    .map((archivo) => readFileSync(archivo, 'utf8'))
    .join('\n');
}

describe('E2-07 · vocabulario del diseño en el backend', () => {
  it('ninguna ruta se declara `@Delete`', () => {
    const hallazgos = rutasDelete();

    expect(
      hallazgos.length === 0
        ? ''
        : `rutas @Delete que Spec 01 §9 prohíbe (usa PATCH :id/desactivar, PATCH :id/estado o POST :id/liberar):\n${hallazgos.join('\n')}`,
    ).toBe('');
    expect(Object.keys(BORRADOS_AUTORIZADOS)).toHaveLength(0);
  });

  it('los verbos que sustituyeron a `@Delete` siguen declarados', () => {
    const fuente = fuenteCompleta();

    const esperados = [
      "@Patch(':id/desactivar')",
      "@Patch(':id/reactivar')",
      "@Patch(':id/estado')",
      "@Post('bloqueos/:id/liberar')",
    ];

    const faltantes = esperados.filter((verbo) => !fuente.includes(verbo));
    expect(
      faltantes.length === 0 ? '' : `verbos E2-07 ausentes:\n${faltantes.join('\n')}`,
    ).toBe('');
  });
});
