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
        path: 'admin/agenda',
        canActivate: [tenantGuard, roleGuard(['ADMIN', 'BARBERO'])],
        loadComponent: () =>
          import('./features/agenda/agenda-barbero.component').then((m) => m.AgendaBarberoComponent),
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
        path: 'admin/servicios',
        canActivate: [tenantGuard, roleGuard(['ADMIN'])],
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
        path: 'barbero/horarios',
        canActivate: [tenantGuard, roleGuard(['BARBERO', 'ADMIN'])],
        loadComponent: () =>
          import('./features/barbero/horarios/barbero-horarios.component').then((m) => m.BarberoHorariosComponent),
      }
    ],
  },
  { path: '**', redirectTo: '' },
];
