import { Component, HostListener, OnInit, signal, inject } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../core/services/tenant.service';
import type { BarberiaResumen } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';
import { ReservasService } from '../../core/services/reservas.service';
import { PagosService } from '../../core/services/pagos.service';
import { parsearInvitacion } from '../../core/utils/invitacion.util';
import { SedeCardComponent } from '../barberias/components/sede-card/sede-card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, CurrencyPipe, SedeCardComponent],
  template: `
    <div class="relative min-h-[150vh] perspective-1200 overflow-hidden bg-ambient-mesh">
      
      <!-- Fondo dinámico con paralaje 3D -->
      <div class="fixed inset-0 pointer-events-none z-0 transform-style-3d transition-transform duration-75 ease-out"
           [style.transform]="'translateZ(-500px) scale(1.5) translateY(' + (scrollY() * 0.5) + 'px)'">
        <div class="absolute inset-0 bg-obsidian opacity-40"></div>
        <!-- Elementos flotantes de fondo -->
        <div class="absolute top-1/4 left-1/4 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl"></div>
        <div class="absolute bottom-1/3 right-1/4 w-96 h-96 bg-amber-600/5 rounded-full blur-3xl"></div>
      </div>

      <!-- Contenedor principal con efecto de inclinación del mouse -->
      <div class="relative z-10 space-y-24 py-12 transform-style-3d transition-transform duration-300 ease-out"
           [style.transform]="'rotateX(' + (mouseY() * -5) + 'deg) rotateY(' + (mouseX() * 5) + 'deg)'">
        
        <!-- HERO 3D SECTION SEGÚN ROL -->
        <section class="relative text-center max-w-4xl mx-auto pt-16 pb-8 space-y-6 transform-style-3d"
                 [style.transform]="'translateZ(' + (scrollY() * 0.2) + 'px)'">
          
          <!-- ROL: CLIENTE -->
          @if (userRole() === 'CLIENTE') {
            <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wider backdrop-blur-md shadow-[0_0_20px_rgba(212,175,55,0.2)] hover:scale-110 hover:shadow-[0_0_30px_rgba(212,175,55,0.4)] transition-all duration-500 transform translate-z-12">
              <i class="pi pi-crown text-amber-400"></i>
              <span>Plataforma de Barberías Premium</span>
            </div>

            <h1 class="text-5xl sm:text-7xl lg:text-8xl font-display font-extrabold tracking-tight text-white leading-[1.1] transform translate-z-24 drop-shadow-2xl">
              La Experiencia Suprema en
              <span class="block gold-gradient-text drop-shadow-[0_0_30px_rgba(212,175,55,0.3)]">Corte, Cuidado y Estilo</span>
            </h1>

            <p class="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed transform translate-z-12">
              Agenda tus turnos en tiempo real con precisión milimétrica, consulta el catálogo de servicios de tu barbería favorita y accede a tu ficha técnica personalizada.
            </p>

            <div class="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-8 transform translate-z-24">
              <a routerLink="/reservas/nueva"
                 class="px-8 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_40px_rgba(212,175,55,0.3)] hover:shadow-[0_20px_60px_rgba(212,175,55,0.5)] hover:-translate-y-2 hover:scale-105 transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-calendar-plus text-base"></i>
                <span>Agendar Cita Ahora</span>
              </a>

              <a routerLink="/reservas/mis-reservas"
                 class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-200 glass-card hover:text-amber-400 hover:border-amber-500/50 hover:-translate-y-2 hover:shadow-[0_10px_30px_rgba(0,0,0,0.8)] transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-history text-amber-400"></i>
                <span>Mis Citas</span>
              </a>

              <a routerLink="/barberias"
                 class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-2">
                <i class="pi pi-building text-xs"></i>
                <span>Barberías</span>
              </a>
            </div>
          }

          <!-- ROL: BARBERO -->
          @if (userRole() === 'BARBERO') {
            <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-semibold uppercase tracking-wider backdrop-blur-md shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:scale-110 transition-all duration-500 transform translate-z-12">
              <i class="pi pi-id-card text-blue-400"></i>
              <span>Panel Profesional del Barbero</span>
            </div>

            <h1 class="text-5xl sm:text-7xl lg:text-8xl font-display font-extrabold tracking-tight text-white leading-[1.1] transform translate-z-24 drop-shadow-2xl">
              Tu Estación de Trabajo &
              <span class="block gold-gradient-text drop-shadow-[0_0_30px_rgba(212,175,55,0.3)]">Agenda en Tiempo Real</span>
            </h1>

            <p class="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed transform translate-z-12">
              Supervisa las reservas del día, actualiza el estado de los turnos en vivo, gestiona cobros presenciales y consulta el catálogo de cortes de tu sede.
            </p>

            <div class="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-8 transform translate-z-24">
              <a routerLink="/admin/agenda"
                 class="px-8 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_40px_rgba(212,175,55,0.3)] hover:shadow-[0_20px_60px_rgba(212,175,55,0.5)] hover:-translate-y-2 hover:scale-105 transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-calendar text-base"></i>
                <span>Abrir Mi Agenda de Turnos</span>
              </a>

              <a routerLink="/catalogo"
                 class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-200 glass-card hover:text-amber-400 hover:border-amber-500/50 hover:-translate-y-2 transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-list text-amber-400"></i>
                <span>Catálogo de Cortes</span>
              </a>

              <a routerLink="/barberias"
                 class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-2">
                <i class="pi pi-building text-xs"></i>
                <span>Mi Barbería</span>
              </a>
            </div>
          }

          <!-- ROL: ADMIN_BARBERIA -->
          @if (userRole() === 'ADMIN_BARBERIA') {
            <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold uppercase tracking-wider backdrop-blur-md shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:scale-110 transition-all duration-500 transform translate-z-12">
              <i class="pi pi-briefcase text-emerald-400"></i>
              <span>Centro de Gestión de Barbería</span>
            </div>

            <h1 class="text-5xl sm:text-7xl lg:text-8xl font-display font-extrabold tracking-tight text-white leading-[1.1] transform translate-z-24 drop-shadow-2xl">
              Gestión Integral de tu
              <span class="block gold-gradient-text drop-shadow-[0_0_30px_rgba(212,175,55,0.3)]">Sede & Servicios</span>
            </h1>

            <p class="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed transform translate-z-12">
              Modifica tarifas, administra tu personal local, supervisa la agenda de tu barbería y mantén el control operativo total de tu negocio.
            </p>

            <div class="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-8 transform translate-z-24">
              <a routerLink="/admin/servicios"
                 class="px-8 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_40px_rgba(212,175,55,0.3)] hover:shadow-[0_20px_60px_rgba(212,175,55,0.5)] hover:-translate-y-2 hover:scale-105 transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-cog text-base"></i>
                <span>Mis Servicios & Precios</span>
              </a>

              <a routerLink="/admin/agenda"
                 class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-200 glass-card hover:text-amber-400 hover:border-amber-500/50 hover:-translate-y-2 transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-calendar text-amber-400"></i>
                <span>Mi Agenda Local</span>
              </a>
            </div>
          }

          <!-- ROL: SUPER ADMIN -->
          @if (userRole() === 'ADMINISTRADOR') {
            <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-semibold uppercase tracking-wider backdrop-blur-md shadow-[0_0_20px_rgba(168,85,247,0.2)] hover:scale-110 transition-all duration-500 transform translate-z-12">
              <i class="pi pi-shield text-purple-400"></i>
              <span>Centro de Control Administrativo (Plataforma)</span>
            </div>

            <h1 class="text-5xl sm:text-7xl lg:text-8xl font-display font-extrabold tracking-tight text-white leading-[1.1] transform translate-z-24 drop-shadow-2xl">
              Gestión Integral de
              <span class="block gold-gradient-text drop-shadow-[0_0_30px_rgba(212,175,55,0.3)]">Sedes, Servicios & Auditoría</span>
            </h1>

            <p class="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed transform translate-z-12">
              Modifica tarifas globales, supervisa la agenda de todos los barberos, administra sedes y mantén el control operativo con integridad multi-tenant garantizada.
            </p>

            <div class="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-8 transform translate-z-24">
              <a routerLink="/admin/servicios"
                 class="px-8 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_40px_rgba(212,175,55,0.3)] hover:shadow-[0_20px_60px_rgba(212,175,55,0.5)] hover:-translate-y-2 hover:scale-105 transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-cog text-base"></i>
                <span>Catálogo Global</span>
              </a>

              <a routerLink="/admin/agenda"
                 class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-200 glass-card hover:text-amber-400 hover:border-amber-500/50 hover:-translate-y-2 transition-all duration-500 flex items-center gap-2.5">
                <i class="pi pi-calendar text-amber-400"></i>
                <span>Agenda Global</span>
              </a>

              <a routerLink="/barberias"
                 class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-300 glass-card hover:text-white transition-all flex items-center gap-2">
                <i class="pi pi-building text-amber-400"></i>
                <span>Gestionar Todas las Sedes</span>
              </a>
            </div>
          }
        </section>

        <!-- BARBERÍA ACTIVA HIGHLIGHT BANNER -->
        @if (tenantService.barberiaActiva(); as barberia) {
          <section class="max-w-4xl mx-auto transform-style-3d transition-all duration-700"
                   [style.transform]="'translateZ(' + (scrollY() > 100 ? 50 : 0) + 'px)'"
                   [style.opacity]="scrollY() > 50 ? 1 : 0.8">
            <div class="glass-panel rounded-3xl p-8 border border-amber-500/40 shadow-[0_20px_60px_rgba(0,0,0,0.8)] relative overflow-hidden group hover:scale-[1.02] transition-transform duration-500">
              <div class="absolute -right-20 -bottom-20 w-64 h-64 bg-amber-500/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>
              
              <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
                <div class="space-y-2 transform translate-z-12">
                  <div class="flex items-center gap-2">
                    <span class="inline-block w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]"></span>
                    <span class="text-xs font-bold text-amber-400 uppercase tracking-widest letter-spacing-2">Barbería Activa Conectada</span>
                  </div>
                  <h3 class="text-3xl font-display font-bold text-white drop-shadow-md">{{ barberia.nombre }}</h3>
                  <p class="text-sm text-zinc-400 flex items-center gap-2 font-medium">
                    <i class="pi pi-map-marker text-amber-500"></i>{{ barberia.ubicacion }}
                    <span class="text-zinc-600">&bull;</span>
                    <i class="pi pi-phone text-amber-500"></i>{{ barberia.telefono }}
                  </p>
                </div>

                <div class="flex items-center gap-4 transform translate-z-24">
                  @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'ADMINISTRADOR') {
                    <a routerLink="/admin/servicios" class="px-5 py-3 rounded-xl text-sm font-bold text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 hover:text-amber-400 border border-zinc-600/50 hover:border-amber-500/50 transition-all duration-300 flex items-center gap-2 hover:-translate-y-1 shadow-lg">
                      <i class="pi pi-cog"></i>Servicios
                    </a>
                    <a routerLink="/admin/agenda" class="px-6 py-3 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-[0_10px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_15px_30px_rgba(212,175,55,0.4)] hover:-translate-y-1 hover:scale-105 transition-all duration-300 flex items-center gap-2">
                      <i class="pi pi-calendar"></i>Ver Agenda
                    </a>
                  } @else if (userRole() === 'BARBERO') {
                    <a routerLink="/catalogo" class="px-5 py-3 rounded-xl text-sm font-bold text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 hover:text-amber-400 border border-zinc-600/50 hover:border-amber-500/50 transition-all duration-300 flex items-center gap-2 hover:-translate-y-1 shadow-lg">
                      <i class="pi pi-list"></i>Catálogo
                    </a>
                    <a routerLink="/admin/agenda" class="px-6 py-3 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-[0_10px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_15px_30px_rgba(212,175,55,0.4)] hover:-translate-y-1 hover:scale-105 transition-all duration-300 flex items-center gap-2">
                      <i class="pi pi-calendar"></i>Mi Agenda
                    </a>
                  } @else {
                    <a routerLink="/catalogo" class="px-5 py-3 rounded-xl text-sm font-bold text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 hover:text-amber-400 border border-zinc-600/50 hover:border-amber-500/50 transition-all duration-300 flex items-center gap-2 hover:-translate-y-1 shadow-lg">
                      <i class="pi pi-list"></i>Ver Servicios
                    </a>
                    <a routerLink="/reservas/nueva" class="px-6 py-3 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-[0_10px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_15px_30px_rgba(212,175,55,0.4)] hover:-translate-y-1 hover:scale-105 transition-all duration-300 flex items-center gap-2">
                      <i class="pi pi-bolt"></i>Reservar Turno
                    </a>
                  }
                </div>
              </div>
            </div>
          </section>
        }

        <!--
          E3-12/2 · LA PUERTA DE ENTRADA DEL CLIENTE (regla 1.10).

          Un solo campo para las dos formas de entrar: el código de 8 caracteres
          que se dicta en el mostrador y el enlace único que viaja en el QR
          (completo o pegado a medias). El texto lo traduce la utilidad de
          invitación y el vínculo lo crea el backend con la regla de D10 en
          POST /mi-estado/unirse; aquí solo se cuenta lo que responda —ACTIVO o
          PENDIENTE_APROBACION— y TenantService recarga la lista de sedes tras el
          200, así que la tarjeta nueva aparece sola.
        -->
        @if (userRole() === 'CLIENTE') {
          <section class="max-w-6xl mx-auto px-4 transform-style-3d">
            <div class="glass-card rounded-3xl p-6 sm:p-8 border border-amber-500/25">
              <h2 class="text-xl font-display font-bold text-white flex items-center gap-3 mb-1">
                <i class="pi pi-link text-amber-400"></i> Unirme a una barbería
              </h2>
              <p class="text-xs text-zinc-400 mb-5">
                Introduce el código de 8 caracteres o pega el enlace que te compartió la sede.
              </p>

              <div class="flex flex-col sm:flex-row gap-3">
                <input type="text"
                       name="invitacionPegada"
                       [(ngModel)]="invitacionPegada"
                       (ngModelChange)="limpiarAviso()"
                       (keyup.enter)="unirse()"
                       [disabled]="uniendo()"
                       placeholder="ABCD1234  ó  https://…/unirse/mi-sede"
                       class="flex-1 bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3.5 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner font-mono text-sm">
                <button (click)="unirse()"
                        [disabled]="!invitacionPegada.trim() || uniendo()"
                        class="px-6 py-3.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg shadow-amber-500/20 hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 transition-all flex items-center justify-center gap-2">
                  <i class="pi" [ngClass]="uniendo() ? 'pi-spin pi-spinner' : 'pi-sign-in'"></i>
                  <span>Unirme a una Barbería</span>
                </button>
              </div>

              @if (mensajeUnion(); as mensaje) {
                <div class="mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs flex items-start gap-2">
                  <i class="pi pi-check-circle mt-0.5"></i>
                  <span>{{ mensaje }}</span>
                </div>
              }

              @if (errorUnion(); as error) {
                <div class="mt-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-start gap-2">
                  <i class="pi pi-exclamation-triangle mt-0.5"></i>
                  <span>{{ error }}</span>
                </div>
              }
            </div>
          </section>
        }

        <!--
          H72 · MIS BARBERÍAS (dashboard del CLIENTE).

          La lista la sirve GET /mi-estado/barberias a través de
          TenantService.cargarBarberias(), ya filtrada por el backend: solo
          vínculos ACTIVO o PENDIENTE_APROBACION y solo sedes activas, así
          que aquí no hay que descartar nada. El estado del vínculo se lee en
          cada tarjeta, que es la misma que usa «Tus Barberías».
        -->
        @if (userRole() === 'CLIENTE' && tenantService.barberiasVinculadas().length > 0) {
          <section class="max-w-6xl mx-auto transform-style-3d">
            <div class="flex flex-wrap items-center justify-between gap-4 mb-6 transform translate-z-12">
              <h2 class="text-2xl font-display font-bold text-white flex items-center gap-3">
                <i class="pi pi-building text-amber-400"></i> Mis Barberías
              </h2>
              <a routerLink="/barberias"
                 class="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-2">
                <span>Gestionar mis vínculos</span><i class="pi pi-arrow-right text-[10px]"></i>
              </a>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 transform-style-3d">
              @for (sede of tenantService.barberiasVinculadas(); track sede.id) {
                <app-sede-card [barberia]="sede" [esActiva]="sede.id === tenantService.barberiaActivaId()">
                  <div class="flex gap-3">
                    @if (sede.id === tenantService.barberiaActivaId()) {
                      <a routerLink="/reservas/nueva"
                         class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-md shadow-amber-500/20 hover:scale-105 transition-transform flex items-center justify-center gap-2">
                        <i class="pi pi-calendar-plus"></i> Reservar
                      </a>
                    } @else if (puedeSeleccionar(sede)) {
                      <button (click)="seleccionarSede(sede.id)"
                              class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-md shadow-amber-500/20 hover:scale-105 transition-transform flex items-center justify-center gap-2">
                        <i class="pi pi-check-circle"></i> Seleccionar
                      </button>
                    } @else {
                      <!--
                        PENDIENTE_APROBACION (D10): la sede todavía no opera para
                        este cliente, así que no se ofrece seleccionarla —el
                        backend respondería 403— ni reservar en ella.
                      -->
                      <span class="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold text-amber-300/80 bg-amber-500/10 border border-amber-500/30 flex items-center justify-center gap-2 cursor-default">
                        <i class="pi pi-clock"></i> Esperando aprobación
                      </span>
                    }
                  </div>

                  <a routerLink="/barberias"
                     class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold text-zinc-300 bg-white/5 border border-zinc-700/60 hover:border-amber-500/40 hover:text-amber-300 transition-colors flex items-center justify-center gap-2">
                    <i class="pi pi-cog"></i>
                    <span>Ver mi vínculo y gestionar</span>
                  </a>
                </app-sede-card>
              }
            </div>
          </section>
        } @else if (userRole() === 'CLIENTE') {
          <section class="max-w-6xl mx-auto transform-style-3d">
            <div class="glass-card rounded-3xl p-12 sm:p-8 text-center transform translate-z-12">
              <div class="w-20 h-20 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-6">
                <i class="pi pi-building text-amber-400 text-4xl"></i>
              </div>
              <h2 class="text-3xl font-display font-bold text-white mb-4">No tienes barberías vinculadas</h2>
              <p class="text-zinc-400 text-sm mb-8">No has vinculado ninguna barbería a tu cuenta aún.</p>
              <button routerLink="/barberias"
                      class="px-8 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_40px_rgba(212,175,55,0.5)] hover:-translate-y-1 transition-all flex items-center justify-center gap-2">
                <i class="pi pi-calendar-plus"></i>
                Agendar mi primera cita
              </button>
            </div>
          </section>
        }

        <!-- DASHBOARD ADMIN: MÉTRICAS FINANCIERAS -->
        @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'ADMINISTRADOR') {
          <section class="max-w-6xl mx-auto pt-4 pb-8 transform-style-3d"
                   [style.transform]="'translateZ(' + (scrollY() > 150 ? 40 : 0) + 'px)'">
            <h2 class="text-2xl font-display font-bold text-white mb-6 transform translate-z-12 flex items-center gap-3">
              <i class="pi pi-chart-line text-amber-400"></i> Métricas del Día
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <!-- Tarjeta: Ingresos del Día -->
              <div class="glass-card rounded-3xl p-6 border border-emerald-500/30 shadow-[0_15px_40px_rgba(16,185,129,0.15)] hover:-translate-y-2 transition-transform duration-500 transform translate-z-8 relative overflow-hidden group">
                <div class="absolute -right-10 -top-10 w-32 h-32 bg-emerald-500/20 rounded-full blur-2xl group-hover:bg-emerald-500/30 transition-colors"></div>
                <div class="relative z-10 flex flex-col gap-2">
                  <div class="flex justify-between items-start">
                    <span class="text-sm font-bold text-zinc-400 uppercase tracking-wider">Ingresos Hoy</span>
                    <i class="pi pi-dollar text-emerald-400 bg-emerald-500/10 p-2 rounded-xl"></i>
                  </div>
                  <span class="text-4xl font-display font-bold text-white drop-shadow-md">
                    {{ ingresosHoy() | currency:'USD':'symbol':'1.0-0' }}
                  </span>
                  <span class="text-xs text-emerald-400 font-medium">Facturado hoy</span>
                </div>
              </div>

              <!-- Tarjeta: Turnos -->
              <div class="glass-card rounded-3xl p-6 border border-amber-500/30 shadow-[0_15px_40px_rgba(212,175,55,0.15)] hover:-translate-y-2 transition-transform duration-500 transform translate-z-8 relative overflow-hidden group">
                <div class="absolute -right-10 -top-10 w-32 h-32 bg-amber-500/20 rounded-full blur-2xl group-hover:bg-amber-500/30 transition-colors"></div>
                <div class="relative z-10 flex flex-col gap-2">
                  <div class="flex justify-between items-start">
                    <span class="text-sm font-bold text-zinc-400 uppercase tracking-wider">Turnos Completados</span>
                    <i class="pi pi-calendar-check text-amber-400 bg-amber-500/10 p-2 rounded-xl"></i>
                  </div>
                  <span class="text-4xl font-display font-bold text-white drop-shadow-md">
                    {{ completadosHoy() }}
                  </span>
                  <span class="text-xs text-zinc-400 font-medium">
                    <span class="text-red-400">{{ canceladosHoy() }}</span> cancelados/ausentes
                  </span>
                </div>
              </div>

              <!-- Tarjeta: Barbero Top -->
              <div class="glass-card rounded-3xl p-6 border border-blue-500/30 shadow-[0_15px_40px_rgba(59,130,246,0.15)] hover:-translate-y-2 transition-transform duration-500 transform translate-z-8 relative overflow-hidden group">
                <div class="absolute -right-10 -top-10 w-32 h-32 bg-blue-500/20 rounded-full blur-2xl group-hover:bg-blue-500/30 transition-colors"></div>
                <div class="relative z-10 flex flex-col gap-2">
                  <div class="flex justify-between items-start">
                    <span class="text-sm font-bold text-zinc-400 uppercase tracking-wider">Productividad Top</span>
                    <i class="pi pi-star text-blue-400 bg-blue-500/10 p-2 rounded-xl"></i>
                  </div>
                  <span class="text-3xl font-display font-bold text-white drop-shadow-md truncate">
                    {{ barberoProductivo() }}
                  </span>
                  <span class="text-xs text-blue-400 font-medium">Líder en turnos hoy</span>
                </div>
              </div>
              
            </div>
          </section>
        }

        <!-- CARDS CON PROFUNDIDAD ESPACIAL 3D ADAPTADAS AL ROL -->
        <section class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto pt-10 transform-style-3d">
          
          <!-- ROL: CLIENTE -->
          @if (userRole() === 'CLIENTE') {
            <a routerLink="/reservas/nueva" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-bolt"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Agendar Cita en Vivo</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Motor de concurrencia con aislamiento transaccional estricto. Cero dobles reservas y cálculo de disponibilidad al instante.
              </p>
            </a>

            <a routerLink="/catalogo" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-6 hover:scale-105 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 60 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-list"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Catálogo & Precios Congelados</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Servicios individuales y combos combinados con historial financiero congelado al momento del agendamiento.
              </p>
            </a>

            <a routerLink="/reservas/mis-reservas" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-history"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Mis Citas & Ficha Técnica</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Tus observaciones de corte y estilos quedan registrados bajo anonimización inter-barberías de estricta protección de datos personales.
              </p>
            </a>
          }

          <!-- ROL: BARBERO -->
          @if (userRole() === 'BARBERO') {
            <a routerLink="/admin/agenda" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 text-2xl shadow-inner group-hover:bg-blue-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-calendar"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-blue-300 transition-colors">Mi Agenda Diaria</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Consulta los turnos del día, filtra por fechas y cambia el estado de las citas en tiempo real (Pendiente, Completada, Cancelada).
              </p>
            </a>

            <a routerLink="/admin/agenda" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-6 hover:scale-105 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 60 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-dollar"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Cobros Presenciales</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Registra el pago de los turnos completados en efectivo o tarjeta con soporte de propina y cálculo automático.
              </p>
            </a>

            <a routerLink="/catalogo" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl shadow-inner group-hover:bg-emerald-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-list"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-emerald-300 transition-colors">Catálogo de Servicios</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Revisa los servicios y tiempos de duración asignados a tu sede para planificar tus cortes con exactitud.
              </p>
            </a>
          }

          <!-- ROL: ADMIN_BARBERIA -->
          @if (userRole() === 'ADMIN_BARBERIA') {
            <!-- Se han removido las cards redundantes de servicios y agenda que ya estaban en el hero -->
            <a routerLink="/admin/personal" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-users"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Mi Personal Local</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Administra a tus barberos en esta sede, cambia roles y coordina los horarios operativos.
              </p>
            </a>

            <a routerLink="/admin/tickets" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-6 hover:scale-105 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 60 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl shadow-inner group-hover:bg-emerald-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-receipt"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-emerald-300 transition-colors">Pagos & Facturación</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Revisa los ingresos generados en la caja de tu sede y obtén reportes detallados.
              </p>
            </a>
          }

          <!-- ROL: ADMINISTRADOR -->
          @if (userRole() === 'ADMINISTRADOR') {
            <!-- Se han removido las redundancias. Mantenemos opciones globales específicas -->
            <a routerLink="/barberias" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 text-2xl shadow-inner group-hover:bg-purple-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-building"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-purple-300 transition-colors">Gestión Global de Sedes</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Crea nuevas franquicias, supervisa códigos de acceso seguros e inspecciona la red completa.
              </p>
            </a>

            <a routerLink="/admin/antecedentes" class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-6 hover:scale-105 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d block"
                 [style.transform]="'translateZ(' + (scrollY() > 200 ? 60 : 0) + 'px)'">
              <div class="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 text-2xl shadow-inner group-hover:bg-rose-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
                <i class="pi pi-shield"></i>
              </div>
              <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-rose-300 transition-colors">Auditoría Antecedentes</h4>
              <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
                Panel global de seguridad. Revisa alertas y controla el estado de bloqueo de usuarios de toda la red.
              </p>
            </a>
          }

        </section>
      </div>
    </div>
  `,
})
export class HomeComponent implements OnInit {
  protected readonly tenantService = inject(TenantService);
  protected readonly authService = inject(AuthService);
  protected readonly reservasService = inject(ReservasService);
  protected readonly pagosService = inject(PagosService);

  // Señales reactivas para el motor 3D
  scrollY = signal<number>(0);
  mouseX = signal<number>(0);
  mouseY = signal<number>(0);

  // Métricas Dashboard Admin
  ingresosHoy = signal<number>(0);
  completadosHoy = signal<number>(0);
  canceladosHoy = signal<number>(0);
  barberoProductivo = signal<string>('N/A');

  ngOnInit() {
    if (this.userRole() === 'ADMIN_BARBERIA' || this.userRole() === 'ADMINISTRADOR') {
      this.cargarMetricas();
    }
  }

  cargarMetricas() {
    const hoy = new Date().toISOString().split('T')[0];
    
    // 1. Obtener Agenda del Día
    this.reservasService.obtenerAgendaDiaria(hoy).subscribe((agenda) => {
       const completados = agenda.filter((t: any) => t.estado === 'COMPLETADA');
       const cancelados = agenda.filter((t: any) => t.estado === 'CANCELADA' || t.estado === 'NO_ASISTIO');
       this.completadosHoy.set(completados.length);
       this.canceladosHoy.set(cancelados.length);

       // Barbero más productivo
       const barberosCounts: Record<string, number> = {};
       completados.forEach((t: any) => {
         const bId = t.barbero?.nombreCompleto || 'Sin Asignar';
         barberosCounts[bId] = (barberosCounts[bId] || 0) + 1;
       });
       if (Object.keys(barberosCounts).length > 0) {
         const max = Object.entries(barberosCounts).reduce((a, b) => a[1] > b[1] ? a : b);
         this.barberoProductivo.set(max[0]);
       }
    });

    // 2. Obtener los cobros del DÍA (ingresos). H68: el historial sale de la tabla
    //    de pagos, un pago ANULADO no es ingreso (§7.4) y la fecha del cobro es
    //    `registradoAt`, no la del rastro de auditoría.
    this.pagosService.obtenerHistorial().subscribe((pagos) => {
       const cobrosHoy = pagos.filter(
         (p) => p.estadoPago !== 'ANULADO' && (p.registradoAt ?? '').startsWith(hoy),
       );
       const suma = cobrosHoy.reduce((acc, p) => acc + Number(p.monto || 0), 0);
       this.ingresosHoy.set(suma);
    });
  }

  // ── E3-12/2 · la puerta de entrada del cliente (regla 1.10) ──────────────

  /**
   * Lo que el cliente pegó: un código, un enlace o una URL con el enlace dentro.
   * Es una propiedad normal (y no una señal) porque `[(ngModel)]` tiene que
   * poder escribir en ella, igual que el modal de vinculación que ya existía.
   */
  invitacionPegada = '';
  readonly uniendo = signal(false);
  readonly mensajeUnion = signal<string | null>(null);
  readonly errorUnion = signal<string | null>(null);

  /** Un texto nuevo borra el aviso del intento anterior. */
  limpiarAviso(): void {
    this.mensajeUnion.set(null);
    this.errorUnion.set(null);
  }

  /**
   * E3-12/2 · el cliente ENTRA en una sede.
   *
   * El backend es el único que decide el resultado: si es su sexta barbería, el
   * vínculo nace `PENDIENTE_APROBACION` (D10) y aquí se dice con esas palabras en
   * vez de dar la unión por hecha. La lista de sedes se recarga dentro de
   * `TenantService.unirsePorInvitacion`, así que la tarjeta de la sede nueva —y
   * su estado— aparece sin que esta pantalla tenga que pedirla otra vez.
   */
  unirse(): void {
    const puerta = parsearInvitacion(this.invitacionPegada);

    if (!puerta) {
      this.mensajeUnion.set(null);
      this.errorUnion.set('Eso no parece un código de acceso ni un enlace de invitación.');
      return;
    }

    this.limpiarAviso();
    this.uniendo.set(true);

    this.tenantService.unirsePorInvitacion(puerta).subscribe({
      next: (vinculo) => {
        this.uniendo.set(false);
        this.invitacionPegada = '';
        this.mensajeUnion.set(
          vinculo.estadoVinculacion === 'PENDIENTE_APROBACION'
            ? 'Tu solicitud quedó en espera: ya tienes cinco barberías vinculadas y la plataforma tiene que autorizar la sexta (D10).'
            : '¡Listo! Ya estás vinculado a la barbería. La verás en «Mis Barberías».',
        );
      },
      error: () => {
        this.uniendo.set(false);
        this.errorUnion.set(this.tenantService.error() ?? 'No se pudo completar la unión.');
      },
    });
  }

  /**
   * H72 · fija la sede activa desde el dashboard del cliente. Es la misma ruta
   * que usa la pantalla de barberías (`PATCH /barberias/:id/seleccionar`), y el
   * backend apaga las demás en la misma transacción. El error se ignora aquí
   * porque `TenantService` ya lo deja en `error()`: si la sede dejara de estar
   * disponible entre la carga y el clic, la pantalla avisa con ese mensaje en
   * vez de romperse.
   */
  seleccionarSede(barberiaId: string): void {
    this.tenantService.seleccionarBarberia(barberiaId).subscribe({ error: () => undefined });
  }

  /**
   * Solo se puede fijar una sede donde el vínculo OPERA: una
   * `PENDIENTE_APROBACION` responde 403 en `/seleccionar` (D10), así que el botón
   * no se ofrece. El staff no trae `estadoVinculacion` en su listado y sigue
   * viendo «Seleccionar» como siempre.
   */
  puedeSeleccionar(sede: BarberiaResumen): boolean {
    return sede.estadoVinculacion !== 'PENDIENTE_APROBACION';
  }

  userRole(): string {
    const roles = this.authService.authState().user?.roles;
    if (!roles || roles.length === 0) return 'CLIENTE';
    if (roles.includes('ADMINISTRADOR')) return 'ADMINISTRADOR';
    if (roles.includes('ADMIN_BARBERIA')) return 'ADMIN_BARBERIA';
    if (roles.includes('BARBERO')) return 'BARBERO';
    return 'CLIENTE';
  }

  @HostListener('window:scroll')
  onScroll() {
    this.scrollY.set(window.scrollY);
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const x = (event.clientX / window.innerWidth) * 2 - 1;
    const y = (event.clientY / window.innerHeight) * 2 - 1;
    this.mouseX.set(x);
    this.mouseY.set(y);
  }
}
