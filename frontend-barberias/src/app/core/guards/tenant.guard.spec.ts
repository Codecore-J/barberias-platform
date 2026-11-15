import { TestBed } from '@angular/core/testing';
import { computed, signal, WritableSignal } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { tenantGuard, tenantGuardPermiteConsolidado } from './tenant.guard';
import { TenantService } from '../services/tenant.service';
import { AuthService } from '../../auth/auth.service';

/**
 * T-30 · el guard que exigía contexto de sede no tenía spec propio: era el
 * único de los tres (`authGuard`, `roleGuard`, `tenantGuard`) sin cobertura, y
 * justo el que decide si un barbero puede entrar a su agenda o vuelve al hub de
 * sedes. Aquí se fija su contrato:
 *
 *  - sin sede activa NO se entra a una pantalla de operación;
 *  - una sede activa que el backend ya no devuelve se descarta;
 *  - una ruta con `:shopId` cambia el contexto contra el backend y solo entra si
 *    la sede quedó fijada de verdad (si el PATCH falla o no la fija, al hub);
 *  - con la sede ya activa no se pide nada al backend.
 */
describe('tenantGuard', () => {
  const SEDE_A = { id: 'aaaaaaaa-1111-4111-8111-111111111111', nombre: 'Sede A' } as any;
  const SEDE_B = { id: 'bbbbbbbb-2222-4222-8222-222222222222', nombre: 'Sede B' } as any;

  let barberiaActiva: WritableSignal<any>;
  let barberiasVinculadas: WritableSignal<any[]>;
  let mockTenant: {
    barberiaActiva: WritableSignal<any>;
    barberiasVinculadas: WritableSignal<any[]>;
    barberiaActivaId: () => string | null;
    setBarberiaActiva: (sede: any) => void;
    cambiarSedeActiva: (id: string) => any;
  };
  let mockRouter: { createUrlTree: (commands: any[]) => any };

  /** Ruta con y sin `:shopId`, como las arma el Router. */
  const ruta = (shopId: string | null = null) =>
    ({
      pathFromRoot: [
        { paramMap: { get: () => null } },
        { paramMap: { get: (clave: string) => (clave === 'shopId' ? shopId : null) } },
      ],
    }) as unknown as ActivatedRouteSnapshot;

  beforeEach(() => {
    barberiaActiva = signal<any>(null);
    barberiasVinculadas = signal<any[]>([]);

    mockTenant = {
      barberiaActiva,
      barberiasVinculadas,
      barberiaActivaId: computed(() => barberiaActiva()?.id ?? null),
      setBarberiaActiva: (sede: any) => barberiaActiva.set(sede),
      cambiarSedeActiva: () => of(null),
    };
    mockRouter = {
      createUrlTree: (commands: any[]) => ({ tree: commands }),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: TenantService, useValue: mockTenant },
        { provide: Router, useValue: mockRouter },
      ],
    });
  });

  const ejecutar = (route: ActivatedRouteSnapshot) =>
    TestBed.runInInjectionContext(() => tenantGuard(route, {} as any));

  it('sin sede activa redirige al hub de sedes', () => {
    expect(ejecutar(ruta())).toEqual({ tree: ['/barberias'] });
  });

  it('con una sede activa vigente deja pasar', () => {
    barberiaActiva.set(SEDE_A);
    barberiasVinculadas.set([SEDE_A, SEDE_B]);

    expect(ejecutar(ruta())).toBe(true);
  });

  it('descarta una sede activa que el backend ya no devuelve', () => {
    barberiaActiva.set(SEDE_A);
    barberiasVinculadas.set([SEDE_B]);

    expect(ejecutar(ruta())).toEqual({ tree: ['/barberias'] });
    expect(barberiaActiva()).toBeNull();
  });

  it('con la sede ya activa no vuelve a pedir la selección', () => {
    barberiaActiva.set(SEDE_A);
    barberiasVinculadas.set([SEDE_A]);
    let llamadas = 0;
    mockTenant.cambiarSedeActiva = () => {
      llamadas += 1;
      return of(null);
    };

    expect(ejecutar(ruta(SEDE_A.id))).toBe(true);
    expect(llamadas).toBe(0);
  });

  it('con `:shopId` fija la sede contra el backend y después deja pasar', async () => {
    barberiasVinculadas.set([SEDE_A, SEDE_B]);
    mockTenant.cambiarSedeActiva = (id: string) => {
      barberiaActiva.set([SEDE_A, SEDE_B].find((sede) => sede.id === id) ?? null);
      return of(null);
    };

    const resultado = await firstValueFrom(ejecutar(ruta(SEDE_B.id)) as any);
    expect(resultado).toBe(true);
    expect(barberiaActiva()?.id).toBe(SEDE_B.id);
  });

  it('si el cambio de sede no fija el contexto, no se entra', async () => {
    barberiasVinculadas.set([SEDE_A, SEDE_B]);
    mockTenant.cambiarSedeActiva = () => of(null);

    const resultado = await firstValueFrom(ejecutar(ruta(SEDE_B.id)) as any);
    expect(resultado).toEqual({ tree: ['/barberias'] });
  });

  it('si el backend rechaza el cambio de sede, se vuelve al hub', async () => {
    barberiasVinculadas.set([SEDE_A, SEDE_B]);
    mockTenant.cambiarSedeActiva = () => throwError(() => new Error('403 PENDIENTE_APROBACION'));

    const resultado = await firstValueFrom(ejecutar(ruta(SEDE_B.id)) as any);
    expect(resultado).toEqual({ tree: ['/barberias'] });
  });
});

/**
 * T-16 · la vista consolidada de analíticas necesitaba su propia puerta.
 *
 * `tenantGuard` manda a `/barberias` sin sede, así que el ADMINISTRADOR global
 * era redirigido antes de ver el consolidado que el ticket pedía. El guard nuevo
 * solo relaja esa condición para él; cualquier otro rol sigue igual de estricto.
 */
describe('tenantGuardPermiteConsolidado (T-16)', () => {
  const SEDE_A = { id: 'aaaaaaaa-1111-4111-8111-111111111111', nombre: 'Sede A' } as any;

  let barberiaActiva: WritableSignal<any>;

  const ruta = () =>
    ({
      pathFromRoot: [{ paramMap: { get: () => null } }],
    }) as unknown as ActivatedRouteSnapshot;

  const configurar = (roles: string[]) => {
    barberiaActiva = signal<any>(null);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TenantService,
          useValue: {
            barberiaActiva,
            barberiasVinculadas: signal<any[]>([SEDE_A]),
            barberiaActivaId: computed(() => barberiaActiva()?.id ?? null),
            setBarberiaActiva: (sede: any) => barberiaActiva.set(sede),
            cambiarSedeActiva: () => of(null),
          },
        },
        { provide: Router, useValue: { createUrlTree: (commands: any[]) => ({ tree: commands }) } },
        { provide: AuthService, useValue: { authState: signal({ user: { roles } }) } },
      ],
    });
  };

  const ejecutar = () =>
    TestBed.runInInjectionContext(() => tenantGuardPermiteConsolidado(ruta(), {} as any));

  it('ADMINISTRADOR sin sede entra a la vista consolidada', () => {
    configurar(['ADMINISTRADOR']);
    expect(ejecutar()).toBe(true);
  });

  it('ADMIN_BARBERIA sin sede sigue volviendo al hub de sedes', () => {
    configurar(['ADMIN_BARBERIA']);
    expect(ejecutar()).toEqual({ tree: ['/barberias'] });
  });

  it('un rol sin alcance de plataforma tampoco entra sin sede', () => {
    configurar(['CLIENTE']);
    expect(ejecutar()).toEqual({ tree: ['/barberias'] });
  });

  it('con sede activa vigente se comporta como tenantGuard y deja pasar', () => {
    configurar(['ADMINISTRADOR']);
    barberiaActiva.set(SEDE_A);
    expect(ejecutar()).toBe(true);
  });
});
