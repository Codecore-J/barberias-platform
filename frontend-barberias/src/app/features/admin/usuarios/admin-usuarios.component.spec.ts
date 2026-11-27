import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { AdminUsuariosComponent } from './admin-usuarios.component';
import {
  RolDeUsuario,
  UsuarioListResponse,
  UsuariosService,
} from '../../../core/services/usuarios.service';
import { AuthService } from '../../../auth/auth.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * Fase 2 · el alta de plataforma se defiende del 409 `SEDE_YA_TIENE_ADMIN`.
 *
 * Lo que se fija aquí: el `adminActual` del backend se pinta con correo y
 * nombre, el submit queda bloqueado mientras el conflicto siga en pantalla y el
 * conflicto se limpia al cambiar de sede o de rol. Además, el modal de roles
 * agrupa la cuenta dual en UNA tarjeta por sede.
 */
describe('AdminUsuariosComponent · Fase 2', () => {
  let fixture: ComponentFixture<AdminUsuariosComponent>;
  let component: AdminUsuariosComponent;

  const adminActual = {
    id: 'admin-1',
    correo: 'dueno.actual@test.com',
    nombreCompleto: 'Dueño Actual',
  };

  const usuarios = signal<UsuarioListResponse[]>([]);
  const isLoading = signal(false);
  const error = signal<string | null>(null);

  const obtenerUsuarios = vi.fn(() => of<UsuarioListResponse[]>([]));
  const listarBarberias = vi.fn(() => of([{ id: 'sede-1', nombre: 'Sede A E401' }]));
  const crearUsuario = vi.fn();
  const obtenerRolesUsuario = vi.fn(() => of<RolDeUsuario[]>([]));
  const previsualizarEliminacion = vi.fn();
  const eliminarUsuario = vi.fn();

  const success = vi.fn();

  beforeEach(async () => {
    usuarios.set([]);
    isLoading.set(false);
    error.set(null);
    obtenerUsuarios.mockClear();
    listarBarberias.mockClear();
    crearUsuario.mockReset();
    obtenerRolesUsuario.mockClear();
    previsualizarEliminacion.mockReset();
    eliminarUsuario.mockReset();
    success.mockClear();

    await TestBed.configureTestingModule({
      imports: [AdminUsuariosComponent],
      providers: [
        {
          provide: UsuariosService,
          useValue: {
            usuarios,
            isLoading,
            error,
            obtenerUsuarios,
            listarBarberias,
            crearUsuario,
            obtenerRolesUsuario,
            previsualizarEliminacion,
            eliminarUsuario,
            obtenerAuditoriaUsuario: vi.fn(() => of([])),
            cambiarEstadoUsuario: vi.fn(),
            cambiarAdministrador: vi.fn(),
            actualizarVinculoSede: vi.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            authState: signal({
              user: { id: 'admin-plataforma', roles: ['ADMINISTRADOR'] },
              isAuthenticated: true,
            }),
          },
        },
        {
          provide: ToastService,
          useValue: { success, error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUsuariosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Abre el modal de alta con un ADMIN_BARBERIA válido listo para enviar. */
  function prepararAltaAdmin(): void {
    component.abrirCreacion();
    fixture.detectChanges();

    component.alCambiarRol('ADMIN_BARBERIA');
    component.alCambiarSede('sede-1');
    component.formNombre.set('Segundo Dueño');
    component.formCorreo.set('segundo@test.com');
    component.formTelefono.set('8095550202');
    component.formPassword.set('Password123');
    fixture.detectChanges();
  }

  const conflictoHttp = () => ({
    status: 409,
    error: {
      statusCode: 409,
      codigo: 'SEDE_YA_TIENE_ADMIN',
      mensaje: 'La sede ya tiene un administrador activo.',
      adminActual,
    },
  });

  it('ROJO: el 409 SEDE_YA_TIENE_ADMIN identifica al dueño y bloquea el submit', () => {
    prepararAltaAdmin();
    crearUsuario.mockReturnValue(throwError(() => conflictoHttp()));

    component.confirmarCreacion();
    fixture.detectChanges();

    expect(component.conflictoAdminSede()).toEqual(adminActual);
    expect(component.mensajeConflictoSede()).toContain('dueno.actual@test.com');
    expect(component.mensajeConflictoSede()).toContain('Dueño Actual');

    // El contenido del modal vive en el overlay portado a `<body>` (H-01).
    const alerta = document.body.querySelector('#usuario-sede-conflicto') as HTMLElement;
    expect(alerta).not.toBeNull();
    expect(alerta.textContent).toContain('Esta sede ya cuenta con el administrador');
    expect(alerta.textContent).toContain('Dueño Actual');

    const crear = [...document.body.querySelectorAll('button')].find((boton) =>
      (boton as HTMLElement).textContent?.includes('Crear usuario'),
    ) as HTMLButtonElement;
    expect(crear.disabled).toBe(true);
  });

  it('con el conflicto activo el botón no vuelve a llamar al backend', () => {
    prepararAltaAdmin();
    crearUsuario.mockReturnValue(throwError(() => conflictoHttp()));
    component.confirmarCreacion();
    crearUsuario.mockClear();

    component.confirmarCreacion();

    expect(crearUsuario).not.toHaveBeenCalled();
  });

  it('elegir otra sede limpia el conflicto y vuelve a habilitar el envío', () => {
    prepararAltaAdmin();
    crearUsuario.mockReturnValue(throwError(() => conflictoHttp()));
    component.confirmarCreacion();
    expect(component.conflictoAdminSede()).not.toBeNull();

    component.alCambiarSede('sede-2');
    fixture.detectChanges();

    expect(component.conflictoAdminSede()).toBeNull();
    expect(document.body.querySelector('#usuario-sede-conflicto')).toBeNull();
  });

  it('cambiar de rol también limpia el conflicto (habla de un ADMIN_BARBERIA)', () => {
    prepararAltaAdmin();
    crearUsuario.mockReturnValue(throwError(() => conflictoHttp()));
    component.confirmarCreacion();

    component.alCambiarRol('BARBERO');

    expect(component.conflictoAdminSede()).toBeNull();
  });

  it('la cuenta dual se pinta en UNA tarjeta por sede con un chip por rol', () => {
    component.usuarioRoles.set({
      id: 'usuario-dual',
      nombreCompleto: 'Dueño Barbero',
      correo: 'dueno@test.com',
      telefono: '8095550000',
      estadoCuenta: 'ACTIVO',
      fechaRegistro: null,
      roles: ['ADMIN_BARBERIA', 'BARBERO'],
    });
    component.roles.set([
      {
        id: 'vinculo-admin',
        rolNombre: 'ADMIN_BARBERIA',
        ambito: 'BARBERIA',
        estado: 'ACTIVO',
        barberiaId: 'sede-1',
        barberiaNombre: 'Sede A E401',
      },
      {
        id: 'vinculo-barbero',
        rolNombre: 'BARBERO',
        ambito: 'BARBERIA',
        estado: 'ACTIVO',
        barberiaId: 'sede-1',
        barberiaNombre: 'Sede A E401',
      },
    ]);
    component.rolesAbierto.set(true);
    fixture.detectChanges();

    expect(component.tarjetasDeSede()).toHaveLength(1);
    expect(component.tarjetasDeSede()[0].vinculos).toHaveLength(2);

    const tarjetas = document.body.querySelectorAll('[data-testid="tarjeta-sede"]');
    expect(tarjetas).toHaveLength(1);
    expect(tarjetas[0].textContent).toContain('Cuenta dual · 2 roles');

    const chips = tarjetas[0].querySelectorAll('span.rounded-full');
    // El pipe `rolLabel` da la etiqueta de negocio; el CSS la pone en mayúsculas.
    const textos = [...chips]
      .map((chip: Element) => chip.textContent?.trim().toLowerCase() ?? '')
      .join(' | ');
    expect(textos).toContain('admin. de barbería');
    expect(textos).toContain('barbero');
  });

  // ── F7 / T-74 · eliminación real ────────────────────────────────

  const ana: UsuarioListResponse = {
    id: 'usuario-ana',
    nombreCompleto: 'Ana Pérez',
    correo: 'ana@demo.com',
    telefono: '8095550199',
    estadoCuenta: 'ACTIVO',
    fechaRegistro: null,
    roles: ['CLIENTE'],
  };

  const preview = {
    id: ana.id,
    correo: ana.correo,
    reservasFuturas: 2,
    pagosDesvinculados: 1,
    cajasDesvinculadas: 0,
    sedesAdministradas: [],
    sedesResponsable: [],
    propuestasHorario: 0,
    solicitudesResueltas: 0,
    puedeEliminar: true,
    bloqueos: [],
  };

  function botonEliminar(): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll('button')].find((boton) =>
      (boton as HTMLElement).textContent?.includes('Confirmar eliminación'),
    ) as HTMLButtonElement | undefined;
  }

  it('ROJO: confirmar eliminación sigue deshabilitado hasta escribir el correo exacto', () => {
    usuarios.set([ana]);
    previsualizarEliminacion.mockReturnValue(of(preview));
    fixture.detectChanges();

    component.abrirEliminacion(ana);
    fixture.detectChanges();

    expect(component.puedeConfirmarEliminacion()).toBe(false);
    expect(botonEliminar()?.disabled).toBe(true);

    component.confirmacionCorreo.set('ana@');
    fixture.detectChanges();
    expect(botonEliminar()?.disabled).toBe(true);

    component.confirmacionCorreo.set(ana.correo);
    fixture.detectChanges();
    expect(component.puedeConfirmarEliminacion()).toBe(true);
    expect(botonEliminar()?.disabled).toBe(false);
  });

  it('el modal muestra el resumen del borrado que devuelve el backend', () => {
    usuarios.set([ana]);
    previsualizarEliminacion.mockReturnValue(of(preview));
    fixture.detectChanges();

    component.abrirEliminacion(ana);
    fixture.detectChanges();

    const texto = document.body.textContent ?? '';
    expect(texto).toContain('2 reservas futuras');
    expect(texto).toContain('1 pago');
    expect(texto).toContain('Esta acción es irreversible');
  });

  it('un 409 USUARIO_ES_ADMIN_SEDE muestra las sedes afectadas', () => {
    usuarios.set([ana]);
    // El resumen dice que se puede; el 409 llega porque el vínculo cambió entre
    // la previsualización y la confirmación (carrera real de la bandeja).
    previsualizarEliminacion.mockReturnValue(of({ ...preview, puedeEliminar: true }));
    eliminarUsuario.mockReturnValue(
      throwError(() => ({
        status: 409,
        error: {
          statusCode: 409,
          codigo: 'USUARIO_ES_ADMIN_SEDE',
          mensaje: 'La cuenta administra una sede.',
          sedes: [{ id: 'sede-1', nombre: 'Sede A E401' }],
        },
      })),
    );
    fixture.detectChanges();

    component.abrirEliminacion(ana);
    component.confirmacionCorreo.set(ana.correo);
    component.confirmarEliminacion();
    fixture.detectChanges();

    expect(component.sedesConflictoEliminacion()).toEqual([
      { id: 'sede-1', nombre: 'Sede A E401' },
    ]);
    expect(document.body.textContent).toContain('Sede A E401');
  });

  it('el último administrador activo y la cuenta propia no ofrecen eliminación', () => {
    const otroAdmin: UsuarioListResponse = {
      ...ana,
      id: 'admin-plataforma',
      correo: 'admin@demo.com',
      roles: ['ADMINISTRADOR'],
    };
    usuarios.set([otroAdmin]);
    fixture.detectChanges();

    expect(component.puedeEliminarUsuario(otroAdmin)).toBe(false);
  });
});
