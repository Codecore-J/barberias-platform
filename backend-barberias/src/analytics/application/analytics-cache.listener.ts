import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Keyv } from 'keyv';
import { CACHE_STORE } from '../../shared/cache/app-cache.module.js';
import {
  PREFIJO_ANALITICAS_OVERVIEW,
  prefijoDeSede,
} from '../domain/cache-keys.js';

/** Lo mínimo que necesita la purga: el evento trae la sede afectada. */
interface EventoConSede {
  barberiaId?: string;
}

/**
 * Invalidación del caché de analíticas.
 *
 * Se suscribe a TODO `reserva.*` y no solo a la confirmación y la cancelación
 * porque cada hecho mueve alguna cifra del panel: el alta suma una cita
 * pendiente, la confirmación la reasigna de estado, la inasistencia cambia la
 * tasa, el recordatorio incrementa `recordatoriosEnviados`. Suscribirse solo a
 * dos dejaría el resto de métricas desfasadas hasta 15 minutos.
 *
 * `ReservaService` emite con `emit()` —sin `await`—, así que un fallo aquí se
 * perdería como *unhandled rejection*; de ahí el `try/catch` interno y el
 * `suppressErrors` del decorador.
 */
@Injectable()
export class AnalyticsCacheListener {
  private readonly logger = new Logger(AnalyticsCacheListener.name);

  constructor(@Inject(CACHE_STORE) private readonly store: Keyv) {}

  @OnEvent('reserva.*', { suppressErrors: true })
  async alOcurrirEventoDeReserva(evento: EventoConSede): Promise<void> {
    const barberiaId = evento?.barberiaId;
    if (!barberiaId) return;

    // Primero la sede: es la clave que el panel consulta más.
    await this.purgarPorPrefijo(prefijoDeSede(barberiaId));
    // El overview agrega varias sedes, así que cualquier cambio en una de ellas
    // invalida el consolidado de todos sus administradores.
    await this.purgarPorPrefijo(PREFIJO_ANALITICAS_OVERVIEW);
  }

  /**
   * Borra las entradas cuya clave empieza por `prefijo`.
   *
   * `CACHE_MANAGER` no expone listado de claves —solo lectura por clave— así que
   * se recorre el `Keyv` que hay debajo: en memoria itera el `Map` y en Redis
   * usa `SCAN`, nunca `KEYS`. El conjunto de claves de analíticas está acotado
   * por (sedes × combinaciones de rango), de modo que el recorrido es corto.
   *
   * Si el prefijo no tiene entradas no se llama a `deleteMany`: el caso normal
   * de un evento sobre una sede que nadie está mirando no debe costar un viaje
   * de escritura.
   */
  private async purgarPorPrefijo(prefijo: string): Promise<void> {
    try {
      const claves: string[] = [];
      for await (const [clave] of this.store.iterator()) {
        if (typeof clave === 'string' && clave.startsWith(prefijo)) {
          claves.push(clave);
        }
      }

      if (claves.length === 0) return;

      await this.store.deleteMany(claves);
      this.logger.debug(`Purgadas ${claves.length} entradas de caché (${prefijo}).`);
    } catch (error) {
      this.logger.warn(
        `No se pudo invalidar el caché de ${prefijo}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
