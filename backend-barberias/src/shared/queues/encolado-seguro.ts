/**
 * H62 · Encolado con techo de tiempo (best-effort).
 *
 * POR QUÉ EXISTE (medido, no supuesto): un `try/catch` alrededor de
 * `queue.add()` NO alcanza para que un Redis caído deje de romper el alta de
 * reserva. Hay DOS modos de fallo distintos y solo uno rechaza:
 *
 *  1. Redis responde con error (cuota agotada de Upstash, ACL, OOM…): `add`
 *     RECHAZA y basta con capturarlo.
 *  2. Redis no responde (caído, red cortada, DNS): la conexión se declara
 *     offline y, con `maxRetriesPerRequest: null` —el valor que exige BullMQ y
 *     el que monta `app.module.ts`—, la orden se queda en la cola offline de
 *     ioredis y la promesa NI resuelve NI rechaza. Medido contra un puerto
 *     cerrado: el proceso se quedó colgado hasta que lo mató un `timeout 20` y
 *     nunca imprimió el rechazo. Ese caso, sin techo, deja la petición HTTP
 *     abierta para siempre y con ella la transacción de la reserva (que retiene
 *     sus `FOR UPDATE`).
 *
 * Por eso aquí no se captura solamente: se corre el encolado contra un
 * temporizador y se abandona la espera cuando vence. La orden NO se cancela (no
 * hay forma de sacarla de la cola offline), así que si Redis vuelve el job
 * termina entrando —lo cual es inofensivo—: lo único que se decide al vencer el
 * techo es que la operación de negocio NO espera más a la cola.
 *
 * El contrato es explícito: nunca lanza y siempre devuelve un resultado
 * inspeccionable, para que el llamador decida qué registrar y qué contar.
 */

/**
 * Techo por defecto del encolado. Con Redis sano el `add` local tarda ~47 ms
 * (medido) y contra un Redis remoto unos pocos cientos; 2 s deja margen de sobra
 * para una cola lenta y sigue siendo un límite útil para una cola muerta.
 */
export const ENCOLADO_TIMEOUT_MS = 2000;

export type ResultadoEncolado<T> =
  | { ok: true; valor: T; encoladoEnMs: number }
  | { ok: false; motivo: string; encoladoEnMs: number };

/**
 * Ejecuta `encolar()` con un techo de tiempo y devuelve el resultado en vez de
 * propagar el error.
 *
 * @param encolar   el encolado real (`queue.add(...)`, o una comprobación previa
 *                  seguida del `add`). Su rechazo se convierte en `ok: false`.
 * @param timeoutMs techo en milisegundos; por defecto `ENCOLADO_TIMEOUT_MS`.
 */
export async function encolarConLimite<T>(
  encolar: () => Promise<T>,
  timeoutMs: number = ENCOLADO_TIMEOUT_MS,
): Promise<ResultadoEncolado<T>> {
  const inicio = Date.now();
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  try {
    const limite = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(
        () => rechazar(new Error(`la cola no respondió en ${timeoutMs} ms`)),
        timeoutMs,
      );
      // Un temporizador de diagnóstico no debe mantener vivo el proceso.
      (temporizador as { unref?: () => void }).unref?.();
    });

    // `Promise.race` engancha sus manejadores a AMBAS promesas: si `encolar()`
    // rechaza después de que venció el techo, ese rechazo ya está atendido y no
    // se convierte en un `unhandledRejection`.
    const valor = await Promise.race([encolar(), limite]);

    return { ok: true, valor, encoladoEnMs: Date.now() - inicio };
  } catch (err: unknown) {
    return {
      ok: false,
      motivo: err instanceof Error ? err.message : String(err),
      encoladoEnMs: Date.now() - inicio,
    };
  } finally {
    if (temporizador) {
      clearTimeout(temporizador);
    }
  }
}
