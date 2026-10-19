import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * E1-10 · endurecimiento HTTP: `helmet` y límite de cuerpo de 100 kB.
 *
 * La regla vive en `src/main.ts`, fuera del alcance de cualquier test que
 * arranque el `AppModule` (eso exige base y Redis). Esta guardia la protege
 * sobre el fuente: si alguien quita `helmet()`, el límite o la dependencia,
 * la suite falla antes de que el endurecimiento desaparezca en producción.
 *
 * El comportamiento (cabeceras presentes y 413 con payload excesivo) se
 * verifica además contra el servidor real levantado desde este mismo `main.ts`.
 */
const MAIN = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8');
const PACKAGE = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> };

describe('E1-10 · main.ts endurecido', () => {
  it('aplica helmet a la aplicación', () => {
    expect(MAIN).toMatch(/import helmet from 'helmet';/);
    expect(MAIN).toMatch(/app\.use\(helmet\(\)\);/);
  });

  it('limita el cuerpo JSON y urlencoded a 100 kb', () => {
    expect(MAIN).toMatch(/express\.json\(\{\s*limit:\s*'100kb'\s*\}\)/);
    expect(MAIN).toMatch(
      /express\.urlencoded\(\{\s*limit:\s*'100kb',\s*extended:\s*true\s*\}\)/,
    );
  });

  it('declara las dependencias que el endurecimiento importa', () => {
    expect(PACKAGE.dependencies?.helmet).toBeDefined();
    expect(PACKAGE.dependencies?.express).toBeDefined();
  });
});
