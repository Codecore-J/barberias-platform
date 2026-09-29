import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { tenantGuard } from './core/guards/tenant.guard';

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
      // Estas rutas se crearán en las siguientes épicas, pero ya las dejamos protegidas
      {
        path: 'barberias',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/barberias/barberias.component').then((m) => m.BarberiasComponent),
      },
      {
        path: 'barberias/nueva',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/barberias/crear-barberia.component').then((m) => m.CrearBarberiaComponent),
      },
      {
        path: 'reservas/nueva',
        canActivate: [tenantGuard],
        loadComponent: () =>
          import('./features/home/home.component').then((m) => m.HomeComponent), // Placeholder temporal
      },
      {
        path: 'catalogo',
        canActivate: [tenantGuard],
        loadComponent: () =>
          import('./features/catalogo/catalogo.component').then((m) => m.CatalogoComponent),
      }
    ],
  },
  { path: '**', redirectTo: '' },
];
