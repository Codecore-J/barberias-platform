import { Component, DestroyRef, inject, isDevMode, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { AuthService } from '../auth.service';
import { CommonModule } from '@angular/common';
import { PARAM_RETURN_URL } from '../../core/utils/return-url.util';
import { mensajeDeError } from '../../core/utils/error-message';
import { API_URL } from '../../core/constants/api.constants';

import { ModalShellComponent } from '../../shared/ui/modal-shell/modal-shell.component';

/**
 * T-26 · a partir de aquí la espera deja de parecer un cuelgue.
 *
 * El backend vive en Render Free: tras un rato sin tráfico el servicio se
 * duerme y la primera petición tarda ~40 s en despertarlo. Ocho segundos es el
 * punto donde el usuario ya cree que el botón no responde.
 */
const UMBRAL_AVISO_ESPERA_MS = 8000;

/**
 * F8 / T-83 · tiempos de la sonda de vida del backend.
 *
 * - 3 s es el plazo para considerar que el servidor no está despierto. Por
 *   debajo, una red móvil lenta pintaría el aviso sin motivo.
 * - El reintento es de 5 s: el arranque de Render tarda decenas de segundos y no
 *   tiene sentido sondear más a menudo.
 * - A los 90 s se deja de intentar y se dice la verdad en vez de seguir
 *   esperando un servidor que no va a responder.
 */
const SONDA_PLAZO_MS = 3000;
const SONDA_REINTENTO_MS = 5000;
const SONDA_LIMITE_MS = 90_000;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ModalShellComponent],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-ambient-mesh p-4 perspective-1200 overflow-hidden">
      
      <!-- Fondo Atmosférico extra -->
      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-amber-500/10 rounded-full blur-[120px] mix-blend-screen"></div>
        <div class="absolute bottom-[0%] -right-[10%] w-[60%] h-[60%] bg-amber-700/10 rounded-full blur-[150px] mix-blend-screen"></div>
      </div>

      <div class="relative z-10 w-full max-w-md transform-style-3d animate-fade-in-up">
        
        <!-- Tarjeta de Login -->
        <div class="glass-panel p-8 sm:p-10 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-amber-500/30 transform translate-z-12 hover:rotate-y-2 hover:rotate-x-2 transition-transform duration-500">
          
          <div class="text-center space-y-2 mb-10 transform translate-z-8">
            <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-amber-700 p-0.5 shadow-[0_0_20px_rgba(212,175,55,0.3)] mb-4">
              <div class="w-full h-full bg-obsidian rounded-[14px] flex items-center justify-center">
                <i class="pi pi-sparkles text-amber-400 text-3xl"></i>
              </div>
            </div>
            <h1 class="text-3xl font-display font-extrabold text-white tracking-wide">IMPERIAL <span class="gold-gradient-text">BARBERS</span></h1>
            <p class="text-zinc-400 text-sm">Bienvenido de vuelta. Ingresa a tu cuenta.</p>
          </div>

          @if (!showRecoveryModal()) {
          <form id="login-form" [formGroup]="loginForm" (ngSubmit)="onSubmit()" novalidate class="space-y-6 transform translate-z-12">
            
            <div class="space-y-2">
              <label for="correo" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Correo Electrónico</label>
              <div class="relative group">
                <i class="pi pi-envelope absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors"></i>
                <input id="correo" name="correo" type="email" autocomplete="email" formControlName="correo" placeholder="tu@correo.com"
                       class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3.5 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
              </div>
            </div>

            <div class="space-y-2">
              <label for="password" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Contraseña</label>
              <div class="relative group">
                <i class="pi pi-lock absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors"></i>
                <input id="password" name="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password" formControlName="password" placeholder="••••••••"
                       class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3.5 pl-12 pr-12 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                <button type="button" (click)="togglePassword()" aria-label="Mostrar u ocultar contraseña" class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-amber-400 focus:outline-none">
                  <i class="pi" [ngClass]="showPassword() ? 'pi-eye-slash' : 'pi-eye'"></i>
                </button>
              </div>
            </div>

            <div class="flex items-center justify-end -mt-1">
              <button type="button" (click)="openRecoveryModal()" class="text-xs text-amber-400/90 hover:text-amber-300 hover:underline underline-offset-2 transition-colors cursor-pointer">
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            @if (authService.authState().error) {
              <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3 animate-shake flex items-center gap-2">
                <i class="pi pi-exclamation-circle"></i> {{ authService.authState().error }}
              </div>
            }

            <button type="submit" [disabled]="loginForm.invalid || authService.authState().isLoading || servidorDespertando() || servidorNoDisponible()"
                    class="w-full py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_40px_rgba(212,175,55,0.5)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2 cursor-pointer">
              @if (authService.authState().isLoading) {
                <i class="pi pi-spin pi-spinner text-lg"></i> Ingresando...
              } @else {
                Iniciar Sesión <i class="pi pi-arrow-right"></i>
              }
            </button>

            <!--
              T-26 · cold start de Render Free: el botón ya se bloquea y dice
              «Ingresando…», pero a los pocos segundos eso parece un cuelgue. Se
              explica qué está pasando para que nadie recargue ni pulse de nuevo.
            -->
            <!--
              F8 / T-83 · el backend de Render Free tarda hasta 60 s en despertar.
              Se dice antes de que el usuario pulse, y el envío queda bloqueado
              mientras el banner esté visible.
            -->
            @if (servidorDespertando()) {
              <p id="aviso-servidor-despertando"
                 data-testid="aviso-servidor"
                 role="status" aria-live="polite"
                 class="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 flex items-start gap-2">
                <i class="pi pi-spin pi-spinner mt-0.5"></i>
                <span>
                  Despertando el servidor, puede tardar hasta 60 segundos. Por favor espera.
                </span>
              </p>
            }

            @if (servidorNoDisponible()) {
              <p id="aviso-servidor-no-disponible"
                 role="alert"
                 class="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 flex flex-col gap-2">
                <span><i class="pi pi-exclamation-triangle mr-1"></i>El servidor no está disponible. Intenta de nuevo en unos minutos.</span>
                <button type="button" (click)="reintentarConexion()"
                        class="self-start px-3 py-1.5 rounded-lg text-[11px] font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 transition-colors cursor-pointer">
                  Reintentar
                </button>
              </p>
            }

            @if (esperaProlongada()) {
              <p class="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 flex items-start gap-2"
                 role="status" aria-live="polite">
                <i class="pi pi-clock mt-0.5"></i>
                <span>
                  El servidor está despertando (la primera carga tras un rato inactivo puede
                  tardar hasta un minuto). No cierres esta página: el inicio de sesión sigue
                  en curso.
                </span>
              </p>
            }
            
          </form>
          }

          <!--
            Acceso Rápido Demo · SOLO desarrollo.
            Estas cuentas las crea prisma/seed-demo-users.ts, que por E0-07 solo
            corre con APP_ENV=dev: en producción no existen, así que pintar los
            botones allí solo ofrecía credenciales que devuelven 401. isDevMode()
            es false en el build de producción, de modo que el bloque ni se crea.
          -->
          @if (esModoDesarrollo) {
            <div class="mt-6 pt-5 border-t border-zinc-800/80 text-center transform translate-z-8">
              <p class="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-2.5">Acceso Rápido Demo</p>
              <div class="flex flex-wrap items-center justify-center gap-2">
                <button type="button" (click)="fillDemo('cliente@demo.com')" class="px-2.5 py-1 text-xs rounded-lg bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-400 border border-zinc-700/60 hover:border-amber-500/40 transition-colors cursor-pointer">
                  👤 Cliente
                </button>
                <button type="button" (click)="fillDemo('barbero@demo.com')" class="px-2.5 py-1 text-xs rounded-lg bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-400 border border-zinc-700/60 hover:border-amber-500/40 transition-colors cursor-pointer">
                  ✂️ Barbero
                </button>
                <button type="button" (click)="fillDemo('admin@demo.com')" class="px-2.5 py-1 text-xs rounded-lg bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-400 border border-zinc-700/60 hover:border-amber-500/40 transition-colors cursor-pointer">
                  ⚡ Admin
                </button>
              </div>
            </div>
          }

          <div class="mt-6 text-center transform translate-z-8">
            <p class="text-zinc-500 text-sm">
              ¿No tienes una cuenta? 
              <a routerLink="/auth/register" [queryParams]="queryParamsDelRetorno" class="text-amber-400 font-bold hover:text-amber-300 hover:underline underline-offset-4 ml-1 transition-colors">
                Regístrate aquí
              </a>
            </p>
          </div>

        </div>

        <!-- Modal de Recuperación de Contraseña (SEC-01) -->
        <app-modal-shell
          [visible]="showRecoveryModal()"
          titulo="Recuperar Contraseña"
          [subtitulo]="
            recoveryStep() === 1
              ? 'Ingresa tu correo para recibir un enlace/token de restablecimiento.'
              : 'Ingresa el token recibido y tu nueva contraseña.'
          "
          icono="pi pi-key"
          [cerrarBloqueado]="isRecoveryLoading()"
          (cerrar)="closeRecoveryModal()">
          @if (showRecoveryModal()) {
              @if (recoverySuccessMsg()) {
                <div class="mb-4 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-2">
                  <i class="pi pi-check-circle text-base"></i> {{ recoverySuccessMsg() }}
                </div>
              }

              @if (recoveryErrorMsg()) {
                <div class="mb-4 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-2">
                  <i class="pi pi-exclamation-triangle text-base"></i> {{ recoveryErrorMsg() }}
                </div>
              }

              @if (recoveryStep() === 1) {
                <form id="recovery-form" [formGroup]="forgotForm" (ngSubmit)="onForgotSubmit()" novalidate class="space-y-4">
                  <div class="space-y-1.5">
                    <label for="recoveryEmail" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Correo Electrónico</label>
                    <input id="recoveryEmail" type="email" name="correo" autocomplete="email" formControlName="correo" placeholder="tu@correo.com"
                           class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors shadow-inner text-sm">
                  </div>

                  <button type="submit" [disabled]="forgotForm.invalid || isRecoveryLoading()"
                          class="w-full py-3.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-md hover:shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2">
                    @if (isRecoveryLoading()) {
                      <i class="pi pi-spin pi-spinner"></i> Enviando...
                    } @else {
                      Enviar Instrucciones <i class="pi pi-arrow-right"></i>
                    }
                  </button>

                  <div class="text-center pt-2">
                    <button type="button" (click)="goToStep(2)" class="text-xs text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer">
                      ¿Ya tienes un token de recuperación? Ingresar aquí
                    </button>
                  </div>
                </form>
              } @else {
                <form id="recovery-reset-form" [formGroup]="resetForm" (ngSubmit)="onResetSubmit()" novalidate class="space-y-4">
                  <div class="space-y-1.5">
                    <label for="recoveryToken" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Token de Recuperación</label>
                    <input id="recoveryToken" type="text" name="token" autocomplete="one-time-code" formControlName="token" placeholder="Pega el token aquí"
                           class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors shadow-inner text-sm font-mono">
                    <!--
                      T-28 · el validador exige 10 caracteres y el botón se
                      deshabilita sin decir por qué: el usuario con un token
                      corto se quedaba sin pistas. El aviso aparece en cuanto
                      hay algo escrito pero aún no llega al mínimo.
                    -->
                    @if (tokenIncompleto) {
                      <p class="text-[11px] text-amber-300 flex items-center gap-1.5" role="alert">
                        <i class="pi pi-info-circle"></i>
                        El token tiene {{ resetForm.get('token')?.value?.length ?? 0 }} caracteres y necesita
                        al menos 10.
                      </p>
                    } @else {
                      <p class="text-[11px] text-zinc-500">Pega el token completo que recibiste por correo.</p>
                    }
                  </div>

                  <div class="space-y-1.5">
                    <label for="recoveryNewPassword" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Nueva Contraseña (mín. 8 caracteres)</label>
                    <input id="recoveryNewPassword" type="password" name="newPassword" autocomplete="new-password" formControlName="newPassword" placeholder="••••••••"
                           class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors shadow-inner text-sm">
                  </div>

                  <button type="submit" [disabled]="resetForm.invalid || isRecoveryLoading()"
                          class="w-full py-3.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-md hover:shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2">
                    @if (isRecoveryLoading()) {
                      <i class="pi pi-spin pi-spinner"></i> Actualizando...
                    } @else {
                      Restablecer Contraseña <i class="pi pi-check"></i>
                    }
                  </button>

                  <div class="text-center pt-2">
                    <button type="button" (click)="goToStep(1)" class="text-xs text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer">
                      ← Volver a solicitar token
                    </button>
                  </div>
                </form>
              }
          }
        </app-modal-shell>

      </div>
    </div>
  `,
  styles: [`
    .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
    @keyframes fadeInUp {
      0% { opacity: 0; transform: translateY(30px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes shake {
      10%, 90% { transform: translate3d(-1px, 0, 0); }
      20%, 80% { transform: translate3d(2px, 0, 0); }
      30%, 50%, 70% { transform: translate3d(-3px, 0, 0); }
      40%, 60% { transform: translate3d(3px, 0, 0); }
    }
  `]
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  authService = inject(AuthService);

  /**
   * H75 · la ruta que la persona pedía antes de que el `authGuard` la mandara
   * aquí. Se lee de la query (por eso sobrevive a una recarga del formulario) y
   * se le pasa a `AuthService`, que la valida antes de navegar: este parámetro
   * lo puede escribir cualquiera.
   */
  readonly returnUrl = this.route.snapshot.queryParamMap.get(PARAM_RETURN_URL);

  /** El destino también viaja al registro: quien no tiene cuenta suele ser
   * justo quien escanea el QR de una sede por primera vez. */
  get queryParamsDelRetorno(): Record<string, string> {
    return this.returnUrl ? { [PARAM_RETURN_URL]: this.returnUrl } : {};
  }

  /**
   * `true` solo en desarrollo (`ng serve`, tests). En el build de producción
   * `isDevMode()` es `false` y el bloque de accesos demo no llega al DOM: sus
   * cuentas viven únicamente en la base local del seed demo (regla E0-07), y
   * mostrarlas en producción ofrecía credenciales que siempre daban 401.
   */
  readonly esModoDesarrollo = isDevMode();

  showPassword = signal(false);
  showRecoveryModal = signal(false);
  recoveryStep = signal<1 | 2>(1);
  isRecoveryLoading = signal(false);
  recoverySuccessMsg = signal<string | null>(null);
  recoveryErrorMsg = signal<string | null>(null);

  /** T-26 · `true` cuando el login ya lleva demasiado tiempo esperando. */
  readonly esperaProlongada = signal(false);

  /** F8 / T-83 · el servidor no respondió a `GET /health/liveness` en 3 s. */
  readonly servidorDespertando = signal(false);
  /** F8 / T-83 · 90 s sin respuesta: se deja de sondear y se avisa. */
  readonly servidorNoDisponible = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private avisoDeEspera?: ReturnType<typeof setTimeout>;
  private sonda?: Subscription;
  private plazoDeSonda?: ReturnType<typeof setTimeout>;
  private reintentoDeSonda?: ReturnType<typeof setTimeout>;
  private limiteDeSonda?: ReturnType<typeof setTimeout>;

  constructor() {
    // Los temporizadores no pueden sobrevivir al componente: si se navega fuera
    // con la petición en vuelo, el aviso no debe pintarse sobre otra pantalla.
    this.destroyRef.onDestroy(() => {
      this.limpiarAvisoDeEspera();
      this.limpiarSonda();
    });

    // F8 / T-83 · la pantalla de login se pinta antes de que el backend exista
    // para el usuario: se sondea la vida mientras el formulario ya es usable.
    this.iniciarSondaDeServidor();
  }

  // ── F8 / T-83 · cold start de Render ───────────────────────────────────────

  /**
   * Sondea `GET /health/liveness` con 3 s de plazo y reintenta cada 5 s.
   *
   * Se hace a mano con `setTimeout` y no con `timeout()` de RxJS porque el plazo
   * tiene que ABORTAR la petición colgada: si Render duerme la instancia, el
   * fetch puede quedarse 60 s en vuelo y una sonda nueva encima duplicaría la
   * espera. Al vencer el plazo se cancela la suscripción y se vuelve a probar.
   */
  private iniciarSondaDeServidor(): void {
    this.limiteDeSonda = setTimeout(() => this.declararServidorNoDisponible(), SONDA_LIMITE_MS);
    this.lanzarSonda();
  }

  private lanzarSonda(): void {
    this.sonda?.unsubscribe();
    this.limpiarPlazo();

    let respondio = false;

    this.plazoDeSonda = setTimeout(() => {
      if (respondio) return;
      this.servidorDespertando.set(true);
      this.programarReintento();
    }, SONDA_PLAZO_MS);

    this.sonda = this.http.get(`${API_URL}/health/liveness`).subscribe({
      next: () => {
        respondio = true;
        this.marcarServidorListo();
      },
      error: () => {
        respondio = true;
        // Respondió con error: la instancia está despierta (aunque no lista), así
        // que no se miente diciendo que está arrancando. Se reintenta en
        // silencio y el aviso, si estaba, se queda hasta que conteste 200.
        this.programarReintento();
      },
    });
  }

  private programarReintento(): void {
    this.limpiarPlazo();
    if (this.reintentoDeSonda) clearTimeout(this.reintentoDeSonda);
    this.reintentoDeSonda = setTimeout(() => this.lanzarSonda(), SONDA_REINTENTO_MS);
  }

  private marcarServidorListo(): void {
    this.limpiarSonda();
    this.servidorDespertando.set(false);
    this.servidorNoDisponible.set(false);
  }

  private declararServidorNoDisponible(): void {
    this.limpiarSonda();
    this.servidorDespertando.set(false);
    this.servidorNoDisponible.set(true);
  }

  private limpiarPlazo(): void {
    if (this.plazoDeSonda) clearTimeout(this.plazoDeSonda);
    this.plazoDeSonda = undefined;
  }

  private limpiarSonda(): void {
    this.sonda?.unsubscribe();
    this.sonda = undefined;
    this.limpiarPlazo();

    if (this.reintentoDeSonda) clearTimeout(this.reintentoDeSonda);
    this.reintentoDeSonda = undefined;
    if (this.limiteDeSonda) clearTimeout(this.limiteDeSonda);
    this.limiteDeSonda = undefined;
  }

  /** El botón «Reintentar» del aviso de servidor no disponible. */
  reintentarConexion(): void {
    this.servidorNoDisponible.set(false);
    this.servidorDespertando.set(false);
    this.iniciarSondaDeServidor();
  }

  private programarAvisoDeEspera(): void {
    this.limpiarAvisoDeEspera();
    this.avisoDeEspera = setTimeout(
      () => this.esperaProlongada.set(true),
      UMBRAL_AVISO_ESPERA_MS,
    );
  }

  private limpiarAvisoDeEspera(): void {
    if (this.avisoDeEspera) clearTimeout(this.avisoDeEspera);
    this.avisoDeEspera = undefined;
    this.esperaProlongada.set(false);
  }

  loginForm = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  forgotForm = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
  });

  resetForm = this.fb.group({
    token: ['', [Validators.required, Validators.minLength(10)]],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  fillDemo(correo: string, pass: string = 'Password123!') {
    this.loginForm.patchValue({ correo, password: pass });
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  /**
   * Abre la recuperación con el correo ya escrito (si lo hay) y el resto en
   * limpio: el modal se monta desde cero y no hereda marcas ni errores del
   * intento de login anterior.
   */
  openRecoveryModal() {
    this.recoveryStep.set(1);
    this.isRecoveryLoading.set(false);
    this.recoverySuccessMsg.set(null);
    this.recoveryErrorMsg.set(null);
    this.forgotForm.reset({ correo: this.loginForm.value.correo || '' });
    this.forgotForm.markAsUntouched();
    this.resetForm.reset();
    this.resetForm.markAsUntouched();
    this.authService.limpiarError();
    this.showRecoveryModal.set(true);
  }

  closeRecoveryModal() {
    this.showRecoveryModal.set(false);
    this.recoveryStep.set(1);
    this.isRecoveryLoading.set(false);
    this.recoverySuccessMsg.set(null);
    this.recoveryErrorMsg.set(null);
    // El modal se desmonta: al volver a abrirlo no puede reaparecer ni el
    // correo ni el token de la vez anterior.
    this.forgotForm.reset({ correo: '' });
    this.forgotForm.markAsUntouched();
    this.resetForm.reset();
    this.resetForm.markAsUntouched();
  }

  goToStep(step: 1 | 2) {
    this.recoveryStep.set(step);
    this.recoverySuccessMsg.set(null);
    this.recoveryErrorMsg.set(null);
    // Cada paso estrena su propio formulario: no se reutilizan las marcas del
    // anterior (un campo tocado en el paso 1 no debe pintarse sucio en el 2).
    this.forgotForm.markAsUntouched();
    this.resetForm.markAsUntouched();
  }

  onForgotSubmit() {
    if (this.forgotForm.invalid) return;
    this.isRecoveryLoading.set(true);
    this.recoveryErrorMsg.set(null);
    this.recoverySuccessMsg.set(null);

    const email = this.forgotForm.value.correo!;
    this.authService.forgotPassword(email).subscribe({
      next: (res) => {
        this.isRecoveryLoading.set(false);
        this.recoverySuccessMsg.set(res.message);
        // Si en desarrollo/demo devuelve debugToken, lo pre-cargamos para facilitar la prueba
        if (res.debugToken) {
          this.resetForm.patchValue({ token: res.debugToken });
        }
        setTimeout(() => {
          this.recoveryStep.set(2);
        }, 1500);
      },
      error: (err) => {
        this.isRecoveryLoading.set(false);
        this.recoveryErrorMsg.set(mensajeDeError(err, 'Error al procesar la solicitud.'));
      }
    });
  }

  /**
   * T-28 · aviso temprano del mínimo del token (el formulario sigue validando).
   *
   * Es un getter y NO un `computed()`: el valor sale de un `FormControl`, que no
   * es una señal, así que el `computed` no tenía de qué invalidarse y se quedaba
   * cacheado en `false` —el aviso no aparecía nunca—. Verificado en navegador.
   */
  get tokenIncompleto(): boolean {
    const valor = (this.resetForm.get('token')?.value ?? '') as string;
    return valor.length > 0 && valor.length < 10;
  }

  onResetSubmit() {
    if (this.resetForm.invalid) return;
    this.isRecoveryLoading.set(true);
    this.recoveryErrorMsg.set(null);
    this.recoverySuccessMsg.set(null);

    const { token, newPassword } = this.resetForm.value;
    this.authService.resetPassword(token!, newPassword!).subscribe({
      next: (res) => {
        this.isRecoveryLoading.set(false);
        this.recoverySuccessMsg.set(res.message);
        setTimeout(() => {
          this.closeRecoveryModal();
          this.loginForm.patchValue({ password: newPassword });
        }, 2000);
      },
      error: (err) => {
        this.isRecoveryLoading.set(false);
        this.recoveryErrorMsg.set(mensajeDeError(err, 'El token es inválido o ha expirado.'));
      }
    });
  }

  onSubmit() {
    // F8 / T-83 · con el servidor despertando o caído no se envía: el POST
    // quedaría colgado y el usuario creería que su contraseña es la incorrecta.
    if (!this.loginForm.valid || this.servidorDespertando() || this.servidorNoDisponible()) {
      return;
    }

    this.programarAvisoDeEspera();
    this.authService.login(this.loginForm.value as any, this.returnUrl).subscribe({
      next: () => this.limpiarAvisoDeEspera(),
      error: () => this.limpiarAvisoDeEspera(),
    });
  }
}

