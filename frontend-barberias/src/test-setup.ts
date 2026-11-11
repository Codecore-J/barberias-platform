/**
 * Node 26 expone `localStorage` y `sessionStorage` como globales propios
 * (getters que devuelven `undefined` si no se arrancó con
 * `--localstorage-file`). En Vitest el `globalThis` del entorno jsdom ES el
 * `window` del entorno, así que ese getter de Node pisa el Storage de jsdom y
 * los specs ven `undefined`.
 *
 * Este archivo se ejecuta después de que el builder inicialice jsdom y el
 * TestBed. Si el Storage del entorno no está disponible, se instala uno en
 * memoria con la API de `Storage`; vive en el entorno de cada archivo de spec,
 * de modo que el aislamiento es el mismo que en CI (Node 22 + jsdom).
 */
class StorageEnMemoria implements Storage {
  readonly #datos = new Map<string, string>();

  get length(): number {
    return this.#datos.size;
  }

  clear(): void {
    this.#datos.clear();
  }

  getItem(clave: string): string | null {
    const valor = this.#datos.get(String(clave));
    return valor === undefined ? null : valor;
  }

  key(indice: number): string | null {
    return [...this.#datos.keys()][indice] ?? null;
  }

  removeItem(clave: string): void {
    this.#datos.delete(String(clave));
  }

  setItem(clave: string, valor: string): void {
    this.#datos.set(String(clave), String(valor));
  }
}

const ventana = globalThis.window as Window | undefined;

if (ventana && typeof ventana.localStorage === 'undefined') {
  for (const clave of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, clave, {
      configurable: true,
      enumerable: true,
      value: new StorageEnMemoria(),
    });
  }
}
