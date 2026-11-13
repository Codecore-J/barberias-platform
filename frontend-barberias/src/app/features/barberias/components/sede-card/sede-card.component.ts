import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { BarberiaResumen } from '../../../../core/services/tenant.service';
import type { MiEstado } from '../../../../core/services/mi-estado.service';
import { qrDeInvitacion, urlDeInvitacion } from '../../../../core/utils/invitacion.util';

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

        <!--
          La invitación es de ESTA sede.

          Vive dentro de la tarjeta, y no en un bloque global sobre la rejilla,
          porque antes el hub pintaba el código de la sede activa —o el de la
          PRIMERA de la lista cuando no había ninguna— encima de todas: parecía
          un QR de plataforma y se compartía el código de otra sede. El código y
          el enlace ya vienen en el propio objeto de la sede (GET /shops los
          entrega a quien administra), así que la tarjeta no pide nada extra.
        -->
        @if (verInvitacion && barberia.codigoAcceso && urlInvitacion) {
          <div class="rounded-2xl border border-amber-500/25 bg-zinc-900/60 p-3.5 space-y-2.5 transform translate-z-12">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                Código de acceso
              </span>
              <button
                (click)="copiar(barberia.codigoAcceso, 'codigo')"
                class="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors flex items-center gap-1"
              >
                <i class="pi pi-copy text-[9px]"></i>
                {{ copiado() === 'codigo' ? 'Copiado' : 'Copiar' }}
              </button>
            </div>

            <code
              class="block w-full px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-amber-400 font-mono text-base tracking-wider text-center"
            >{{ barberia.codigoAcceso }}</code>

            <div class="flex items-center gap-3">
              <img
                [src]="qrInvitacion ?? ''"
                alt="Código QR para unirse a {{ barberia.nombre }}"
                class="w-16 h-16 rounded-lg bg-white p-1 shrink-0"
              >
              <div class="min-w-0 flex-1 space-y-1">
                <span class="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                  Enlace de invitación
                </span>
                <code class="block text-[10px] text-zinc-300 break-all">{{ urlInvitacion }}</code>
                <button
                  (click)="copiar(urlInvitacion, 'enlace')"
                  class="text-[10px] font-semibold text-zinc-400 hover:text-amber-300 transition-colors flex items-center gap-1"
                >
                  <i class="pi pi-copy text-[9px]"></i>
                  {{ copiado() === 'enlace' ? 'Copiado' : 'Copiar enlace' }}
                </button>
              </div>
            </div>
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
  /**
   * Muestra la puerta de entrada de ESTA sede (código + enlace + QR).
   *
   * Lo activa el hub de sedes para el staff que puede verla; el dashboard del
   * cliente la deja en `false`, porque la invitación se comparte, no se consume.
   */
  @Input() verInvitacion = false;

  /** Cuál de los dos botones acaba de copiar (`''` = ninguno). */
  readonly copiado = signal<'' | 'codigo' | 'enlace'>('');

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

  /**
   * El enlace completo se compone con el origen REAL del navegador: el backend
   * no conoce el dominio desde el que se sirve la app, y un QR impreso debe
   * apuntar al host donde la sede opera.
   */
  get urlInvitacion(): string | null {
    const enlace = this.barberia.enlaceUnico;
    return enlace ? urlDeInvitacion(enlace, window.location.origin) : null;
  }

  /** El QR se dibuja en el navegador y viaja como `data:`; no se delega a nadie. */
  get qrInvitacion(): string | null {
    const url = this.urlInvitacion;
    return url ? qrDeInvitacion(url) : null;
  }

  copiar(valor: string | null, cual: 'codigo' | 'enlace'): void {
    if (!valor) return;

    void navigator.clipboard.writeText(valor).then(() => {
      this.copiado.set(cual);
      setTimeout(() => this.copiado.set(''), 2000);
    });
  }
}
