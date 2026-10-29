import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  CatalogoHibridoService,
  CategoriaServicio,
} from '../../../core/services/catalogo-hibrido.service.js';
import { TenantService } from '../../../core/services/tenant.service.js';
import { AuthService } from '../../../auth/auth.service.js';
import { ModalOverlayDirective } from '../../../shared/directives/modal-overlay.directive.js';

/**
 * V3 · Categorías de servicio de la sede (panel del ADMIN_BARBERIA).
 *
 * La taxonomía es de la SEDE: aquí se crean, renombran, describen y desactivan
 * las categorías dentro de las cuales cada barbero publica sus servicios. El
 * ADMINISTRADOR global entra en modo lectura —el backend le responde 403 en
 * cualquier escritura— así que la pantalla no le muestra los botones.
 *
 * Nada se borra: desactivar una categoría la retira del catálogo del cliente y
 * conserva los servicios que cuelgan de ella para cuando se reactive (§9).
 */
@Component({
  selector: 'app-admin-categorias',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ModalOverlayDirective],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh">
      <!-- Cabecera -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div class="space-y-1">
          <h2 class="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight">
            Categorías de <span class="gold-gradient-text">Servicios</span>
          </h2>
          <p class="text-sm text-zinc-400">
            @if (puedeGestionar()) {
              Define las categorías de {{ tenantService.nombreBarberiaActiva() }}. Los barberos publican
              sus servicios dentro de ellas.
            } @else {
              Categorías de {{ tenantService.nombreBarberiaActiva() }} · modo lectura (las gestiona el
              administrador de la sede).
            }
          </p>
        </div>

        @if (puedeGestionar()) {
          <button
            (click)="abrirFormulario()"
            class="px-5 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:-translate-y-0.5 transition-transform flex items-center gap-2"
          >
            <i class="pi pi-plus"></i> Nueva Categoría
          </button>
        }
      </div>

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
      @if (catalogoService.errorCategorias()) {
        <div
          class="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-2"
          role="alert"
        >
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span class="flex-1">{{ catalogoService.errorCategorias() }}</span>
          <button (click)="recargar()" class="text-rose-200 hover:text-white underline text-xs">
            Reintentar
          </button>
        </div>
      }

      <!-- Tabla -->
      <div class="glass-panel rounded-3xl border border-white/5 overflow-hidden">
        @if (catalogoService.cargandoCategorias()) {
          <div class="flex flex-col items-center justify-center py-20 gap-3">
            <i class="pi pi-spin pi-spinner text-4xl text-amber-500/70"></i>
            <p class="text-xs text-zinc-500">Cargando categorías...</p>
          </div>
        } @else if (catalogoService.categorias().length === 0) {
          <!-- Estado vacío -->
          <div class="py-20 px-6 text-center space-y-4">
            <div
              class="w-20 h-20 mx-auto rounded-3xl bg-zinc-800/40 border border-zinc-700/50 flex items-center justify-center text-3xl text-zinc-600"
            >
              <i class="pi pi-tags"></i>
            </div>
            <div class="space-y-1">
              <h3 class="text-lg font-bold text-white">Todavía no hay categorías</h3>
              <p class="text-sm text-zinc-400 max-w-md mx-auto">
                Crea la primera categoría (por ejemplo «Corte», «Barba» o «Color») para que tu equipo
                pueda publicar sus servicios.
              </p>
            </div>
            @if (puedeGestionar()) {
              <button
                (click)="abrirFormulario()"
                class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform inline-flex items-center gap-2"
              >
                <i class="pi pi-plus"></i> Crear mi primera categoría
              </button>
            }
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-sm min-w-[720px]">
              <thead class="bg-zinc-900/60 text-zinc-400 text-[11px] uppercase tracking-wider">
                <tr>
                  <th class="text-left font-semibold px-5 py-3">Categoría</th>
                  <th class="text-left font-semibold px-5 py-3">Descripción</th>
                  <th class="text-center font-semibold px-3 py-3">Servicios activos</th>
                  <th class="text-center font-semibold px-3 py-3">Estado</th>
                  @if (puedeGestionar()) {
                    <th class="text-right font-semibold px-5 py-3">Acciones</th>
                  }
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (categoria of catalogoService.categorias(); track categoria.id) {
                  <tr
                    class="hover:bg-white/[0.03] transition-colors"
                    [class.opacity-60]="!categoria.activa"
                  >
                    <td class="px-5 py-4">
                      <div class="flex items-center gap-3">
                        <div
                          class="w-9 h-9 rounded-xl border flex items-center justify-center"
                          [ngClass]="
                            categoria.activa
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                          "
                        >
                          <i class="pi pi-tag text-xs"></i>
                        </div>
                        <span class="font-semibold text-white">{{ categoria.nombre }}</span>
                      </div>
                    </td>
                    <td class="px-5 py-4 text-zinc-400 max-w-[280px]">
                      <span class="line-clamp-2">
                        {{ categoria.descripcion || 'Sin descripción' }}
                      </span>
                    </td>
                    <td class="px-3 py-4 text-center">
                      <span
                        class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-zinc-800 text-zinc-300"
                      >
                        {{ categoria.serviciosActivos }}
                      </span>
                    </td>
                    <td class="px-3 py-4 text-center">
                      <span
                        class="px-2.5 py-1 rounded-full text-[10px] font-bold border"
                        [ngClass]="
                          categoria.activa
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-zinc-800 border-zinc-600 text-zinc-400'
                        "
                      >
                        {{ categoria.activa ? 'ACTIVA' : 'INACTIVA' }}
                      </span>
                    </td>
                    @if (puedeGestionar()) {
                      <td class="px-5 py-4">
                        <div class="flex items-center justify-end gap-2">
                          <button
                            (click)="abrirFormulario(categoria)"
                            class="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-300 bg-zinc-800 hover:text-white hover:bg-zinc-700 transition-colors flex items-center gap-1.5"
                          >
                            <i class="pi pi-pencil"></i> Editar
                          </button>
                          <button
                            (click)="alternarEstado(categoria)"
                            [disabled]="procesandoId() === categoria.id"
                            class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            [ngClass]="
                              categoria.activa
                                ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                            "
                          >
                            <i
                              class="pi"
                              [ngClass]="
                                procesandoId() === categoria.id
                                  ? 'pi-spin pi-spinner'
                                  : categoria.activa
                                    ? 'pi-ban'
                                    : 'pi-refresh'
                              "
                            ></i>
                            {{ categoria.activa ? 'Desactivar' : 'Reactivar' }}
                          </button>
                        </div>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Modal de alta / edición -->
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
                    {{ editandoId() ? 'Editar categoría' : 'Nueva categoría' }}
                  </h3>
                  <p class="text-xs text-zinc-400 mt-1">
                    Agrupa los servicios que ofrecen tus barberos en esta sede.
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
                    Nombre
                  </label>
                  <input
                    type="text"
                    formControlName="nombre"
                    placeholder="Ej. Corte, Barba, Color"
                    class="w-full bg-neutral-900 text-white border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500/60 transition-colors"
                  />
                  @if (form.get('nombre')?.invalid && form.get('nombre')?.touched) {
                    <p class="text-[11px] text-rose-400 mt-1">
                      El nombre debe tener entre 2 y 100 caracteres.
                    </p>
                  }
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 uppercase mb-1.5">
                    Descripción <span class="text-zinc-600 normal-case">(opcional)</span>
                  </label>
                  <textarea
                    formControlName="descripcion"
                    rows="3"
                    placeholder="¿Qué engloba esta categoría?"
                    class="w-full bg-neutral-900 text-white border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500/60 transition-colors resize-none"
                  ></textarea>
                  @if (form.get('descripcion')?.invalid && form.get('descripcion')?.touched) {
                    <p class="text-[11px] text-rose-400 mt-1">La descripción no puede superar 500 caracteres.</p>
                  }
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
                    [disabled]="form.invalid || catalogoService.guardandoCategoria()"
                    class="flex-1 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    @if (catalogoService.guardandoCategoria()) {
                      <i class="pi pi-spin pi-spinner"></i> Guardando...
                    } @else {
                      <i class="pi pi-save"></i>
                      {{ editandoId() ? 'Guardar Cambios' : 'Crear Categoría' }}
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
export class AdminCategoriasComponent implements OnInit {
  protected readonly catalogoService = inject(CatalogoHibridoService);
  protected readonly tenantService = inject(TenantService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly modalAbierto = signal(false);
  readonly editandoId = signal<string | null>(null);
  readonly procesandoId = signal<string | null>(null);
  readonly mensajeExito = signal<string | null>(null);

  /**
   * La taxonomía la escribe el ADMIN_BARBERIA de la sede. El ADMINISTRADOR global
   * entra por jerarquía al guard de la ruta, pero el backend le responde 403 al
   * guardar: aquí ve la pantalla sin botones de escritura (misma regla que el
   * catálogo de E1-05).
   */
  readonly puedeGestionar = computed(() => {
    const roles = this.authService.authState().user?.roles ?? [];
    return roles.includes('ADMIN_BARBERIA');
  });

  readonly form = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    descripcion: ['', [Validators.maxLength(500)]],
  });

  ngOnInit(): void {
    this.recargar();
  }

  recargar(): void {
    this.catalogoService.cargarCategorias().subscribe();
  }

  abrirFormulario(categoria?: CategoriaServicio): void {
    if (!this.puedeGestionar()) return;

    if (categoria) {
      this.editandoId.set(categoria.id);
      this.form.setValue({
        nombre: categoria.nombre,
        descripcion: categoria.descripcion ?? '',
      });
    } else {
      this.editandoId.set(null);
      this.form.reset({ nombre: '', descripcion: '' });
    }

    this.modalAbierto.set(true);
  }

  cerrarFormulario(): void {
    this.modalAbierto.set(false);
    this.editandoId.set(null);
    this.form.reset({ nombre: '', descripcion: '' });
  }

  guardar(): void {
    if (this.form.invalid || !this.puedeGestionar()) {
      this.form.markAllAsTouched();
      return;
    }

    const nombre = (this.form.value.nombre ?? '').trim();
    const descripcion = (this.form.value.descripcion ?? '').trim();
    const id = this.editandoId();

    const peticion$ = id
      ? this.catalogoService.actualizarCategoria(id, { nombre, descripcion })
      : this.catalogoService.crearCategoria({ nombre, descripcion: descripcion || undefined });

    peticion$.subscribe({
      next: () => {
        this.mostrarExito(id ? 'Categoría actualizada.' : 'Categoría creada.');
        this.cerrarFormulario();
      },
      // El mensaje ya queda en `errorCategorias` y el modal sigue abierto para
      // corregir el nombre sin volver a escribirlo todo.
      error: () => undefined,
    });
  }

  alternarEstado(categoria: CategoriaServicio): void {
    if (!this.puedeGestionar()) return;

    const pregunta = categoria.activa
      ? `¿Desactivar «${categoria.nombre}»? Dejará de mostrarse en el catálogo del cliente, pero no se borra.`
      : `¿Reactivar «${categoria.nombre}»? Volverá a mostrarse en el catálogo junto con sus servicios.`;

    if (!confirm(pregunta)) return;

    this.procesandoId.set(categoria.id);
    this.catalogoService.actualizarCategoria(categoria.id, { activa: !categoria.activa }).subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.mostrarExito(
          categoria.activa ? 'Categoría desactivada.' : 'Categoría reactivada.',
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
