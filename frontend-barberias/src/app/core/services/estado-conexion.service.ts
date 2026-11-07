import { Injectable, computed, signal } from '@angular/core';

/**
 * Estado global de conectividad con el backend.
 *
 * Hoy tiene un único hecho que comunicar: el backend está tardando en responder
 * porque la instancia estaba dormida (plan gratuito de Render, ~15 min de
 * inactividad). El cron `.github/workflows/keep-alive.yml` lo mantiene caliente;
 * esto es la red de seguridad para cuando el cron falla, el repositorio lleva
 * días sin actividad o el cron de GitHub se retrasa.
 *
 * El conteo es de peticiones LENTAS en vuelo, no de un booleano: si tres
 * llamadas salen a la vez y las tres tardan, la primera que responda no debe
 * apagar el aviso mientras las otras dos siguen esperando.
 */
@Injectable({ providedIn: 'root' })
export class EstadoConexionService {
  /** Peticiones que superaron el umbral y aún no han terminado. */
  private readonly lentasEnVuelo = signal(0);

  /** `true` mientras haya al menos una petición lenta pendiente. */
  readonly backendDespertando = computed(() => this.lentasEnVuelo() > 0);

  /** Una petición cruzó el umbral: se muestra el aviso. */
  marcarDespertando(): void {
    this.lentasEnVuelo.update((n) => n + 1);
  }

  /** Esa misma petición terminó (éxito o error): se descuenta. */
  marcarListo(): void {
    this.lentasEnVuelo.update((n) => Math.max(0, n - 1));
  }

  /** Corte de sesión o navegación dura: no arrastrar avisos huérfanos. */
  reiniciar(): void {
    this.lentasEnVuelo.set(0);
  }
}
