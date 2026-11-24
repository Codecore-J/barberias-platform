import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminShellComponent } from './admin-shell.component';
import { AuthService } from '../../../auth/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import { NotificationService } from '../../../core/services/notification.service';

/**
 * T-14 · el sidebar del panel no inventa permisos: pinta las rutas que ya
 * existen para el rol efectivo de la sesión. Lo que se protege aquí es que la
 * lista no ofrezca módulos que el `roleGuard` va a negar, que «Configuración»
 * apunte a los ajustes de la sede activa (y nunca al hub `/barberias/nueva`) y
 * que la cuenta dual muestre sus dos insignias sin repetirlas.
 */
describe('AdminShellComponent · navegación por rol (T-14)', () => {
  function montar(roles: string[]) {
    const activa = signal({ id: 'sede-1', nombre: 'Imperial Barbers' });
    const tenant = {
      barberiaActiva: activa,
      barberiasVinculadas: signal([]),
    };
    const auth = {
      authState: signal({
        user: { roles, nombreCompleto: 'Ana Pérez', correo: 'ana@test.com' },
      }),
    };
    const notificaciones = {
      notificaciones: signal([]),
      noLeidasCount: signal(0),
      asegurarCargadas: vi.fn(() => of([])),
      marcarComoLeida: vi.fn(() => of(null)),
      marcarTodasComoLeidas: vi.fn(() => of(null)),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TenantService, useValue: tenant },
        { provide: NotificationService, useValue: notificaciones },
      ],
    });

    const fixture = TestBed.createComponent(AdminShellComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rutas = (componente: AdminShellComponent) =>
    componente.grupos().flatMap((grupo) => grupo.items.map((item) => item.ruta));

  it('ADMIN_BARBERIA ve la operación y la gobernanza de su sede', () => {
    const componente = montar(['ADMIN_BARBERIA']);
    const visibles = rutas(componente);

    expect(visibles).toContain('/admin/agenda');
    expect(visibles).toContain('/admin/servicios');
    expect(visibles).toContain('/admin/categorias');
    expect(visibles).toContain('/admin/personal');
    expect(visibles).toContain('/admin/clientes-restringidos');
    // Nada de plataforma: el guard de usuarios y el hub de sedes no lo permiten.
    expect(visibles).not.toContain('/admin/usuarios');
    expect(visibles).not.toContain('/admin/vinculaciones');
    // T-14 · Configuración es la sede activa, nunca `/barberias/nueva`.
    expect(componente.configuracion().ruta).toBe('/admin/horarios');
  });

  it('BARBERO no ve módulos de administración ajenos y su Configuración es su plantilla', () => {
    const componente = montar(['BARBERO']);
    const visibles = rutas(componente);

    expect(visibles).toContain('/admin/agenda');
    expect(visibles).toContain('/barbero/servicios');
    expect(visibles).toContain('/admin/servicios');
    expect(visibles).not.toContain('/admin/personal');
    expect(visibles).not.toContain('/admin/analiticas');
    expect(componente.configuracion().ruta).toBe('/barbero/horarios');
  });

  it('ADMINISTRADOR global ve la plataforma y las categorías sin candado falso', () => {
    const componente = montar(['ADMINISTRADOR']);
    const visibles = rutas(componente);

    expect(visibles).toContain('/barberias');
    expect(visibles).toContain('/admin/usuarios');
    expect(visibles).toContain('/admin/vinculaciones');

    // T-20/T-21 · el catálogo global lo gestiona el ADMINISTRADOR: el sidebar
    // no debe anunciar «solo lectura» de una pantalla que ahora escribe.
    const shell = componente as unknown as { esSoloObservador?: unknown; enSoloLectura?: unknown };
    expect(shell.esSoloObservador).toBeUndefined();
    expect(shell.enSoloLectura).toBeUndefined();
  });

  it('cuenta dual ADMINISTRADOR + ADMIN_BARBERIA: gestiona la sede sin avisos de auditoría', () => {
    const componente = montar(['ADMINISTRADOR', 'ADMIN_BARBERIA']);
    const shell = componente as unknown as { enSoloLectura?: unknown };

    expect(shell.enSoloLectura).toBeUndefined();
  });

  it('cuenta dual ADMIN_BARBERIA + BARBERO: dos insignias, sin duplicar texto', () => {
    const componente = montar(['ADMIN_BARBERIA', 'BARBERO']);

    expect(componente.chipsRol()).toEqual(['Admin. de barbería', 'Barbero']);
    // Rol efectivo = el de mayor precedencia, igual que en los guards.
    expect(componente.rol()).toBe('ADMIN_BARBERIA');
  });

  it('el colapso es un estado real del shell', () => {
    const componente = montar(['ADMIN_BARBERIA']);

    expect(componente.colapsado()).toBe(false);
    componente.toggleColapsado();
    expect(componente.colapsado()).toBe(true);
  });
});
