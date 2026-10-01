import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AntecedentesService, Antecedente } from '../../../core/services/antecedentes.service';
import { TenantService } from '../../../core/services/tenant.service';
import { FichaClienteDrawerComponent } from '../../clientes/components/ficha-cliente-drawer/ficha-cliente-drawer.component';

@Component({
  selector: 'app-admin-antecedentes',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, FichaClienteDrawerComponent],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-5xl mx-auto space-y-8 bg-ambient-mesh">
      
      <!-- Encabezado -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-20">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <i class="pi pi-shield text-xs"></i>
            <span>Auditoría Médica y Técnica</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">Aprobación de <span class="text-amber-400">Antecedentes</span></h2>
          <p class="text-sm text-zinc-400">Revisa y aprueba las notas clínicas y condiciones especiales reportadas por tu equipo para {{ tenantService.nombreBarberiaActiva() }}.</p>
        </div>

        <button (click)="cargarPendientes()" 
                class="px-4 py-2 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all flex items-center gap-2">
          <i class="pi pi-refresh" [ngClass]="cargando() ? 'pi-spin' : ''"></i> Actualizar
        </button>
      </div>

      <!-- Estado de carga -->
      @if (cargando()) {
        <div class="flex justify-center items-center py-20 relative z-10">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Sin pendientes -->
      @if (!cargando() && pendientes().length === 0) {
        <div class="glass-panel p-12 text-center rounded-3xl border border-white/5 relative z-10 space-y-4">
          <div class="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-4xl text-emerald-400 shadow-lg">
            <i class="pi pi-check-circle"></i>
          </div>
          <div>
            <h3 class="text-xl font-bold text-white">Todo al día</h3>
            <p class="text-zinc-400 text-sm mt-1">No hay antecedentes pendientes de aprobación médica o técnica en esta sede.</p>
          </div>
        </div>
      }

      <!-- Lista de Pendientes -->
      @if (!cargando() && pendientes().length > 0) {
        <div class="space-y-4 relative z-10">
          <div class="text-xs text-zinc-400 font-medium">
            Mostrando <span class="text-amber-400 font-bold">{{ pendientes().length }}</span> reporte(s) pendiente(s) de revisión:
          </div>

          @for (ant of pendientes(); track ant.id) {
            <div class="glass-panel p-6 rounded-3xl border border-amber-500/30 shadow-xl flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
              
              <div class="space-y-3 flex-1">
                <div class="flex flex-wrap items-center gap-2.5">
                  <span class="px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border border-amber-500/30 text-amber-400 bg-amber-500/10">
                    PENDIENTE DE REVISIÓN
                  </span>
                  
                  @if (ant.severidad) {
                    <span class="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-lg border"
                          [ngClass]="{
                            'bg-rose-500/10 text-rose-400 border-rose-500/30': ant.severidad === 'ALTA' || ant.severidad === 'CRITICA',
                            'bg-amber-500/10 text-amber-400 border-amber-500/30': ant.severidad === 'MEDIA' || ant.severidad === 'MODERADA',
                            'bg-emerald-500/10 text-emerald-400 border-emerald-500/30': ant.severidad === 'BAJA' || ant.severidad === 'LEVE'
                          }">
                      Severidad: {{ ant.severidad }}
                    </span>
                  }

                  <span class="text-xs text-zinc-400"><i class="pi pi-clock mr-1 text-[11px]"></i>{{ ant.creadoAt | date:'medium' }}</span>
                </div>
                
                <div>
                  <div class="flex items-center gap-3 mb-1.5">
                    <h4 class="text-lg font-bold text-white">
                      Cliente: <span class="text-amber-400">{{ ant.cliente?.nombreCompleto || 'Desconocido' }}</span>
                    </h4>
                    <button (click)="abrirFicha(ant.clienteId, ant.cliente?.nombreCompleto || 'Cliente')"
                            class="px-2.5 py-1 rounded-lg text-xs font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all flex items-center gap-1.5"
                            title="Abrir historial clínico y citas">
                      <i class="pi pi-id-card text-xs"></i> Ver Ficha
                    </button>
                  </div>

                  <p class="text-sm text-zinc-300 bg-black/40 p-3.5 rounded-2xl border border-white/5 leading-relaxed font-sans">
                    "{{ ant.descripcion }}"
                  </p>
                </div>
                
                <div class="text-xs text-zinc-500 flex items-center gap-2">
                  <i class="pi pi-user text-amber-400/70"></i> 
                  <span>Reportado por:</span> 
                  <strong class="text-zinc-300">{{ ant.barbero?.nombreCompleto || 'Barbero del equipo' }}</strong>
                </div>
              </div>

              <!-- Acciones -->
              <div class="flex flex-col sm:flex-row md:flex-col gap-2.5 w-full md:w-44 shrink-0">
                <button (click)="aprobar(ant)" [disabled]="procesando() === ant.id"
                        class="w-full px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all shadow-lg shadow-emerald-950/40">
                  <i class="pi" [ngClass]="procesando() === ant.id ? 'pi-spin pi-spinner' : 'pi-check'"></i> Aprobar
                </button>
                <button (click)="rechazar(ant)" [disabled]="procesando() === ant.id"
                        class="w-full px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 transition-all">
                  <i class="pi pi-times"></i> Rechazar
                </button>
              </div>

            </div>
          }
        </div>
      }

      <!-- DRAWER DE FICHA TÉCNICA DEL CLIENTE -->
      @if (clienteSeleccionado()) {
        <app-ficha-cliente-drawer
          [clienteId]="clienteSeleccionado()!.id"
          [clienteNombre]="clienteSeleccionado()!.nombre"
          (close)="clienteSeleccionado.set(null)">
        </app-ficha-cliente-drawer>
      }

    </div>
  `
})
export class AdminAntecedentesComponent implements OnInit {
  private antecedentesService = inject(AntecedentesService);
  protected tenantService = inject(TenantService);

  pendientes = signal<Antecedente[]>([]);
  cargando = signal(true);
  procesando = signal<string | null>(null);

  clienteSeleccionado = signal<{ id: string; nombre: string } | null>(null);

  ngOnInit() {
    this.cargarPendientes();
  }

  cargarPendientes() {
    const bId = this.tenantService.barberiaActiva()?.id;
    if (!bId) return;

    this.cargando.set(true);
    this.antecedentesService.obtenerPendientes(bId).subscribe({
      next: (data) => {
        this.pendientes.set(data || []);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false)
    });
  }

  abrirFicha(id: string, nombre: string) {
    if (!id) return;
    this.clienteSeleccionado.set({ id, nombre });
  }

  aprobar(ant: Antecedente) {
    const bId = this.tenantService.barberiaActiva()?.id;
    if (!bId || !confirm('¿Estás seguro de aprobar este antecedente? Será visible en la ficha técnica del cliente.')) return;

    this.procesando.set(ant.id);
    this.antecedentesService.evaluar(bId, ant.id, 'APROBADO').subscribe({
      next: () => {
        this.cargarPendientes();
        this.procesando.set(null);
      },
      error: () => this.procesando.set(null)
    });
  }

  rechazar(ant: Antecedente) {
    const motivo = prompt('Por favor, indica el motivo del rechazo:');
    if (motivo === null) return;
    if (!motivo.trim()) {
      alert('El motivo es obligatorio para rechazar.');
      return;
    }

    const bId = this.tenantService.barberiaActiva()?.id;
    if (!bId) return;

    this.procesando.set(ant.id);
    this.antecedentesService.evaluar(bId, ant.id, 'RECHAZADO', motivo).subscribe({
      next: () => {
        this.cargarPendientes();
        this.procesando.set(null);
      },
      error: () => this.procesando.set(null)
    });
  }
}
