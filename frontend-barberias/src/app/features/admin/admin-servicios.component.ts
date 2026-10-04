import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ServiciosService, Servicio } from '../../core/services/servicios.service';
import { TenantService } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-admin-servicios',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, CurrencyPipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-center gap-4 transform translate-z-12">
        <div>
          <h2 class="text-3xl font-display font-bold text-white">Panel de <span class="gold-gradient-text">Servicios</span></h2>
          <p class="text-sm text-zinc-400">Gestiona los servicios y combos de {{ tenantService.nombreBarberiaActiva() }}</p>
        </div>
        @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'ADMINISTRADOR') {
          <button (click)="openForm()" class="px-5 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:-translate-y-1 hover:scale-105 transition-transform flex items-center gap-2">
            <i class="pi pi-plus"></i> Nuevo Servicio
          </button>
        }
      </div>

      <!-- Estado de Carga Global -->
      @if (serviciosService.isLoading() && !showForm()) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Filtros y Búsqueda -->
      @if (!showForm()) {
        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 relative z-10">
          <div class="flex items-center gap-2 overflow-x-auto text-xs">
            <button (click)="filtroTipo.set('TODOS')"
                    class="px-3.5 py-1.5 rounded-xl font-medium transition-all flex items-center gap-1.5"
                    [ngClass]="filtroTipo() === 'TODOS' 
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'">
              <span>Todos</span>
              <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">{{ serviciosService.servicios().length }}</span>
            </button>

            <button (click)="filtroTipo.set('SERVICIOS')"
                    class="px-3.5 py-1.5 rounded-xl font-medium transition-all flex items-center gap-1.5"
                    [ngClass]="filtroTipo() === 'SERVICIOS' 
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'">
              <i class="pi pi-tag text-[10px]"></i>
              <span>Servicios</span>
              <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">{{ countServicios() }}</span>
            </button>

            <button (click)="filtroTipo.set('COMBOS')"
                    class="px-3.5 py-1.5 rounded-xl font-medium transition-all flex items-center gap-1.5"
                    [ngClass]="filtroTipo() === 'COMBOS' 
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'">
              <i class="pi pi-star text-[10px]"></i>
              <span>Combos DFS</span>
              <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">{{ countCombos() }}</span>
            </button>
          </div>

          <div class="relative w-full sm:w-72">
            <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs"></i>
            <input type="text" [(ngModel)]="busquedaTexto" placeholder="Buscar por nombre o descripción..."
                   class="w-full bg-zinc-950/80 border border-zinc-700/60 rounded-xl pl-8 pr-4 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors">
          </div>
        </div>
      }

      <!-- Grid de Servicios -->
      @if (!showForm()) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transform-style-3d">
          @for (servicio of serviciosFiltrados(); track servicio.id) {
            <div class="glass-card rounded-2xl p-6 relative group hover:-translate-y-2 hover:rotate-x-2 transition-all duration-300 transform-style-3d flex flex-col h-full border border-white/5 hover:border-amber-500/30">
              
              <div class="flex justify-between items-start mb-3 transform translate-z-12">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl flex items-center justify-center border"
                       [ngClass]="servicio.esCombo 
                         ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' 
                         : 'bg-zinc-800 border-zinc-700 text-zinc-300'">
                    <i [class]="servicio.esCombo ? 'pi pi-star text-base' : 'pi pi-tag text-base'"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-white leading-tight">{{ servicio.nombre }}</h3>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="text-xs text-zinc-400"><i class="pi pi-clock text-[10px] mr-1"></i>{{ servicio.duracionMinutos }} min</span>
                      @if (servicio.esCombo) {
                        <span class="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">Combo</span>
                      }
                    </div>
                  </div>
                </div>
                <div class="font-bold text-amber-400 text-lg">
                  {{ servicio.precio | currency:'USD':'symbol':'1.0-0' }}
                </div>
              </div>

              <p class="text-xs text-zinc-400 line-clamp-2 mb-4 flex-grow transform translate-z-8">
                {{ servicio.descripcion || 'Sin descripción detallada.' }}
              </p>

              <!-- Actions -->
              <div class="flex gap-2 pt-4 border-t border-zinc-800 transform translate-z-12">
                <button (click)="openForm(servicio)" class="flex-1 py-2 rounded-lg text-xs font-bold text-zinc-300 bg-zinc-800 hover:text-white hover:bg-zinc-700 transition-colors flex justify-center items-center gap-2">
                  <i class="pi pi-pencil"></i> Editar
                </button>
                <button (click)="confirmDelete(servicio.id)" class="px-4 py-2 rounded-lg text-xs font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 hover:text-red-300 transition-colors">
                  <i class="pi pi-trash"></i>
                </button>
              </div>
            </div>
          }
        </div>

        @if (serviciosFiltrados().length === 0 && !serviciosService.isLoading()) {
          <div class="text-center py-20 transform translate-z-12 glass-panel rounded-3xl border border-white/5">
            <i class="pi pi-folder-open text-5xl text-zinc-600 mb-4 block"></i>
            <p class="text-zinc-400 font-medium">No se encontraron servicios ni combos.</p>
            @if (filtroTipo() !== 'TODOS' || busquedaTexto) {
              <button (click)="resetFiltros()" class="mt-3 text-xs text-amber-400 hover:underline">
                Limpiar filtros
              </button>
            }
          </div>
        }
      }

      <!-- Formulario (Se muestra como un panel grande) -->
      @if (showForm()) {
        <div class="glass-panel rounded-3xl p-8 max-w-3xl mx-auto shadow-2xl relative overflow-hidden transform-style-3d animate-fade-in-up border border-amber-500/30">
          <div class="absolute -top-20 -right-20 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div class="flex justify-between items-center mb-6 relative z-10">
            <h3 class="text-2xl font-bold text-white">
              {{ isEditing() ? 'Editar Servicio' : 'Nuevo Servicio' }}
            </h3>
            <button (click)="closeForm()" class="text-zinc-400 hover:text-white"><i class="pi pi-times text-xl"></i></button>
          </div>

          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-6 relative z-10">
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Nombre -->
              <div class="space-y-2 md:col-span-2">
                <label class="text-xs font-bold text-zinc-400 uppercase">Nombre del Servicio</label>
                <input type="text" formControlName="nombre" class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 px-4 text-white focus:border-amber-500/50 outline-none">
              </div>

              <!-- Precio -->
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-400 uppercase">Precio ($)</label>
                <input type="number" formControlName="precio" class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 px-4 text-white focus:border-amber-500/50 outline-none">
              </div>

              <!-- Duración -->
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-400 uppercase">Duración (Minutos)</label>
                <input type="number" formControlName="duracionMinutos" class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 px-4 text-white focus:border-amber-500/50 outline-none">
              </div>

              <!-- Es Combo -->
              <div class="space-y-2 md:col-span-2 flex items-center gap-3 bg-zinc-900/50 p-4 rounded-xl border border-zinc-800">
                <input type="checkbox" formControlName="esCombo" id="esCombo" class="w-5 h-5 accent-amber-500 rounded cursor-pointer">
                <label for="esCombo" class="text-sm font-bold text-zinc-300 cursor-pointer">Es un Combo (agrupación de servicios)</label>
              </div>

              <!-- Selección de Servicios para Combo -->
              @if (form.get('esCombo')?.value) {
                <div class="space-y-2 md:col-span-2 bg-zinc-900/80 p-4 rounded-xl border border-amber-500/20">
                  <label class="text-xs font-bold text-amber-400 uppercase">Selecciona los servicios del combo</label>
                  <p class="text-xs text-zinc-400 mb-3">Mantén presionado Ctrl (o Cmd) para seleccionar múltiples.</p>
                  <select multiple formControlName="serviciosComboIds" class="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white outline-none focus:border-amber-500 h-32">
                    @for (s of serviciosRegulares(); track s.id) {
                      <!-- Evitamos que un combo se seleccione a sí mismo -->
                      @if (s.id !== editingId()) {
                        <option [value]="s.id" class="py-1 px-2 mb-1 rounded hover:bg-zinc-700">{{ s.nombre }} ({{ s.precio | currency:'USD':'symbol':'1.0-0' }})</option>
                      }
                    }
                  </select>
                </div>
              }

              <!-- Descripción -->
              <div class="space-y-2 md:col-span-2">
                <label class="text-xs font-bold text-zinc-400 uppercase">Descripción (Opcional)</label>
                <textarea formControlName="descripcion" rows="3" class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 px-4 text-white focus:border-amber-500/50 outline-none resize-none"></textarea>
              </div>
            </div>

            @if (serviciosService.error()) {
              <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                {{ serviciosService.error() }}
              </div>
            }

            <div class="pt-4 flex justify-end gap-4">
              <button type="button" (click)="closeForm()" class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-300 glass-card hover:bg-zinc-800 transition-colors">
                Cancelar
              </button>
              <button type="submit" [disabled]="form.invalid || serviciosService.isLoading()" class="px-8 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 disabled:opacity-50 transition-transform">
                @if (serviciosService.isLoading()) {
                  <i class="pi pi-spin pi-spinner"></i> Guardando...
                } @else {
                  <i class="pi pi-save"></i> Guardar
                }
              </button>
            </div>
          </form>
        </div>
      }

    </div>
  `,
  styles: [`
    .animate-fade-in-up { animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes fadeInUp {
      0% { opacity: 0; transform: translateY(20px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
  `]
})
export class AdminServiciosComponent implements OnInit {
  protected readonly serviciosService = inject(ServiciosService);
  protected readonly tenantService = inject(TenantService);
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);

  userRole(): string {
    const roles = this.authService.authState().user?.roles;
    if (!roles || roles.length === 0) return 'CLIENTE';
    if (roles.includes('ADMINISTRADOR')) return 'ADMINISTRADOR';
    if (roles.includes('ADMIN_BARBERIA')) return 'ADMIN_BARBERIA';
    if (roles.includes('BARBERO')) return 'BARBERO';
    return 'CLIENTE';
  }

  showForm = signal(false);
  isEditing = signal(false);
  editingId = signal<string | null>(null);

  filtroTipo = signal<'TODOS' | 'SERVICIOS' | 'COMBOS'>('TODOS');
  busquedaTexto = '';

  countServicios = computed(() => this.serviciosService.servicios().filter(s => !s.esCombo).length);
  countCombos = computed(() => this.serviciosService.servicios().filter(s => s.esCombo).length);

  serviciosFiltrados = computed(() => {
    const list = this.serviciosService.servicios();
    const tipo = this.filtroTipo();
    const query = this.busquedaTexto.toLowerCase().trim();

    return list.filter(s => {
      if (tipo === 'SERVICIOS' && s.esCombo) return false;
      if (tipo === 'COMBOS' && !s.esCombo) return false;
      if (query) {
        const nom = s.nombre?.toLowerCase() || '';
        const desc = s.descripcion?.toLowerCase() || '';
        if (!nom.includes(query) && !desc.includes(query)) return false;
      }
      return true;
    });
  });

  resetFiltros() {
    this.filtroTipo.set('TODOS');
    this.busquedaTexto = '';
  }

  // Computado para obtener solo los servicios regulares (no combos)
  serviciosRegulares = computed(() => this.serviciosService.servicios().filter(s => !s.esCombo));

  form: FormGroup = this.fb.group({
    nombre: ['', [Validators.required]],
    descripcion: [''],
    precio: [0, [Validators.required, Validators.min(0)]],
    duracionMinutos: [30, [Validators.required, Validators.min(5)]],
    esCombo: [false],
    serviciosComboIds: [[]] // Array of string IDs
  });

  ngOnInit() {
    this.serviciosService.cargarServicios().subscribe();
    
    // Si se activa/desactiva esCombo, reiniciar serviciosComboIds
    this.form.get('esCombo')?.valueChanges.subscribe(isCombo => {
      if (!isCombo) {
        this.form.get('serviciosComboIds')?.setValue([]);
      }
    });
  }

  openForm(servicio?: Servicio) {
    if (servicio) {
      this.isEditing.set(true);
      this.editingId.set(servicio.id);
      this.form.patchValue({
        nombre: servicio.nombre,
        descripcion: servicio.descripcion,
        precio: servicio.precio,
        duracionMinutos: servicio.duracionMinutos,
        esCombo: servicio.esCombo,
        serviciosComboIds: [] // El backend aún no nos devuelve los ids del combo en el listado, pero se puede agregar después
      });
    } else {
      this.isEditing.set(false);
      this.editingId.set(null);
      this.form.reset({ precio: 0, duracionMinutos: 30, esCombo: false, serviciosComboIds: [] });
    }
    this.showForm.set(true);
  }

  closeForm() {
    this.showForm.set(false);
    this.form.reset();
  }

  onSubmit() {
    if (this.form.invalid) return;

    const dto = this.form.value;
    
    if (this.isEditing() && this.editingId()) {
      this.serviciosService.actualizarServicio(this.editingId()!, dto).subscribe(() => {
        this.closeForm();
      });
    } else {
      this.serviciosService.crearServicio(dto).subscribe(() => {
        this.closeForm();
      });
    }
  }

  confirmDelete(id: string) {
    if (confirm('¿Estás seguro de eliminar este servicio?')) {
      this.serviciosService.eliminarServicio(id).subscribe();
    }
  }
}
