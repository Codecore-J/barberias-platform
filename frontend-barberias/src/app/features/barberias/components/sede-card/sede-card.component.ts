import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { BarberiaResumen } from '../../../../core/services/tenant.service';
import type { MiEstado } from '../../../../core/services/mi-estado.service';

/**
 * H72 · la tarjeta de una sede, extraída para que la pinten las DOS pantallas
 * que listan sedes: `/barberias` (Tus Barberías, con el vínculo y sus acciones)
 * y el home del CLIENTE (su dashboard, con la lista que sirve
 * `GET /mi-estado/barberias`).
 *
 * Sin servicios inyectados a propósito: recibe la sede y el estado del vínculo
 * por `@Input` y deja las acciones al padre por proyección de contenido
 * (`<ng-content>`), así que la misma tarjeta sirve para el cliente (seleccionar,
 * entrar y desvincularse) y para el staff (elegir sede) sin saber de roles.
 */
@Component({
  selector: 'app-sede-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden group hover:-translate-y-4 hover:rotate-y-3 hover:rotate-x-3 transition-all duration-500 shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d"
      [class.border-amber-500]="esActiva"
      [class.shadow-[0_0_30px_rgba(212,175,55,0.2)]]="esActiva"
    >
      <!-- Glow de fondo en hover -->
      <div
        class="absolute -right-20 -bottom-20 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"
      ></div>

      <div class="space-y-6 relative z-10">
        <!-- Header Card -->
        <div class="flex justify-between items-start transform translate-z-12">
          <div
            class="w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/10 group-hover:border-amber-500/30 transition-colors"
          >
            <i class="pi pi-building"></i>
          </div>

          @if (esActiva) {
            <div
              class="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-2"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              ACTIVA
            </div>
          }
        </div>

        <!-- Info -->
        <div class="space-y-2 transform translate-z-24">
          <h3 class="text-2xl font-display font-bold text-white group-hover:text-amber-300 transition-colors">
            {{ barberia.nombre }}
          </h3>
          <p class="text-xs text-zinc-400 flex items-center gap-2">
            <i class="pi pi-map-marker text-amber-500"></i>{{ barberia.ubicacion }}
          </p>
          <p class="text-xs text-zinc-400 flex items-center gap-2">
            <i class="pi pi-phone text-amber-500"></i>{{ barberia.telefono }}
          </p>
        </div>

        <!--
          El vínculo con esta sede. 'estado' llega cuando el padre lo ha
          consultado (H54) y trae el contador y la restricción; 'estadoVinculacion'
          en la propia sede lo sirve ya GET /mi-estado/barberias (H72), así que
          el dashboard del cliente puede anunciar el estado —ACTIVO o
          PENDIENTE_APROBACION— sin una petición extra por sede.
        -->
        @if (mostrarVinculo) {
          <div
            class="rounded-2xl border p-3.5 space-y-1.5 transform translate-z-12"
            [class.border-rose-500/40]="estaRestringido"
            [class.bg-rose-500/10]="estaRestringido"
            [class.border-amber-500/30]="!estaRestringido && pendiente"
            [class.bg-amber-500/10]="!estaRestringido && pendiente"
            [class.border-zinc-700/60]="!estaRestringido && !pendiente"
            [class.bg-zinc-800/40]="!estaRestringido && !pendiente"
          >
            <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
              <span class="text-zinc-400">Tu vínculo</span>
              <span
                [class.text-emerald-400]="estadoVinculacion === 'ACTIVO'"
                [class.text-amber-400]="estadoVinculacion === 'PENDIENTE_APROBACION'"
                [class.text-rose-400]="estadoVinculacion === 'DESVINCULADO'"
              >
                {{ estadoVinculacion }}
              </span>
            </div>

            @if (pendiente) {
              <p class="text-[11px] leading-snug text-amber-300">
                Esperando la aprobación de la plataforma: todavía no puedes reservar en esta sede.
              </p>
            }

            @if (estado) {
              <p class="text-xs text-zinc-300 flex items-center gap-2">
                <i
                  class="pi pi-exclamation-circle"
                  [class.text-rose-400]="estado.estaRestringido"
                  [class.text-amber-400]="!estado.estaRestringido"
                  [class.text-zinc-500]="estado.contadorNoPresentado === 0"
                ></i>
                Inasistencias: {{ estado.contadorNoPresentado }} de {{ estado.limiteInasistencias }}
              </p>
            }

            @if (estado?.mensaje) {
              <p
                class="text-[11px] leading-snug"
                [class.text-rose-300]="estado!.estaRestringido"
                [class.text-amber-300]="!estado!.estaRestringido"
              >
                {{ estado!.mensaje }}
              </p>
            }
          </div>
        }

        <!-- Acciones: las pone cada pantalla (seleccionar, entrar, desvincularse…) -->
        <div class="pt-4 space-y-3 transform translate-z-12">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class SedeCardComponent {
  @Input({ required: true }) barberia!: BarberiaResumen;
  /** Estado de mi-estado (H54) si el padre lo consultó; si no, `null`. */
  @Input() estado: MiEstado | null = null;
  @Input() esActiva = false;

  /** Sin vínculo de cliente que anunciar, el bloque no se pinta (staff). */
  get mostrarVinculo(): boolean {
    return !!this.estado || !!this.barberia.estadoVinculacion;
  }

  get estadoVinculacion(): string {
    return this.estado?.estadoVinculacion ?? this.barberia.estadoVinculacion ?? '';
  }

  get pendiente(): boolean {
    return this.estadoVinculacion === 'PENDIENTE_APROBACION';
  }

  get estaRestringido(): boolean {
    return !!this.estado?.estaRestringido;
  }
}
