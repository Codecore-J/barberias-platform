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
        // Las citas propias se piden SIEMPRE bajo una sede
        // (`/shops/:shopId/appointments/mine`): sin sede activa la pantalla no
        // tiene nada que consultar. `tenantGuard` manda al hub de sedes en vez
        // de dejar que el servicio construya `/shops/null/...`.
        path: 'reservas/mis-reservas',
        canActivate: [authGuard, tenantGuard],
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
        //
        // H-03 · bandeja dedicada de propuestas de horario (D18/§5.4).
        // Los mismos roles que resuelven la propuesta en el backend
        // (`ADMIN_BARBERIA` y `ADMINISTRADOR`); el BARBERO no decide sobre su
        // propia agenda, así que no entra.
        //
        path: 'admin/propuestas-horario',
        canActivate: [tenantGuard, roleGuard(['ADMIN_BARBERIA', 'ADMINISTRADOR'])],
        loadComponent: () =>
          import('./features/admin/propuestas-horario/propuestas-horario.component').then(
            (m) => m.AdminPropuestasHorarioComponent,
          ),
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
        //
        // E3-13 · solicitudes de cambio de nombre y responsable (D26).
        //
        // Es una pantalla de SEDE (necesita `barberiaId` para la bandeja local),
        // así que lleva `tenantGuard`; el ADMINISTRADOR global entra con una
        // sede elegida y puede ampliar la vista a todas desde la propia
        // pantalla. Los dos roles son los mismos que declara el backend en
        // `GET /shops/:shopId/change-requests`; resolver sigue siendo exclusivo
        // de la plataforma.
        //
        path: 'admin/solicitudes-cambio',
        canActivate: [tenantGuard, roleGuard(['ADMIN_BARBERIA', 'ADMINISTRADOR'])],
        loadComponent: () =>
          import('./features/admin/solicitudes-cambio/solicitudes-cambio.component').then(
            (m) => m.AdminSolicitudesCambioComponent,
          ),
      },
      {
        //
        // E4-03 · lista negra LOCAL de la sede (D48): quién no puede agendar
        // aquí y el levantamiento de esa restricción. Mismos roles que el
        // backend (`ADMIN_BARBERIA`, `ADMINISTRADOR`) y sede obligatoria.
        //
        path: 'admin/clientes-restringidos',
        canActivate: [tenantGuard, roleGuard(['ADMIN_BARBERIA', 'ADMINISTRADOR'])],
        loadComponent: () =>
          import('./features/admin/clientes-restringidos/clientes-restringidos.component').then(
            (m) => m.AdminClientesRestringidosComponent,
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
      },
      {
        //
        // V3 · catálogo híbrido: las CATEGORÍAS son de la sede y las define su
        // ADMIN_BARBERIA. La ruta se limita a ese rol porque el backend también:
        // `CategoriasController` declara `@Roles('ADMIN_BARBERIA')` en escritura
        // y `('ADMIN_BARBERIA', 'BARBERO')` en lectura. Dejar entrar al
        // ADMINISTRADOR global (la jerarquía del guard lo permitía) solo servía
        // para enseñarle un 403 en pantalla.
        //
        path: 'admin/categorias',
        canActivate: [tenantGuard, roleGuard(['ADMIN_BARBERIA'])],
        loadComponent: () =>
          import('./features/admin/categorias/admin-categorias.component').then(
            (m) => m.AdminCategoriasComponent,
          ),
      },
      {
        //
        // V3 · servicios PROPIOS del barbero: él pone nombre, precio y duración
        // dentro de las categorías de la sede. Solo el rol BARBERO (el
        // `barberoId` sale del JWT en el backend).
        //
        path: 'barbero/servicios',
        canActivate: [tenantGuard, roleGuard(['BARBERO'])],
        loadComponent: () =>
          import('./features/barbero/servicios/barbero-servicios.component').then(
            (m) => m.BarberoServiciosComponent,
          ),
      }
    ],
  },
  { path: '**', redirectTo: '' },
];
