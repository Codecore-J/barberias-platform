import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ServiciosService, Servicio } from '../../core/services/servicios.service';
import { TenantService } from '../../core/services/tenant.service';

@Component({
  selector: 'app-admin-servicios',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-center gap-4 transform translate-z-12">
        <div>
          <h2 class="text-3xl font-display font-bold text-white">Panel de <span class="gold-gradient-text">Servicios</span></h2>
          <p class="text-sm text-zinc-400">Gestiona los servicios y combos de {{ tenantService.nombreBarberiaActiva() }}</p>
        </div>
        <button (click)="openForm()" class="px-5 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:-translate-y-1 hover:scale-105 transition-transform flex items-center gap-2">
          <i class="pi pi-plus"></i> Nuevo Servicio
        </button>
      </div>

      <!-- Estado de Carga Global -->
      @if (serviciosService.isLoading() && !showForm()) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Grid de Servicios -->
      @if (!showForm()) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transform-style-3d">
          @for (servicio of serviciosService.servicios(); track servicio.id) {
            <div class="glass-card rounded-2xl p-6 relative group hover:-translate-y-2 hover:rotate-x-2 transition-all duration-300 transform-style-3d flex flex-col h-full">
              
              <div class="flex justify-between items-start mb-4 transform translate-z-12">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-amber-400">
                    <i [class]="servicio.esCombo ? 'pi pi-star' : 'pi pi-tag'"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-white">{{ servicio.nombre }}</h3>
                    <span class="text-xs text-zinc-400">{{ servicio.duracionMinutos }} min</span>
                  </div>
                </div>
                <div class="font-bold text-amber-400 text-lg">
                  {{ servicio.precio | currency:'USD':'symbol':'1.0-0' }}
                </div>
              </div>

              <p class="text-xs text-zinc-400 line-clamp-2 mb-4 flex-grow transform translate-z-8">
                {{ servicio.descripcion }}
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

        @if (serviciosService.servicios().length === 0 && !serviciosService.isLoading()) {
          <div class="text-center py-20 transform translate-z-12">
            <i class="pi pi-folder-open text-5xl text-zinc-600 mb-4 block"></i>
            <p class="text-zinc-400">No hay servicios registrados.</p>
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

  showForm = signal(false);
  isEditing = signal(false);
  editingId = signal<string | null>(null);

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
