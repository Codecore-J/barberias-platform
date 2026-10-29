import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { PARAM_RETURN_URL, returnUrlSeguro } from '../../core/utils/return-url.util';

/**
 * V2.1 · Pantalla de verificación del teléfono (`/auth/verify`).
 *
 * Una sola cosa hace: pedir un código de 6 dígitos por WhatsApp, comprobarlo y
 * dejar pasar. El envío es automático al entrar (`ngOnInit`), así que quien
 * llega del registro solo tiene que teclear; el botón de reenvío lleva un
 * temporizador de 60 s porque cada envío es un mensaje de WhatsApp real que
 * alguien paga y que además consume el presupuesto de rate limit del backend
 * (3 por minuto por IP).
 *
 * Si la sesión no existe se manda al login, y si el teléfono ya estaba
 * verificado se sale sin esperar: la pantalla es una barrera de paso, no un
 * destino.
 */
@Component({
  selector: 'app-verify-otp',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-ambient-mesh p-4 perspective-1200 overflow-hidden py-12">

      <!-- Fondo Atmosférico (mismo que login y registro) -->
      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div class="absolute top-[10%] -left-[5%] w-[40%] h-[40%] bg-amber-500/10 rounded-full blur-[100px] mix-blend-screen"></div>
        <div class="absolute bottom-[10%] -right-[5%] w-[50%] h-[50%] bg-amber-700/10 rounded-full blur-[120px] mix-blend-screen"></div>
      </div>

      <div class="relative z-10 w-full max-w-md transform-style-3d animate-fade-in-up">

        <div class="glass-panel p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-amber-500/30">

          <div class="text-center space-y-2 mb-8">
            <div class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-amber-700 p-0.5 shadow-[0_0_20px_rgba(212,175,55,0.3)] mb-4">
              <div class="w-full h-full bg-obsidian rounded-[14px] flex items-center justify-center">
                <i class="pi pi-mobile text-amber-400 text-2xl"></i>
              </div>
            </div>
            <h1 class="text-3xl font-display font-extrabold text-white tracking-wide">VERIFICA TU <span class="gold-gradient-text">TELÉFONO</span></h1>
            <p class="text-zinc-400 text-sm">
              Ingresa el código de 6 dígitos que enviamos a tu WhatsApp
            </p>
          </div>

          <form [formGroup]="codigoForm" (ngSubmit)="verificar()" class="space-y-5">

            <div class="space-y-2">
              <label for="codigo" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Código de verificación</label>
              <input id="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                     formControlName="codigo" placeholder="000000"
                     (input)="soloDigitos($event)"
                     class="w-full text-center tracking-[0.6em] text-2xl font-bold bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-4 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner"
                     [ngClass]="{'border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50': codigoForm.get('codigo')?.invalid && codigoForm.get('codigo')?.touched}">
            </div>

            @if (error()) {
              <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-2">
                <i class="pi pi-exclamation-circle text-lg"></i> {{ error() }}
              </div>
            }

            @if (aviso()) {
              <div class="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-2">
                <i class="pi pi-check-circle text-lg"></i> {{ aviso() }}
              </div>
            }

            <div class="pt-1">
              <button type="submit" [disabled]="codigoForm.invalid || verificando()"
                      class="w-full py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_40px_rgba(212,175,55,0.5)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2">
                @if (verificando()) {
                  <i class="pi pi-spin pi-spinner text-lg"></i> Verificando...
                } @else {
                  Verificar <i class="pi pi-check"></i>
                }
              </button>
            </div>

            <div class="flex items-center justify-between pt-1 text-xs">
              <button type="button" (click)="enviar()" [disabled]="!puedeReenviar()"
                      class="text-amber-400 font-bold hover:text-amber-300 disabled:text-zinc-600 disabled:cursor-not-allowed hover:underline underline-offset-4 transition-colors">
                @if (enviando()) {
                  <span><i class="pi pi-spin pi-spinner"></i> Enviando...</span>
                } @else if (segundosRestantes() > 0) {
                  Reenviar en {{ segundosRestantes() }} s
                } @else {
                  Reenviar código
                }
              </button>
              <a routerLink="/auth/login" class="text-zinc-500 hover:text-zinc-300 transition-colors">Cambiar de cuenta</a>
            </div>

          </form>

          <p class="mt-6 text-center text-[11px] text-zinc-600">
            No recibes el mensaje? Revisa que el número de tu perfil esté bien escrito o vuelve a intentarlo en unos segundos.
          </p>

        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .animate-fade-in-up {
        animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes fadeInUp {
        0% {
          opacity: 0;
          transform: translateY(30px) scale(0.95);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `,
  ],
})
export class VerifyOtpComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly authService = inject(AuthService);

  /** V2.1 · ruta pedida antes de caer en verificación, para volverla al acabar. */
  readonly returnUrl = this.route.snapshot.queryParamMap.get(PARAM_RETURN_URL);

  readonly enviando = signal(false);
  readonly verificando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly segundosRestantes = signal(0);

  /** El reenvío solo se habilita cuando no hay nada en vuelo y el temporizador llegó a cero. */
  readonly puedeReenviar = computed(
    () => !this.enviando() && !this.verificando() && this.segundosRestantes() === 0,
  );

  private temporizador: ReturnType<typeof setInterval> | null = null;

  /** Un solo campo de 6 dígitos con validación, en vez de seis inputs: mismo contrato y un solo focus. */
  codigoForm = this.fb.group({
    codigo: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  ngOnInit(): void {
    if (!this.authService.getToken()) {
      this.router.navigate(['/auth/login']);
      return;
    }

    // Al cargar se comprueba el estado REAL de la cuenta: si el teléfono ya
    // estaba verificado no se pide código (evita un envío inútil de WhatsApp) y
    // se sale directo. La hidratación es la misma `GET /me` compartida que ya
    // disparó el AuthService, así que un F5 no duplica la petición.
    this.authService.cargarSesion().subscribe((usuario) => {
      if (usuario?.telefonoVerificado) {
        this.entrar();
        return;
      }
      this.enviar();
    });
  }

  ngOnDestroy(): void {
    this.detenerTemporizador();
  }

  /** Deja solo dígitos: pegar "123-456" o con espacios queda como 123456. */
  soloDigitos(event: Event): void {
    const input = event.target as HTMLInputElement;
    const limpio = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value !== limpio) {
      input.value = limpio;
    }
    this.codigoForm.get('codigo')?.setValue(limpio, { emitEvent: false });
  }

  enviar(): void {
    if (!this.puedeReenviar()) {
      return;
    }

    this.enviando.set(true);
    this.error.set(null);

    this.authService.sendOtp('TELEFONO').subscribe({
      next: (respuesta) => {
        this.enviando.set(false);
        this.aviso.set(respuesta.mensaje);
        this.iniciarTemporizador(60);
      },
      error: (e) => {
        this.enviando.set(false);
        this.error.set(e?.error?.mensaje ?? 'No se pudo enviar el código. Inténtalo de nuevo.');
      },
    });
  }

  verificar(): void {
    if (this.codigoForm.invalid) {
      this.codigoForm.markAllAsTouched();
      return;
    }

    this.verificando.set(true);
    this.error.set(null);
    this.aviso.set(null);

    const codigo = this.codigoForm.get('codigo')?.value ?? '';

    this.authService.verifyOtp(codigo, 'TELEFONO').subscribe({
      next: () => {
        this.verificando.set(false);
        this.aviso.set('¡Teléfono verificado! Ya puedes reservar.');
        // Breve pausa para que la persona vea la confirmación antes de salir.
        setTimeout(() => this.entrar(), 700);
      },
      error: (e) => {
        this.verificando.set(false);
        this.error.set(e?.error?.mensaje ?? 'El código no es válido o ya expiró.');
        this.codigoForm.reset({ codigo: '' });
      },
    });
  }

  /** V2.1 · al salir se retoma la ruta que había pedido, o el panel principal. */
  private entrar(): void {
    this.router.navigateByUrl(returnUrlSeguro(this.returnUrl) ?? '/');
  }

  private iniciarTemporizador(segundos: number): void {
    this.detenerTemporizador();
    this.segundosRestantes.set(segundos);
    this.temporizador = setInterval(() => {
      const restantes = this.segundosRestantes() - 1;
      this.segundosRestantes.set(Math.max(restantes, 0));
      if (restantes <= 0) {
        this.detenerTemporizador();
      }
    }, 1000);
  }

  private detenerTemporizador(): void {
    if (this.temporizador) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }
}
