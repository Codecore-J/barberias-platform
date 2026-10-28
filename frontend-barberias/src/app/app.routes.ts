import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: 'auth/login',
    loadComponent: () => import('./auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/register',
    loadComponent: () => import('./auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    //
    // V2.1 · verificación OTP del teléfono (6 dígitos por WhatsApp).
    //
    // Va FUERA del `authGuard` a propósito: es el guard quien manda aquí a
    // quien tiene sesión sin teléfono verificado, y proteger la propia pantalla
    // con él cerraría el camino en bucle. El componente comprueba por su cuenta
    // que haya token y manda al login si no lo hay.
    //
    path: 'auth/verify',
    loadComponent: () =>
      import('./auth/verify/verify-otp.component').then((m) => m.VerifyOtpComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./shared/layout/app-layout.component').then((m) => m.AppLayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'barberias',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/barberias/barberias.component').then((m) => m.BarberiasComponent),
      },
      {
        //
        // E3-12/2 · destino del enlace único y de su QR (regla 1.10). Vive dentro
        // del layout y bajo `authGuard` porque el vínculo que crea es el de un
        // CLIENTE: a quien llegue sin sesión se le pide entrar antes, en vez de
        // crear un vínculo que nadie podría reclamar después.
        //
        path: 'unirse/:enlaceUnico',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/barberias/unirse/unirse.component').then((m) => m.UnirseComponent),
      },
      {
        path: 'barberias/nueva',
        canActivate: [authGuard, roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/barberias/crear-barberia.component').then((m) => m.CrearBarberiaComponent),
      },
      {
        path: 'reservas/nueva',
        canActivate: [tenantGuard],
        loadComponent: () =>
          import('./features/reservas/reserva-wizard.component').then((m) => m.ReservaWizardComponent),
      },
      {
        path: 'reservar',
        canActivate: [tenantGuard],
        loadComponent: () =>
          import('./features/reservas/reserva-wizard.component').then((m) => m.ReservaWizardComponent),
      },
      {
        path: 'admin/agenda',
        canActivate: [tenantGuard, roleGuard(['ADMIN', 'BARBERO'])],
        loadComponent: () =>
          import('./features/agenda/admin-agenda.component').then((m) => m.AdminAgendaComponent),
      },
      {
        path: 'reservas/mis-reservas',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/reservas/mis-reservas.component').then((m) => m.MisReservasComponent),
      },
      {
        path: 'catalogo',
        canActivate: [tenantGuard],
        loadComponent: () =>
          import('./features/catalogo/catalogo.component').then((m) => m.CatalogoComponent),
      },
      {
        //
        // D16 corregido: el catálogo lo gestiona el BARBERO de la sede; el
        // ADMIN_BARBERIA y el ADMINISTRADOR entran en modo lectura y el backend
        // les responde 403 en cualquier escritura.
        //
        path: 'admin/servicios',
        canActivate: [tenantGuard, roleGuard(['ADMIN', 'BARBERO'])],
        loadComponent: () =>
          import('./features/admin/admin-servicios.component').then((m) => m.AdminServiciosComponent),
      },
      {
        path: 'admin/horarios',
        canActivate: [tenantGuard, roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/admin/horarios/admin-horarios.component').then((m) => m.AdminHorariosComponent),
      },
      {
        path: 'admin/personal',
        canActivate: [tenantGuard, roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/admin/personal/admin-personal.component').then((m) => m.AdminPersonalComponent),
      },
      {
        path: 'admin/antecedentes',
        canActivate: [tenantGuard, roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/admin/antecedentes/admin-antecedentes.component').then((m) => m.AdminAntecedentesComponent),
      },
      {
        path: 'admin/tickets',
        canActivate: [tenantGuard, roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/admin/tickets/admin-tickets.component').then((m) => m.AdminTicketsComponent),
      },
      {
        path: 'admin/analiticas',
        canActivate: [tenantGuard, roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/admin/analytics/analytics-dashboard.component').then(
            (m) => m.AnalyticsDashboardComponent,
          ),
      },
      {
        // E3-12 · bandeja de plataforma de la 6.ª vinculación (D10).
        // SIN `tenantGuard`: es una pantalla TRANSVERSAL de la plataforma y el
        // ADMINISTRADOR no necesita sede activa para decidir sobre una sexta
        // vinculación. El backend la declara `@Roles('ADMINISTRADOR')`.
        path: 'admin/vinculaciones',
        canActivate: [authGuard, roleGuard(['ADMINISTRADOR'])],
        loadComponent: () =>
          import('./features/admin/vinculaciones/admin-vinculaciones.component').then(
            (m) => m.AdminVinculacionesComponent,
          ),
      },
      {
        //
        // Bandeja de usuarios de la plataforma (`GET /plataforma/usuarios`).
        // Como la de vinculaciones, es TRANSVERSAL: el ADMINISTRADOR no
        // necesita sede activa para ver las cuentas, así que no lleva
        // `tenantGuard`. El backend la declara `@Roles('ADMINISTRADOR')`.
        //
        path: 'admin/usuarios',
        canActivate: [authGuard, roleGuard(['ADMINISTRADOR'])],
        loadComponent: () =>
          import('./features/admin/usuarios/admin-usuarios.component').then(
            (m) => m.AdminUsuariosComponent,
          ),
      },
      {
        path: 'barbero/horarios',
        canActivate: [tenantGuard, roleGuard(['BARBERO'])],
        loadComponent: () =>
          import('./features/barbero/horarios/barbero-horarios.component').then((m) => m.BarberoHorariosComponent),
      }
    ],
  },
  { path: '**', redirectTo: '' },
];
