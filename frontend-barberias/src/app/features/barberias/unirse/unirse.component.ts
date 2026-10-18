import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TenantService } from '../../../core/services/tenant.service';
import { parsearInvitacion } from '../../../core/utils/invitacion.util';

/**
 * E3-12/2 · el destino del QR y del enlace único (regla 1.10).
 *
 * Es la mitad que faltaba para que un enlace sirva de algo: quien lo abre NO
 * tiene que saber que existe un código, ni un formulario. La pantalla toma el
 * enlace de la propia URL, crea el vínculo y cuenta lo que devolvió el backend.
 *
 * Límite conocido y deliberado: vive dentro del layout y bajo `authGuard`, así
 * que un enlace abierto SIN sesión lleva al login —la pantalla que lo recibe dice
 * lo mismo con sus palabras— y hoy no se conserva la URL para volver a ella tras
 * entrar. Para quien ya tiene cuenta —el caso del QR impreso en el mostrador— el
 * ciclo se completa de una sola vez.
 */
@Component({
  selector: 'app-unirse',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center p-4 bg-ambient-mesh">
      <div
        class="glass-panel relative w-full max-w-md rounded-3xl p-8 border border-amber-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-center space-y-5"
      >
        <div
          class="w-16 h-16 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-3xl"
        >
          <i class="pi" [ngClass]="estado() === 'uniendo' ? 'pi-spin pi-spinner' : icono()"></i>
        </div>

        <h1 class="text-2xl font-display font-bold text-white">{{ titulo() }}</h1>
        <p class="text-sm text-zinc-400">{{ mensaje() }}</p>

        @if (enlaceUnico(); as enlace) {
          <p class="text-[11px] text-zinc-500 font-mono break-all">Invitación: {{ enlace }}</p>
        }

        @if (estado() !== 'uniendo') {
          <div class="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
            <a
              routerLink="/barberias"
              class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform"
            >
              Ver mis barberías
            </a>
            <a
              routerLink="/"
              class="px-6 py-3 rounded-xl font-semibold text-sm text-zinc-300 bg-white/5 border border-zinc-700/60 hover:border-amber-500/40 hover:text-amber-300 transition-colors"
            >
              Ir al inicio
            </a>
          </div>
        }
      </div>
    </div>
  `,
})
export class UnirseComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly tenantService = inject(TenantService);

  readonly estado = signal<'uniendo' | 'activo' | 'pendiente' | 'error'>('uniendo');
  readonly mensaje = signal('Estamos validando tu invitación…');
  readonly enlaceUnico = signal('');

  ngOnInit(): void {
    const parametro = this.route.snapshot.paramMap.get('enlaceUnico');
    const puerta = parsearInvitacion(parametro);

    if (!puerta) {
      this.estado.set('error');
      this.mensaje.set('Ese enlace no trae una invitación válida. Pide que te la compartan de nuevo.');
      return;
    }

    this.enlaceUnico.set(puerta.enlaceUnico ?? puerta.codigoAcceso ?? '');

    // La invitación se consume ENTERA en el backend: aquí no hay lógica de
    // vinculación, solo el resultado que devuelve (D10 incluido).
    this.tenantService.unirsePorInvitacion(puerta).subscribe({
      next: (vinculo) => {
        if (vinculo.estadoVinculacion === 'PENDIENTE_APROBACION') {
          this.estado.set('pendiente');
          this.mensaje.set(
            'Tu vínculo quedó en espera de aprobación: ya tienes cinco barberías y la plataforma tiene que autorizar la sexta (D10).',
          );
          return;
        }

        this.estado.set('activo');
        this.mensaje.set('¡Listo! Ya eres cliente de la barbería y puedes reservar en ella.');
      },
      error: () => {
        this.estado.set('error');
        this.mensaje.set(
          this.tenantService.error() ?? 'No se pudo usar esta invitación. Puede que la sede ya no esté activa.',
        );
      },
    });
  }

  titulo(): string {
    switch (this.estado()) {
      case 'uniendo':
        return 'Validando tu invitación';
      case 'activo':
        return '¡Bienvenido!';
      case 'pendiente':
        return 'Solicitud en espera';
      default:
        return 'No pudimos usar la invitación';
    }
  }

  icono(): string {
    switch (this.estado()) {
      case 'activo':
        return 'pi-check-circle';
      case 'pendiente':
        return 'pi-clock';
      default:
        return 'pi-exclamation-triangle';
    }
  }
}
