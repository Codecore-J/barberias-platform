import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsuariosService } from './usuarios.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * `GET /plataforma/usuarios` · bandeja de cuentas del ADMINISTRADOR global.
 *
 * Fija lo que la pantalla necesita: que la petición vaya a la ruta de plataforma
 * (sin `barberiaId`: es transversal), que la lista quede en la señal en el orden
 * que manda el backend y que un 403 deje su `mensaje` del contrato D40 en vez de
 * un texto genérico.
 */
describe('UsuariosService · listado de plataforma', () => {
  let service: UsuariosService;
  let http: HttpTestingController;

  const USUARIOS_URL = `${API_URL}/plataforma/usuarios`;

  const ana = {
    id: 'u1',
    nombreCompleto: 'Ana Pérez',
    correo: 'ana@test.com',
    telefono: '8090000000',
    estadoCuenta: 'ACTIVO',
    fechaRegistro: '2026-10-02T10:00:00.000Z',
    roles: ['ADMINISTRADOR', 'CLIENTE'],
  };

  const luis = {
    id: 'u2',
    nombreCompleto: 'Luis Gómez',
    correo: 'luis@test.com',
    telefono: null,
    estadoCuenta: 'SUSPENDIDO',
    fechaRegistro: null,
    roles: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsuariosService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('pide la lista a /plataforma/usuarios y la guarda en la señal', () => {
    let resultado: unknown = 'sin asignar';

    service.obtenerUsuarios().subscribe((usuarios) => (resultado = usuarios));

    const peticion = http.expectOne(USUARIOS_URL);
    expect(peticion.request.method).toBe('GET');
    peticion.flush([ana, luis]);

    // El orden es el del backend (`fecha_registro DESC`): no se reordena aquí.
    expect(resultado).toEqual([ana, luis]);
    expect(service.usuarios()).toEqual([ana, luis]);
    expect(service.isLoading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('un cuerpo ausente se pinta como lista vacía, no rompe la tabla', () => {
    service.obtenerUsuarios().subscribe();

    http.expectOne(USUARIOS_URL).flush(null);

    expect(service.usuarios()).toEqual([]);
    expect(service.isLoading()).toBe(false);
  });

  it('un 403 deja el mensaje del contrato D40 y vacía la lista', () => {
    service.obtenerUsuarios().subscribe();
    http.expectOne(USUARIOS_URL).flush([ana]);

    service.obtenerUsuarios().subscribe({ error: () => undefined });

    const mensaje = 'No tienes permiso para acceder a este recurso.';
    http
      .expectOne(USUARIOS_URL)
      .flush(
        { codigo: 'PROHIBIDO', mensaje },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(service.error()).toBe(mensaje);
    expect(service.usuarios()).toEqual([]);
    expect(service.isLoading()).toBe(false);
  });

  it('cambia el estado con PATCH y manda { estadoCuenta, motivo }', () => {
    const respuesta = {
      id: 'u1',
      estadoCuenta: 'SUSPENDIDO',
      tokenVersion: 1,
      sesionesCerradas: true,
    };
    let resultado: any;

    service
      .cambiarEstadoUsuario('u1', 'Uso indebido del catálogo', 'SUSPENDIDO')
      .subscribe((valor) => (resultado = valor));

    const peticion = http.expectOne(`${USUARIOS_URL}/u1/estado`);
    expect(peticion.request.method).toBe('PATCH');
    // `estadoCuenta` es obligatorio en el DTO del backend: sin él sería un 400.
    expect(peticion.request.body).toEqual({
      estadoCuenta: 'SUSPENDIDO',
      motivo: 'Uso indebido del catálogo',
    });
    peticion.flush(respuesta);

    expect(resultado).toEqual(respuesta);
  });

  it('un 422 MOTIVO_REQUERIDO se propaga con su mensaje para el modal', () => {
    const mensaje = 'Suspender o reactivar una cuenta exige un motivo: queda en la auditoría.';
    let recibido: any;

    service.cambiarEstadoUsuario('u1', '   ', 'ACTIVO').subscribe({
      error: (err) => (recibido = err),
    });

    http
      .expectOne(`${USUARIOS_URL}/u1/estado`)
      .flush(
        { codigo: 'MOTIVO_REQUERIDO', mensaje },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

    expect(recibido.error.mensaje).toBe(mensaje);
    // El error es del modal: la lista cargada no se toca.
    expect(service.error()).toBeNull();
  });

  it('crea una cuenta con POST y manda el rol y la sede', () => {
    let resultado: unknown;

    service
      .crearUsuario({
        nombreCompleto: 'Ana Pérez',
        correo: 'ana@test.com',
        telefono: '8090000000',
        password: 'Secreta123',
        rolNombre: 'ADMIN_BARBERIA',
        barberiaId: 'b1',
      })
      .subscribe((usuario) => (resultado = usuario));

    const peticion = http.expectOne(USUARIOS_URL);
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({
      nombreCompleto: 'Ana Pérez',
      correo: 'ana@test.com',
      telefono: '8090000000',
      password: 'Secreta123',
      rolNombre: 'ADMIN_BARBERIA',
      barberiaId: 'b1',
    });
    peticion.flush(ana);

    expect(resultado).toEqual(ana);
  });

  it('un rol GLOBAL viaja sin barberiaId', () => {
    service
      .crearUsuario({
        nombreCompleto: 'Luis Gómez',
        correo: 'luis@test.com',
        telefono: '8091111111',
        password: 'Secreta123',
        rolNombre: 'CLIENTE',
      })
      .subscribe();

    const peticion = http.expectOne(USUARIOS_URL);
    expect(peticion.request.body).not.toHaveProperty('barberiaId');
    expect(peticion.request.body).not.toHaveProperty('cedula');
    peticion.flush(luis);
  });

  it('un 409 de duplicado llega con su mensaje para pintarlo en el modal', () => {
    const mensaje = 'El correo ya está registrado.';
    let recibido: any;

    service
      .crearUsuario({
        nombreCompleto: 'Ana Pérez',
        correo: 'ana@test.com',
        telefono: '8090000000',
        password: 'Secreta123',
        rolNombre: 'CLIENTE',
      })
      .subscribe({ error: (err) => (recibido = err) });

    http
      .expectOne(USUARIOS_URL)
      .flush(
        { codigo: 'CORREO_YA_REGISTRADO', mensaje },
        { status: 409, statusText: 'Conflict' },
      );

    expect(recibido.error.mensaje).toBe(mensaje);
    // El error del alta no ensucia el listado.
    expect(service.error()).toBeNull();
    expect(service.usuarios()).toEqual([]);
  });

  it('consulta el historial de la cuenta y tolera un cuerpo vacío', () => {
    let primero: unknown = 'sin asignar';

    service.obtenerAuditoriaUsuario('u1').subscribe((eventos) => (primero = eventos));
    http.expectOne(`${USUARIOS_URL}/u1/auditoria`).flush([
      {
        id: 'aud-1',
        accion: 'CUENTA_SUSPENDIDA',
        entidad: 'usuarios',
        entidadId: 'u1',
        barberiaId: null,
        motivo: 'Abuso reiterado',
        contexto: { sesionesCerradas: true },
        actor: { id: 'a1', nombreCompleto: 'Global', correo: 'global@test.com' },
        creadoAt: '2026-10-20T10:00:00.000Z',
      },
    ]);

    expect((primero as unknown[]).length).toBe(1);

    service.obtenerAuditoriaUsuario('u1').subscribe((eventos) => (primero = eventos));
    http.expectOne(`${USUARIOS_URL}/u1/auditoria`).flush(null);

    expect(primero).toEqual([]);
  });

  it('trae todas las sedes para el selector de rol de sede', () => {
    let sedes: unknown = 'sin asignar';

    service.listarBarberias().subscribe((valor) => (sedes = valor));
    http.expectOne(`${API_URL}/shops/all`).flush([
      { id: 'b1', nombre: 'Sede Uno' },
      { id: 'b2', nombre: 'Sede Dos' },
    ]);

    expect((sedes as unknown[]).length).toBe(2);
  });
});
