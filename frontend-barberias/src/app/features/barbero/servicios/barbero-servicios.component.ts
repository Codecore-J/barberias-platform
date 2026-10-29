import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  CatalogoHibridoService,
  CategoriaServicio,
  ServicioBarbero,
} from '../../../core/services/catalogo-hibrido.service.js';
import { TenantService } from '../../../core/services/tenant.service.js';
import { ModalOverlayDirective } from '../../../shared/directives/modal-overlay.directive.js';

/**
 * V3 · Mis Servicios (panel del BARBERO).
 *
 * El barbero publica DENTRO de las categorías que definió la sede: su nombre, su
 * precio y su duración son suyos, pero la taxonomía no. El `barberoId` lo pone
 * el JWT en el backend, así que esta pantalla nunca lo envía.
 *
 * `activo: false` retira el servicio del catálogo sin borrarlo (§9); el barbero
 * puede reactivarlo cuando quiera y las citas ya confirmadas no se ven afectadas
 * porque guardan su propio snapshot histórico.
 */
@Component({
  selector: 'app-barbero-servicios',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe, ModalOverlayDirective],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh">
      <!-- Cabecera -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div class="space-y-1">
          <h2 class="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight">
            Mis <span class="gold-gradient-text">Servicios</span>
          </h2>
          <p class="text-sm text-zinc-400">
            Publica lo que ofreces en {{ tenantService.nombreBarberiaActiva() }} con tu propio precio y
            duración.
          </p>
        </div>

        <button
          (click)="abrirFormulario()"
          [disabled]="categoriasActivas().length === 0"
          class="px-5 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:-translate-y-0.5 transition-transform flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          <i class="pi pi-plus"></i> Nuevo Servicio
        </button>
      </div>

      <!-- Sin categorías: el barbero no puede publicar todavía -->
      @if (!catalogoService.cargandoCategorias() && categoriasActivas().length === 0) {
        <div
          class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 flex items-start gap-3"
          role="alert"
        >
          <i class="pi pi-info-circle text-amber-400 mt-0.5"></i>
          <div class="text-sm text-amber-200">
            <p class="font-semibold">La sede todavía no tiene categorías activas.</p>
            <p class="text-amber-200/80 text-xs mt-1">
              Pide al administrador de la sede que cree una categoría (por ejemplo «Corte») para que
              puedas publicar tus servicios dentro de ella.
            </p>
          </div>
        </div>
      }

      <!-- Toast de éxito -->
      @if (mensajeExito()) {
        <div
          class="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-sm shadow-2xl flex items-center gap-2"
          role="status"
        >
          <i class="pi pi-check-circle"></i>
          <span>{{ mensajeExito() }}</span>
        </div>
      }

      <!-- Error de negocio o de red -->
      @if (catalogoService.errorMisServicios()) {
        <div
          class="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-2"
          role="alert"
        >
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span class="flex-1">{{ catalogoService.errorMisServicios() }}</span>
          <button (click)="recargar()" class="text-rose-200 hover:text-white underline text-xs">
            Reintentar
          </button>
        </div>
      }

      <!-- Cargando -->
      @if (cargando()) {
        <div class="flex flex-col items-center justify-center py-20 gap-3">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500/70"></i>
          <p class="text-xs text-zinc-500">Cargando tus servicios...</p>
        </div>
      } @else if (catalogoService.misServicios().length === 0) {
        <!-- Estado vacío -->
        <div class="glass-panel rounded-3xl border border-white/5 py-20 px-6 text-center space-y-4">
          <div
            class="w-20 h-20 mx-auto rounded-3xl bg-zinc-800/40 border border-zinc-700/50 flex items-center justify-center text-3xl text-zinc-600"
          >
            <i class="pi pi-briefcase"></i>
          </div>
          <div class="space-y-1">
            <h3 class="text-lg font-bold text-white">Aún no publicaste servicios</h3>
            <p class="text-sm text-zinc-400 max-w-md mx-auto">
              Crea tu primer servicio para que los clientes lo vean en el catálogo de la sede, con tu
              precio y tu duración.
            </p>
          </div>
          @if (categoriasActivas().length > 0) {
            <button
              (click)="abrirFormulario()"
              class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform inline-flex items-center gap-2"
            >
              <i class="pi pi-plus"></i> Publicar mi primer servicio
            </button>
          }
        </div>
      } @else {
        <!-- Tarjetas -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          @for (servicio of catalogoService.misServicios(); track servicio.id) {
            <div
              class="glass-card rounded-2xl p-5 flex flex-col gap-3 border border-white/5"
              [class.opacity-60]="!servicio.activo"
            >
              <div class="flex justify-between items-start gap-3">
                <div class="min-w-0">
                  <span
                    class="text-[10px] uppercase tracking-wider font-bold text-amber-400/90 flex items-center gap-1"
                  >
                    <i class="pi pi-tag text-[9px]"></i>
                    {{ servicio.categoria?.nombre || 'Sin categoría' }}
                  </span>
                  <h3 class="text-white font-bold leading-tight mt-1 truncate" [title]="servicio.nombrePersonalizado">
                    {{ servicio.nombrePersonalizado }}
                  </h3>
                </div>
                <div class="text-right shrink-0">
                  <p class="text-lg font-bold text-amber-400">
                    {{ servicio.precio | currency: 'USD' : 'symbol' : '1.0-2' }}
                  </p>
                  <p class="text-[11px] text-zinc-500">
                    <i class="pi pi-clock text-[9px] mr-1"></i>{{ servicio.duracionMinutos }} min
                  </p>
                </div>
              </div>

              <div class="flex items-center justify-between pt-3 mt-auto border-t border-white/5">
                <!-- Interruptor de disponibilidad -->
                <button
                  (click)="alternarActivo(servicio)"
                  [disabled]="procesandoId() === servicio.id"
                  class="flex items-center gap-2 text-xs font-semibold transition-colors disabled:opacity-50"
                  [ngClass]="servicio.activo ? 'text-emerald-400' : 'text-zinc-500'"
                  [attr.aria-pressed]="servicio.activo"
                  [title]="servicio.activo ? 'Visible en el catálogo' : 'Oculto para los clientes'"
                >
                  <span
                    class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                    [ngClass]="servicio.activo ? 'bg-emerald-500/80' : 'bg-zinc-700'"
                  >
                    <span
                      class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                      [ngClass]="servicio.activo ? 'translate-x-[18px]' : 'translate-x-[2px]'"
                    ></span>
                  </span>
                  @if (procesandoId() === servicio.id) {
                    <i class="pi pi-spin pi-spinner"></i>
                  }
                  {{ servicio.activo ? 'Activo' : 'Inactivo' }}
                </button>

                <button
                  (click)="abrirFormulario(servicio)"
                  class="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-300 bg-zinc-800 hover:text-white hover:bg-zinc-700 transition-colors flex items-center gap-1.5"
                >
                  <i class="pi pi-pencil"></i> Editar
                </button>
              </div>
            </div>
          }
        </div>
      }

      <!-- Modal -->
      @if (modalAbierto()) {
        <div
          appModalOverlay
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <div
            class="bg-zinc-900 border border-amber-500/25 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
          >
            <div class="p-6 space-y-6">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-xl font-bold text-white">
                    {{ editandoId() ? 'Editar servicio' : 'Nuevo servicio' }}
                  </h3>
                  <p class="text-xs text-zinc-400 mt-1">
                    Este es tu servicio: tú decides el nombre, el precio y cuánto dura.
                  </p>
                </div>
                <button
                  (click)="cerrarFormulario()"
                  class="text-zinc-500 hover:text-white transition-colors"
                  aria-label="Cerrar"
                >
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <form [formGroup]="form" (ngSubmit)="guardar()" class="space-y-4">
                <div>
                  <label class="block text-xs font-semibold text-zinc-400 uppercase mb-1.5">
                    Categoría
                  </label>
                  <select
                    formControlName="categoriaId"
                    class="w-full bg-neutral-900 text-white border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500/60 transition-colors"
                  >
                    <option value="" disabled>Selecciona una categoría</option>
                    @for (categoria of categoriasParaFormulario(); track categoria.id) {
                      <option [value]="categoria.id">
                        {{ categoria.nombre }}{{ categoria.activa ? '' : ' (inactiva)' }}
                      </option>
                    }
                  </select>
                  @if (form.get('categoriaId')?.invalid && form.get('categoriaId')?.touched) {
                    <p class="text-[11px] text-rose-400 mt-1">Elige una categoría.</p>
                  }
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 uppercase mb-1.5">
                    Nombre del servicio
                  </label>
                  <input
                    type="text"
                    formControlName="nombre"
                    placeholder="Ej. Corte degradado"
                    class="w-full bg-neutral-900 text-white border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500/60 transition-colors"
                  />
                  @if (form.get('nombre')?.invalid && form.get('nombre')?.touched) {
                    <p class="text-[11px] text-rose-400 mt-1">
                      El nombre debe tener entre 2 y 100 caracteres.
                    </p>
                  }
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-semibold text-zinc-400 uppercase mb-1.5">
                      Precio (USD)
                    </label>
                    <input
                      type="number"
                      formControlName="precio"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      class="w-full bg-neutral-900 text-white border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500/60 transition-colors"
                    />
                    @if (form.get('precio')?.invalid && form.get('precio')?.touched) {
                      <p class="text-[11px] text-rose-400 mt-1">Indica un precio válido (0 o más).</p>
                    }
                  </div>

                  <div>
                    <label class="block text-xs font-semibold text-zinc-400 uppercase mb-1.5">
                      Duración (minutos)
                    </label>
                    <input
                      type="number"
                      formControlName="duracionMinutos"
                      min="5"
                      max="480"
                      step="5"
                      class="w-full bg-neutral-900 text-white border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500/60 transition-colors"
                    />
                    @if (form.get('duracionMinutos')?.invalid && form.get('duracionMinutos')?.touched) {
                      <p class="text-[11px] text-rose-400 mt-1">Entre 5 y 480 minutos.</p>
                    }
                  </div>
                </div>

                <div class="flex gap-3 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    (click)="cerrarFormulario()"
                    class="flex-1 py-3 rounded-xl font-medium text-sm text-zinc-300 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    [disabled]="form.invalid || catalogoService.guardandoServicio()"
                    class="flex-1 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    @if (catalogoService.guardandoServicio()) {
                      <i class="pi pi-spin pi-spinner"></i> Guardando...
                    } @else {
                      <i class="pi pi-save"></i>
                      {{ editandoId() ? 'Guardar Cambios' : 'Publicar Servicio' }}
                    }
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class BarberoServiciosComponent implements OnInit {
  protected readonly catalogoService = inject(CatalogoHibridoService);
  protected readonly tenantService = inject(TenantService);
  private readonly fb = inject(FormBuilder);

  readonly modalAbierto = signal(false);
  readonly editandoId = signal<string | null>(null);
  readonly procesandoId = signal<string | null>(null);
  readonly mensajeExito = signal<string | null>(null);
  /** Categoría actual del servicio en edición, aunque esté inactiva. */
  private readonly categoriaEnEdicion = signal<CategoriaServicio | null>(null);

  readonly cargando = computed(
    () => this.catalogoService.cargandoMisServicios() || this.catalogoService.cargandoCategorias(),
  );

  readonly categoriasActivas = computed(() =>
    this.catalogoService.categorias().filter((categoria) => categoria.activa),
  );

  /**
   * En el formulario se ofrecen las categorías activas y, si se está editando un
   * servicio cuya categoría fue desactivada después, también esa: quitarla del
   * selector obligaría a mover el servicio de categoría solo para poder guardar
   * un cambio de precio.
   */
  readonly categoriasParaFormulario = computed(() => {
    const activas = this.categoriasActivas();
    const actual = this.categoriaEnEdicion();
    if (!actual || actual.activa) return activas;
    return [actual, ...activas];
  });

  readonly form = this.fb.group({
    categoriaId: ['', [Validators.required]],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    precio: [0, [Validators.required, Validators.min(0)]],
    duracionMinutos: [30, [Validators.required, Validators.min(5), Validators.max(480)]],
  });

  ngOnInit(): void {
    this.recargar();
  }

  recargar(): void {
    this.catalogoService.cargarCategorias().subscribe();
    this.catalogoService.cargarMisServicios().subscribe();
  }

  abrirFormulario(servicio?: ServicioBarbero): void {
    if (servicio) {
      this.editandoId.set(servicio.id);
      const categoria =
        this.catalogoService
          .categorias()
          .find((c) => c.id === servicio.categoriaId) ?? null;
      this.categoriaEnEdicion.set(categoria);
      this.form.setValue({
        categoriaId: servicio.categoriaId,
        nombre: servicio.nombrePersonalizado,
        precio: servicio.precio,
        duracionMinutos: servicio.duracionMinutos,
      });
    } else {
      this.editandoId.set(null);
      this.categoriaEnEdicion.set(null);
      const primera = this.categoriasActivas()[0];
      this.form.reset({
        categoriaId: primera?.id ?? '',
        nombre: '',
        precio: 0,
        duracionMinutos: 30,
      });
    }

    this.modalAbierto.set(true);
  }

  cerrarFormulario(): void {
    this.modalAbierto.set(false);
    this.editandoId.set(null);
    this.categoriaEnEdicion.set(null);
    this.form.reset({ categoriaId: '', nombre: '', precio: 0, duracionMinutos: 30 });
  }

  guardar(): void {
    if (this.form.invalid || this.catalogoService.guardandoServicio()) {
      this.form.markAllAsTouched();
      return;
    }

    const nombre = (this.form.value.nombre ?? '').trim();
    const categoriaId = this.form.value.categoriaId ?? '';
    const precio = Number(this.form.value.precio ?? 0);
    const duracionMinutos = Number(this.form.value.duracionMinutos ?? 0);
    const id = this.editandoId();

    const peticion$ = id
      ? this.catalogoService.actualizarServicio(id, {
          nombre,
          precio,
          duracionMinutos,
          // La categoría solo viaja si cambió: enviar la misma que ya estaba
          // desactivada haría fallar el guardado por una regla que no se tocó.
          categoriaId:
            categoriaId !== this.categoriaEnEdicion()?.id || this.categoriaEnEdicion()?.activa
              ? categoriaId
              : undefined,
        })
      : this.catalogoService.crearServicio({ nombre, precio, duracionMinutos, categoriaId });

    peticion$.subscribe({
      next: () => {
        this.mostrarExito(id ? 'Servicio actualizado.' : 'Servicio publicado.');
        this.cerrarFormulario();
      },
      error: () => undefined,
    });
  }

  alternarActivo(servicio: ServicioBarbero): void {
    this.procesandoId.set(servicio.id);
    this.catalogoService.actualizarServicio(servicio.id, { activo: !servicio.activo }).subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.mostrarExito(
          servicio.activo ? 'Servicio oculto del catálogo.' : 'Servicio visible de nuevo.',
        );
      },
      error: () => this.procesandoId.set(null),
    });
  }

  private mostrarExito(mensaje: string): void {
    this.mensajeExito.set(mensaje);
    setTimeout(() => this.mensajeExito.set(null), 4000);
  }
}
