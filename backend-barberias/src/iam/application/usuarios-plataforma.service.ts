import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { errorDeConflicto, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import {
  TiempoService,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { AMBITO_BARBERIA, ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA } from '../domain/roles.js';
import { asegurarSedeSinAdmin, esConflictoAdminUnico } from '../domain/administrador-sede.js';
import type { Prisma } from '@prisma/client';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';
import type { CambiarEstadoCuentaDto } from './dto/cambiar-estado-cuenta.dto.js';
import type {
  AdministradorCuentaDto,
  RolDeUsuarioResponseDto,
} from './dto/administrador-cuenta.dto.js';
import type { CrearUsuarioPlataformaDto, RolPlataforma } from './dto/crear-usuario-plataforma.dto.js';
import type { ListarUsuariosDto } from './dto/listar-usuarios.dto.js';
import type { UsuariosPaginadosDto, ResumenUsuariosDto } from './dto/usuarios-paginados-response.dto.js';
import type { EliminarUsuarioDto } from './dto/eliminar-usuario.dto.js';
import type { TransferirAdministracionDto } from './dto/transferir-administracion.dto.js';
import type { UsuarioAuditoriaResponseDto } from './dto/usuario-auditoria-response.dto.js';
import { UsuarioListResponseDto } from './dto/usuario-list-response.dto.js';

/**
 * Coste del hash, el MISMO que `/auth/register` (`AuthService.BCRYPT_ROUNDS`:
 * 10 rondas, criterio OWASP para instalaciones con CPU compartida). Una misma
 * tabla no puede tener contraseñas con dos costes distintos.
 */
const BCRYPT_ROUNDS = 10;

/**
 * Entidades con las que la auditoría ha nombrado a un usuario. El histórico
 * mezcla las dos formas —`usuarios` en la bandeja de plataforma, `Usuario` en
 * el restablecimiento de contraseña—, así que el historial las lee todas.
 */
const ENTIDADES_DE_USUARIO = ['usuarios', 'Usuario'];

/** F8 / T-81 · tamaño de página por defecto de la bandeja de plataforma. */
const PAGINA_POR_DEFECTO = 25;

/** F8 / T-81 · tope duro: una página no puede volver a traer la tabla entera. */
const PAGINA_MAXIMA = 100;

/** Roles del catálogo, para que `porRol` traiga siempre las cuatro claves. */
const ROLES_KPI: RolPlataforma[] = ['ADMINISTRADOR', 'ADMIN_BARBERIA', 'BARBERO', 'CLIENTE'];

/** Extrae `contexto.motivo` sin asumir la forma del JSON. */
function motivoDelContexto(contexto: unknown): string | null {
  if (!contexto || typeof contexto !== 'object' || Array.isArray(contexto)) return null;
  const motivo = (contexto as Record<string, unknown>).motivo;
  return typeof motivo === 'string' ? motivo : null;
}

/** Código D40 para una violación de unicidad que llega como `P2002`. */
function codigoDeDuplicado(target: string | string[] | null | undefined): {
  codigo: string;
  mensaje: string;
} {
  const campos = Array.isArray(target) ? target.join(',') : (target ?? '');

  if (campos.includes('correo')) {
    return { codigo: 'CORREO_YA_REGISTRADO', mensaje: 'El correo ya está registrado.' };
  }
  if (campos.includes('cedula')) {
    return { codigo: 'CEDULA_YA_REGISTRADA', mensaje: 'La cédula ya está registrada.' };
  }
  if (campos.includes('telefono')) {
    return { codigo: 'TELEFONO_YA_REGISTRADO', mensaje: 'El teléfono ya está registrado.' };
  }
  return { codigo: 'DATOS_YA_REGISTRADOS', mensaje: 'Ya existe una cuenta con esos datos.' };
}

/** Sedes que impiden un borrado, con su nombre para poder mostrarlas. */
export interface SedeAfectada {
  id: string;
  nombre: string;
}

/** Resumen previo al borrado (T-74): lo que el modal muestra antes de confirmar. */
export interface PrevisualizacionEliminacion {
  id: string;
  correo: string;
  reservasFuturas: number;
  pagosDesvinculados: number;
  cajasDesvinculadas: number;
  sedesAdministradas: SedeAfectada[];
  sedesResponsable: SedeAfectada[];
  propuestasHorario: number;
  solicitudesResueltas: number;
  puedeEliminar: boolean;
  /** Códigos de los bloqueos vigentes, en el orden de las reglas de T-72. */
  bloqueos: string[];
}

/** Lo que devuelve `PATCH /plataforma/sedes/:sedeId/transferir-admin` (T-73). */
export interface TransferenciaAdministracionResultado {
  sedeId: string;
  adminAnteriorId: string;
  nuevoAdminId: string;
}

/** Lo que devuelve `DELETE /plataforma/usuarios/:id` (T-72). */
export interface EliminarUsuarioResultado {
  id: string;
  correo: string;
  /** `true` si tras el borrado no queda ninguna cuenta con ese correo. */
  correoLiberado: boolean;
  respaldoId: string;
  reservasCanceladas: number;
  pagosDesvinculados: number;
  cajasDesvinculadas: number;
}

/** Lo que devuelve el cambio de estado de una cuenta. */
export interface CambioEstadoCuentaResultado {
  id: string;
  estadoCuenta: 'ACTIVO' | 'SUSPENDIDO';
  /** Versión vigente del token: sube al suspender (D24). */
  tokenVersion: number;
  /** `true` si esta llamada dejó inválidos los tokens ya emitidos. */
  sesionesCerradas: boolean;
}

/**
 * E4-03/5 · D09/D24 · suspensión y reactivación de la CUENTA global.
 *
 * Este servicio es el ÚNICO camino del sistema que cambia `usuarios.estado_cuenta`
 * después del alta: D48 prohíbe expresamente que el contador de inasistencias de
 * una sede suspenda una cuenta, y `test/estado-cuenta-guard.spec.ts` lo vigila
 * sobre el código fuente. Suspender es una decisión manual, motivada y auditada
 * del ADMINISTRADOR de la plataforma.
 *
 * Al suspender se sube `token_version`: los JWT ya firmados llevan la versión
 * anterior y el `JwtStrategy` los rechaza, de modo que las sesiones se cierran en
 * todos los dispositivos y NO vuelven a abrirse al reactivar la cuenta. Reactivar
 * no toca la versión (no hay nada que cerrar).
 *
 * Todo ocurre en UNA transacción con la auditoría dentro: si el evento no se
 * escribe, el estado tampoco cambia (D28).
 */
@Injectable()
export class UsuariosPlataformaService {
  private readonly logger = new Logger(UsuariosPlataformaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly tiempo: TiempoService = new TiempoService(),
  ) {}

  async cambiarEstado(
    usuarioId: string,
    solicitante: UsuarioAutenticado,
    dto: CambiarEstadoCuentaDto,
  ): Promise<CambioEstadoCuentaResultado> {
    const motivo = dto.motivo?.trim();

    if (!motivo) {
      throw reglaDeNegocio(
        'MOTIVO_REQUERIDO',
        'Suspender o reactivar una cuenta exige un motivo: queda en la auditoría.',
      );
    }

    const suspender = dto.estadoCuenta === 'SUSPENDIDO';

    const resultado = await withSerializableTransaction(this.prisma, async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { id: usuarioId },
        select: { id: true, correo: true, estadoCuenta: true, tokenVersion: true },
      });

      if (!usuario) {
        throw new NotFoundException('Usuario no encontrado.');
      }

      if (usuario.estadoCuenta === dto.estadoCuenta) {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `La cuenta ya está en estado ${dto.estadoCuenta}.`,
        );
      }

      const tokenVersion = suspender ? usuario.tokenVersion + 1 : usuario.tokenVersion;

      await tx.usuario.update({
        where: { id: usuarioId },
        data: { estadoCuenta: dto.estadoCuenta, tokenVersion },
      });

      await this.auditoria.registrarEvento(
        {
          usuarioId: solicitante.id,
          accion: suspender ? 'CUENTA_SUSPENDIDA' : 'CUENTA_REACTIVADA',
          entidad: 'usuarios',
          entidadId: usuarioId,
          contexto: {
            motivo,
            // D28: valor anterior y nuevo, explícitos. `tokenVersion` va incluido
            // porque es la prueba de que las sesiones quedaron cerradas.
            anterior: {
              estadoCuenta: usuario.estadoCuenta,
              tokenVersion: usuario.tokenVersion,
            },
            nuevo: {
              estadoCuenta: dto.estadoCuenta,
              tokenVersion,
            },
            sesionesCerradas: suspender,
          },
        },
        tx,
      );

      this.logger.warn(
        suspender
          ? `Cuenta ${usuario.correo} suspendida por ${solicitante.correo}: ${motivo}`
          : `Cuenta ${usuario.correo} reactivada por ${solicitante.correo}: ${motivo}`,
      );

      return {
        id: usuarioId,
        estadoCuenta: dto.estadoCuenta,
        tokenVersion,
        sesionesCerradas: suspender,
      } satisfies CambioEstadoCuentaResultado;
    });

    return resultado;
  }

  // ── I-05 · gestión de roles desde el panel de plataforma ────────────────

  /**
   * Vínculos de rol de una cuenta, para pintarlos en el panel.
   *
   * Devuelve cada asignación con la sede a la que pertenece (o `null` si es
   * global) y su estado: la bandeja solo mostraba `roles: string[]` agregado y
   * sin sede, así que «ADMIN_BARBERIA» no decía de dónde ni permitía tocarlo.
   */
  async obtenerRolesDeUsuario(usuarioId: string): Promise<RolDeUsuarioResponseDto[]> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');

    const filas = await this.prisma.usuarioRol.findMany({
      where: { usuarioId },
      select: {
        id: true,
        estado: true,
        rol: { select: { nombre: true, ambito: true } },
        barberia: { select: { id: true, nombre: true } },
      },
    });

    return filas
      .map((fila) => ({
        id: fila.id,
        rolNombre: fila.rol.nombre,
        ambito: fila.rol.ambito,
        estado: fila.estado,
        barberiaId: fila.barberia?.id ?? null,
        barberiaNombre: fila.barberia?.nombre ?? null,
      }))
      .sort((a, b) =>
        `${a.ambito}-${a.rolNombre}-${a.barberiaNombre ?? ''}`.localeCompare(
          `${b.ambito}-${b.rolNombre}-${b.barberiaNombre ?? ''}`,
        ),
      );
  }

  /**
   * I-05 · concede o retira el rol global `ADMINISTRADOR`.
   *
   * Reglas que no se pueden saltar desde el cliente:
   * - Nadie cambia su propio rol de plataforma (evita el autobloqueo y el
   *   autoascenso sin testigo).
   * - No se puede retirar el ÚLTIMO administrador: dejaría la plataforma sin
   *   nadie que pueda administrarla.
   * - Retirar sube `tokenVersion`: el token ya firmado llevaba `ADMINISTRADOR`
   *   en el claim y seguiría sirviendo hasta 24 h (mismo criterio que I-01).
   *   Conceder no la sube —quitar sesiones a quien acaba de recibir permisos no
   *   protege nada—: el rol entra en su siguiente login.
   */
  async cambiarAdministrador(
    usuarioId: string,
    solicitante: UsuarioAutenticado,
    dto: AdministradorCuentaDto,
  ): Promise<{ id: string; esAdministrador: boolean }> {
    if (usuarioId === solicitante.id) {
      throw reglaDeNegocio(
        'ADMIN_PROPIO_ROL',
        'No puedes cambiar tu propio rol de plataforma.',
      );
    }

    const resultado = await withSerializableTransaction(this.prisma, async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { id: usuarioId },
        select: { id: true, correo: true, estadoCuenta: true },
      });
      if (!usuario) throw new NotFoundException('Usuario no encontrado.');

      const rol = await tx.rol.findUnique({
        where: { nombre: ROL_ADMINISTRADOR },
        select: { id: true },
      });
      if (!rol) {
        throw new InternalServerErrorException(
          'Configuración incompleta: el rol ADMINISTRADOR no existe. Ejecuta el seed.',
        );
      }

      // Spec 01 §9: en este backend no se borra, se cambia de estado. El
      // vínculo global de administrador se apaga (`INACTIVO`) y se reactiva si
      // se vuelve a conceder; ni `JwtStrategy` ni `login` lo leen apagado, así
      // que «revocado» y «borrado» son equivalentes para el acceso.
      const vinculo = await tx.usuarioRol.findFirst({
        where: { usuarioId, rolId: rol.id, barberiaId: null },
        select: { id: true, estado: true },
      });

      if (dto.habilitado) {
        if (vinculo?.estado === 'ACTIVO') {
          throw errorDeConflicto(
            'YA_ES_ADMINISTRADOR',
            'La cuenta ya tiene el rol de administrador de plataforma.',
          );
        }

        if (vinculo) {
          await tx.usuarioRol.update({
            where: { id: vinculo.id },
            data: { estado: 'ACTIVO' },
          });
        } else {
          await tx.usuarioRol.create({
            data: { usuarioId, rolId: rol.id, barberiaId: null },
          });
        }
      } else {
        if (!vinculo || vinculo.estado !== 'ACTIVO') {
          throw errorDeConflicto(
            'NO_ES_ADMINISTRADOR',
            'La cuenta no tiene el rol de administrador de plataforma.',
          );
        }

        // Serializable + este conteo: dos retiradas simultáneas de los dos
        // últimos administradores no pueden dejar la plataforma en cero.
        const administradores = await tx.usuarioRol.count({
          where: {
            rolId: rol.id,
            barberiaId: null,
            estado: 'ACTIVO',
            usuario: { estadoCuenta: 'ACTIVO' },
          },
        });

        if (administradores <= 1) {
          throw reglaDeNegocio(
            'ULTIMO_ADMINISTRADOR',
            'No puedes retirar el último administrador de la plataforma.',
          );
        }

        await tx.usuarioRol.update({
          where: { id: vinculo.id },
          data: { estado: 'INACTIVO' },
        });

        await tx.usuario.update({
          where: { id: usuarioId },
          data: { tokenVersion: { increment: 1 } },
        });
      }

      await this.auditoria.registrarEvento(
        {
          usuarioId: solicitante.id,
          accion: dto.habilitado
            ? 'ADMINISTRADOR_PLATAFORMA_ASIGNADO'
            : 'ADMINISTRADOR_PLATAFORMA_REVOCADO',
          entidad: 'usuarios',
          entidadId: usuarioId,
          contexto: {
            correo: usuario.correo,
            motivo: dto.motivo?.trim() || null,
            sesionesCerradas: !dto.habilitado,
          },
        },
        tx,
      );

      return { id: usuarioId, esAdministrador: dto.habilitado };
    });

    return resultado;
  }

  /**
   * Bandeja paginada de la plataforma · `GET /plataforma/usuarios`.
   *
   * Contrato (F8 / T-81): `200` con `{ datos, total, pagina, porPagina }`.
   * - Solo `ADMINISTRADOR` (D05), aprobado por `RolesGuard` + `@Roles`.
   * - `total` es el tamaño del conjunto FILTRADO: es lo que permite calcular
   *   páginas sin traer las filas. Los KPI de la plataforma NO viajan aquí: los
   *   sirve `obtenerResumenUsuarios` en su propia ruta.
   * - Orden: `creado_at DESC` con `id ASC` como desempate. El segundo criterio no
   *   es cosmético: dos cuentas dadas de alta en el mismo milisegundo podían
   *   intercambiarse entre páginas y una fila se veía dos veces o desaparecía.
   *
   * El `select` es explícito a propósito: `password_hash`, `token_version` y
   * `cedula` no se leen, así que no hay forma de que se cuelen en la respuesta.
   *
   * Todo va en un solo `$transaction` de array: la página y su total son una
   * foto consistente y se paga un único viaje a la base en vez de dos.
   */
  async obtenerTodosLosUsuarios(
    filtros: ListarUsuariosDto = {},
  ): Promise<UsuariosPaginadosDto> {
    const pagina = Math.max(1, Math.trunc(filtros.page ?? 1));
    const porPagina = Math.min(
      Math.max(Math.trunc(filtros.pageSize ?? PAGINA_POR_DEFECTO), 1),
      PAGINA_MAXIMA,
    );
    const busqueda = filtros.busqueda?.trim() ?? '';
    const estado = filtros.estado ?? 'TODOS';
    const rol = filtros.rol;

    // El `where` se compone en la base: el buscador y los filtros NO viajan al
    // navegador, así que `total` y las páginas cuentan lo mismo que se ve.
    const where: Prisma.UsuarioWhereInput = {
      ...(estado === 'TODOS' ? {} : { estadoCuenta: estado }),
      // Solo vínculos VIGENTES: `usuario_roles.estado = 'INACTIVO'` significa rol
      // revocado (el JWT y el menú también lo excluyen), así que filtrar por rol
      // no puede devolver cuentas que ya no lo tienen.
      ...(rol
        ? { usuarioRoles: { some: { estado: 'ACTIVO', rol: { nombre: rol } } } }
        : {}),
      ...(busqueda
        ? {
            OR: [
              { nombreCompleto: { contains: busqueda, mode: 'insensitive' } },
              { correo: { contains: busqueda, mode: 'insensitive' } },
              // El teléfono son dígitos: `insensitive` no aporta y sí impide usar
              // el índice de prefijo.
              { telefono: { contains: busqueda } },
            ],
          }
        : {}),
    };

    const [total, usuarios] = await this.prisma.$transaction([
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.findMany({
        where,
        orderBy: [{ creadoAt: 'desc' }, { id: 'asc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          nombreCompleto: true,
          correo: true,
          telefono: true,
          estadoCuenta: true,
          creadoAt: true,
          // La columna ROLES enseña los roles que la cuenta EJERCE hoy; el
          // modal de roles (`GET /:id/roles`) sí lista cada vínculo con su
          // estado, que es donde el administrador necesita ver los revocados.
          usuarioRoles: {
            where: { estado: 'ACTIVO' },
            select: {
              rol: {
                select: { nombre: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      datos: usuarios.map((usuario) => ({
        id: usuario.id,
        nombreCompleto: usuario.nombreCompleto,
        correo: usuario.correo,
        telefono: usuario.telefono,
        estadoCuenta: usuario.estadoCuenta,
        fechaRegistro: usuario.creadoAt,
        roles: [...new Set(usuario.usuarioRoles.map(({ rol }) => rol.nombre))],
      })),
      total,
      pagina,
      porPagina,
    };
  }

  /**
   * KPI de la bandeja de plataforma · `GET /plataforma/usuarios/resumen`.
   *
   * Vive en su PROPIA ruta, no dentro del listado, por dos razones:
   *
   * 1. **Coherencia de contrato.** El listado paginado responde exactamente
   *    `{ datos, total, pagina, porPagina }`: `total` describe el conjunto
   *    FILTRADO y el KPI describe la plataforma ENTERA. Son dos preguntas
   *    distintas y ahora son dos recursos distintos.
   * 2. **Escalabilidad.** Los agregados (`count(*)` × 2 y un `groupBy` sobre
   *    todos los vínculos) no se pagan en cada página ni en cada tecla del
   *    buscador: la pantalla los pide una vez por visita y los invalida cuando
   *    escribe (alta, suspensión, borrado o cambio de rol).
   *
   * `porRol` cuenta CUENTAS distintas con el rol VIGENTE: `estado='INACTIVO'`
   * es un rol revocado y no debe inflar las tarjetas. Un renglón por par
   * (rol, cuenta) evita necesitar `COUNT(DISTINCT ...)`.
   */
  async obtenerResumenUsuarios(): Promise<ResumenUsuariosDto> {
    const [activos, suspendidos, vinculos, catalogo] = await this.prisma.$transaction([
      this.prisma.usuario.count({ where: { estadoCuenta: 'ACTIVO' } }),
      this.prisma.usuario.count({ where: { estadoCuenta: 'SUSPENDIDO' } }),
      this.prisma.usuarioRol.groupBy({
        by: ['rolId', 'usuarioId'],
        where: { estado: 'ACTIVO' },
        _count: { _all: true },
      }),
      this.prisma.rol.findMany({ select: { id: true, nombre: true } }),
    ]);

    const nombrePorRolId = new Map(catalogo.map((fila) => [fila.id, fila.nombre]));
    const porRol: Record<string, number> = Object.fromEntries(
      ROLES_KPI.map((nombre) => [nombre, 0]),
    );

    for (const fila of vinculos) {
      const nombre = nombrePorRolId.get(fila.rolId);
      if (nombre && nombre in porRol) porRol[nombre] += 1;
    }

    // La cuenta solo puede estar ACTIVA o SUSPENDIDA: la suma es el total sin
    // pagar una quinta consulta.
    return { total: activos + suspendidos, activos, suspendidos, porRol };
  }

  /**
   * Alta administrativa de una cuenta · `POST /plataforma/usuarios`.
   *
   * Es el camino de `/auth/register` con dos diferencias: aquí el ADMINISTRADOR
   * elige el ROL y, para los roles de sede, la barbería. Lo demás es idéntico:
   * bcrypt de 10 rondas, cuenta ACTIVA, cédula opcional y `telefono` obligatorio
   * (la columna es `UNIQUE NOT NULL`).
   *
   * Orden de las comprobaciones:
   *  1. Unicidad de correo / teléfono / cédula → 409 D40 (`*_YA_REGISTRADO`). El
   *     `P2002` del índice único se traduce también, para la carrera entre dos
   *     administradores creando el mismo correo a la vez.
   *  2. El rol tiene que existir en el catálogo (si no, es configuración rota: 500,
   *     igual que `register` con CLIENTE ausente).
   *  3. Ámbito del rol: `BARBERIA` exige `barberiaId` (422 `BARBERIA_REQUERIDA`) y
   *     un rol `GLOBAL` no admite sede (422 `BARBERIA_NO_APLICA`), porque un
   *     `barberia_id` en una fila de rol global rompe el alcance del `RolesGuard`.
   *  4. La barbería referenciada tiene que existir (404).
   *  5. Un solo `ADMIN_BARBERIA` ACTIVO por sede → 409 `SEDE_YA_TIENE_ADMIN` con
   *     `adminActual: { id, correo, nombreCompleto }` (Fase 1). Se comprueba
   *     DENTRO de la transacción y con aislamiento SERIALIZABLE: dos altas
   *     simultáneas de dueño en la misma sede no pueden pasar las dos.
   *
   * Usuario, `usuario_roles` y evento de auditoría van en UNA transacción: una
   * cuenta sin rol o sin rastro no existe (D28).
   */
  async crearUsuario(
    dto: CrearUsuarioPlataformaDto,
    solicitante: UsuarioAutenticado,
  ): Promise<UsuarioListResponseDto> {
    const correo = dto.correo.trim();
    const telefono = dto.telefono.trim();
    const cedula = dto.cedula?.trim() || null;

    // Una sola consulta para los tres campos únicos; el mensaje dice cuál chocó.
    const existente = await this.prisma.usuario.findFirst({
      where: { OR: [{ correo }, { telefono }, ...(cedula ? [{ cedula }] : [])] },
      select: { correo: true, telefono: true, cedula: true },
    });

    if (existente) {
      if (existente.correo === correo) {
        throw errorDeConflicto('CORREO_YA_REGISTRADO', 'El correo ya está registrado.');
      }
      if (cedula && existente.cedula === cedula) {
        throw errorDeConflicto('CEDULA_YA_REGISTRADA', 'La cédula ya está registrada.');
      }
      throw errorDeConflicto('TELEFONO_YA_REGISTRADO', 'El teléfono ya está registrado.');
    }

    const rol = await this.prisma.rol.findUnique({
      where: { nombre: dto.rolNombre },
      select: { id: true, nombre: true, ambito: true },
    });

    if (!rol) {
      this.logger.error(`El rol ${dto.rolNombre} no existe en el catálogo. Ejecuta: npm run seed`);
      throw new InternalServerErrorException('Error de configuración del sistema.');
    }

    const barberiaId = dto.barberiaId ?? null;
    const esDeSede = rol.ambito === AMBITO_BARBERIA;

    if (esDeSede && !barberiaId) {
      throw reglaDeNegocio(
        'BARBERIA_REQUERIDA',
        `El rol ${rol.nombre} es de ámbito BARBERIA y exige barbería.`,
      );
    }

    if (!esDeSede && barberiaId) {
      throw reglaDeNegocio(
        'BARBERIA_NO_APLICA',
        `El rol ${rol.nombre} es de ámbito GLOBAL: no se asigna a una barbería.`,
      );
    }

    if (barberiaId) {
      const barberia = await this.prisma.barberia.findUnique({
        where: { id: barberiaId },
        select: { id: true },
      });

      if (!barberia) {
        throw new NotFoundException('Barbería no encontrada.');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const creado = await withSerializableTransaction(this.prisma, async (tx) => {
        // Fase 1 · regla de cardinalidad. Va primero: si la sede ya tiene dueño
        // no tiene sentido hashear la contraseña ni abrir el alta, y así la
        // cuenta no llega a existir cuando se rechaza (nada de huérfanos).
        if (rol.nombre === ROL_ADMIN_BARBERIA) {
          await asegurarSedeSinAdmin(tx, barberiaId as string);
        }

        const usuario = await tx.usuario.create({
          data: {
            nombreCompleto: dto.nombreCompleto.trim(),
            correo,
            telefono,
            cedula,
            passwordHash,
            // D48: el alta nace ACTIVO; suspender es una decisión manual aparte.
            estadoCuenta: 'ACTIVO',
          },
          select: {
            id: true,
            nombreCompleto: true,
            correo: true,
            telefono: true,
            estadoCuenta: true,
            creadoAt: true,
          },
        });

        await tx.usuarioRol.create({
          data: { usuarioId: usuario.id, rolId: rol.id, barberiaId },
        });

        await this.auditoria.registrarEvento(
          {
            usuarioId: solicitante.id,
            barberiaId,
            accion: 'USUARIO_CREADO',
            entidad: 'usuarios',
            entidadId: usuario.id,
            contexto: {
              correo: usuario.correo,
              nombreCompleto: usuario.nombreCompleto,
              rol: rol.nombre,
              barberiaId,
            },
          },
          tx,
        );

        return usuario;
      });

      this.logger.log(
        `Cuenta ${creado.correo} creada por ${solicitante.correo} con rol ${rol.nombre}.`,
      );

      return {
        id: creado.id,
        nombreCompleto: creado.nombreCompleto,
        correo: creado.correo,
        telefono: creado.telefono,
        estadoCuenta: creado.estadoCuenta,
        fechaRegistro: creado.creadoAt,
        roles: [rol.nombre],
      };
    } catch (error: any) {
      // F6 · el trigger de administrador único puede ganar la carrera: se traduce
      // al mismo 409 con `adminActual` que la regla de dominio.
      if (barberiaId && esConflictoAdminUnico(error)) {
        await asegurarSedeSinAdmin(this.prisma, barberiaId);
      }

      if (error?.code === 'P2002') {
        const { codigo, mensaje } = codigoDeDuplicado(error?.meta?.target);
        throw errorDeConflicto(codigo, mensaje);
      }
      throw error;
    }
  }

  /**
   * Historial de auditoría de UNA cuenta · `GET /plataforma/usuarios/:id/auditoria`.
   *
   * Lee los eventos cuyo TARGET es el usuario (`entidad` de usuario y
   * `entidadId` = su id): altas, suspensiones, reactivaciones, restablecimientos
   * de contraseña y cualquier cambio de rol que se registre con esa entidad. El
   * `actor` que acompaña a cada fila es quien lo ejecutó (`auditoria.usuario_id`).
   *
   * El orden es `creado_at DESC`: lo último que le pasó a la cuenta, arriba. No se
   * pagina porque el historial de una cuenta es acotado; si crece, se añade el
   * sobre `{ data, total }` de D32 sin cambiar el contrato de cada fila.
   */
  async obtenerAuditoriaUsuario(usuarioId: string): Promise<UsuarioAuditoriaResponseDto[]> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    const eventos = await this.prisma.auditoria.findMany({
      where: { entidadId: usuarioId, entidad: { in: ENTIDADES_DE_USUARIO } },
      orderBy: { creadoAt: 'desc' },
      select: {
        id: true,
        accion: true,
        entidad: true,
        entidadId: true,
        barberiaId: true,
        contexto: true,
        creadoAt: true,
        usuario: {
          select: { id: true, nombreCompleto: true, correo: true },
        },
      },
    });

    return eventos.map((evento) => ({
      id: evento.id,
      accion: evento.accion,
      entidad: evento.entidad,
      entidadId: evento.entidadId,
      barberiaId: evento.barberiaId,
      motivo: motivoDelContexto(evento.contexto),
      contexto: (evento.contexto as unknown as Record<string, unknown> | null) ?? null,
      actor: evento.usuario ?? null,
      creadoAt: evento.creadoAt,
    }));
  }

  // ── T-72 · eliminación real de una cuenta ─────────────────────────────────

  /**
   * `DELETE /plataforma/usuarios/:id` · borra la cuenta de verdad.
   *
   * Orden de las comprobaciones (todas ANTES de escribir nada):
   *  1. no se puede eliminar a sí mismo (409 `AUTOBORRADO_NO_PERMITIDO`);
   *  2. el correo de confirmación tiene que coincidir EXACTO (422
   *     `CONFIRMACION_INCORRECTA`);
   *  3. no se puede dejar la plataforma sin administrador (409
   *     `ULTIMO_ADMINISTRADOR`);
   *  4. un ADMIN_BARBERIA activo exige transferir primero (409
   *     `USUARIO_ES_ADMIN_SEDE` con las sedes);
   *  5. un responsable de sede exige reasignar primero (409
   *     `USUARIO_ES_RESPONSABLE_SEDE` con las sedes);
   *  6. vínculos RESTRICT que esta tarea no migra: propuestas de horario y
   *     solicitudes de antecedente resueltas.
   *
   * Después, en UNA transacción serializable: respaldo → pagos y cajas con el
   * nombre congelado → cancelación de reservas futuras → auditoría sin FK →
   * borrado de la fila → evento `USUARIO_ELIMINADO`. Si algo falla, no se borra
   * nada: el respaldo y el borrado comparten transacción.
   */
  async eliminarUsuario(
    usuarioId: string,
    solicitante: UsuarioAutenticado,
    dto: EliminarUsuarioDto,
  ): Promise<EliminarUsuarioResultado> {
    if (usuarioId === solicitante.id) {
      throw errorDeConflicto(
        'AUTOBORRADO_NO_PERMITIDO',
        'No puedes eliminar tu propia cuenta desde la bandeja de plataforma.',
      );
    }

    const confirmacion = (dto?.confirmacion ?? '').trim();

    return withSerializableTransaction(this.prisma, async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { id: usuarioId },
        include: {
          _count: {
            select: {
              reservas: true,
              reservasBarbero: true,
              pagosRegistrados: true,
              antecedentes: true,
              notificaciones: true,
            },
          },
        },
      });

      if (!usuario) {
        throw new NotFoundException('Usuario no encontrado.');
      }

      if (confirmacion !== usuario.correo) {
        throw reglaDeNegocio(
          'CONFIRMACION_INCORRECTA',
          'La confirmación no coincide con el correo exacto de la cuenta: no se elimina nada.',
        );
      }

      const roles = await tx.usuarioRol.findMany({
        where: { usuarioId },
        select: {
          id: true,
          estado: true,
          rol: { select: { nombre: true, ambito: true } },
          barberia: { select: { id: true, nombre: true } },
        },
      });

      const esAdminGlobal = roles.some(
        (rol) =>
          rol.estado === 'ACTIVO' &&
          rol.barberia === null &&
          rol.rol.nombre === ROL_ADMINISTRADOR,
      );

      if (esAdminGlobal) {
        const administradores = await tx.usuarioRol.count({
          where: {
            rol: { nombre: ROL_ADMINISTRADOR },
            barberiaId: null,
            estado: 'ACTIVO',
            usuario: { estadoCuenta: 'ACTIVO' },
          },
        });

        if (administradores <= 1) {
          throw errorDeConflicto(
            'ULTIMO_ADMINISTRADOR',
            'No puedes eliminar al último administrador activo de la plataforma.',
          );
        }
      }

      const sedesAdmin: SedeAfectada[] = roles.flatMap((rol) =>
        rol.estado === 'ACTIVO' &&
        rol.rol.nombre === ROL_ADMIN_BARBERIA &&
        rol.barberia !== null
          ? [{ id: rol.barberia.id, nombre: rol.barberia.nombre }]
          : [],
      );

      if (sedesAdmin.length > 0) {
        throw errorDeConflicto(
          'USUARIO_ES_ADMIN_SEDE',
          'La cuenta administra una sede: transfiere la administración antes de eliminarla.',
          { sedes: sedesAdmin },
        );
      }

      const sedesResponsable = await tx.barberia.findMany({
        where: { responsableId: usuarioId },
        select: { id: true, nombre: true },
      });

      if (sedesResponsable.length > 0) {
        throw errorDeConflicto(
          'USUARIO_ES_RESPONSABLE_SEDE',
          'La cuenta figura como responsable de una sede: reasigna esa responsabilidad antes de eliminarla.',
          { sedes: sedesResponsable },
        );
      }

      const propuestas = await tx.propuestaHorario.count({ where: { creadoPor: usuarioId } });

      if (propuestas > 0) {
        throw errorDeConflicto(
          'USUARIO_CON_PROPUESTAS_HORARIO',
          'La cuenta creó propuestas de horario que la referencian: no se puede eliminar todavía.',
          { total: propuestas },
        );
      }

      const solicitudesResueltas = await tx.solicitudAntecedente.count({
        where: { resueltoPor: usuarioId },
      });

      if (solicitudesResueltas > 0) {
        throw errorDeConflicto(
          'USUARIO_CON_SOLICITUDES_ANTECEDENTES',
          'La cuenta resolvió solicitudes de antecedente que la referencian: no se puede eliminar todavía.',
          { total: solicitudesResueltas },
        );
      }

      // 1 · respaldo íntegro. El hash de la contraseña NO se copia: no hace falta
      // para auditar el borrado y no debe sobrevivir a la cuenta.
      const snapshot = {
        id: usuario.id,
        nombreCompleto: usuario.nombreCompleto,
        correo: usuario.correo,
        telefono: usuario.telefono,
        cedula: usuario.cedula,
        estadoCuenta: usuario.estadoCuenta,
        tokenVersion: usuario.tokenVersion,
        correoVerificado: usuario.correoVerificado,
        telefonoVerificado: usuario.telefonoVerificado,
        creadoAt: usuario.creadoAt?.toISOString() ?? null,
        roles: roles.map((rol) => ({
          rol: rol.rol.nombre,
          ambito: rol.rol.ambito,
          estado: rol.estado,
          barberiaId: rol.barberia?.id ?? null,
          barberiaNombre: rol.barberia?.nombre ?? null,
        })),
        relaciones: {
          reservasComoCliente: usuario._count?.reservas ?? 0,
          reservasComoBarbero: usuario._count?.reservasBarbero ?? 0,
          pagosRegistrados: usuario._count?.pagosRegistrados ?? 0,
          antecedentes: usuario._count?.antecedentes ?? 0,
          notificaciones: usuario._count?.notificaciones ?? 0,
        },
      };

      const respaldo = await tx.respaldoEliminacion.create({
        data: { usuarioId, snapshot, eliminadoPor: solicitante.id },
      });

      // 2 y 3 · pagos y arqueos: el FK se apaga y el nombre queda congelado.
      const nombre = usuario.nombreCompleto;
      const pagosRegistrados = await tx.pago.updateMany({
        where: { registradoPor: usuarioId },
        data: { registradoPor: null, usuarioNombreSnapshot: nombre },
      });
      const pagosAnulados = await tx.pago.updateMany({
        where: { anuladoPor: usuarioId },
        data: { anuladoPor: null, usuarioNombreSnapshot: nombre },
      });
      const cajasAbiertas = await tx.cierreCaja.updateMany({
        where: { abiertoPor: usuarioId },
        data: { abiertoPor: null, usuarioNombreSnapshot: nombre },
      });
      const cajasCerradas = await tx.cierreCaja.updateMany({
        where: { cerradoPor: usuarioId },
        data: { cerradoPor: null, usuarioNombreSnapshot: nombre },
      });

      // 4 · reservas futuras: se cancelan (el historial pasado se conserva y el
      // SET NULL de la FK lo desvincula al borrar la cuenta).
      const ahora = this.tiempo.ahora();
      const hoy = this.tiempo.fechaLocal(ahora);
      const candidatas = await tx.reserva.findMany({
        where: {
          clienteId: usuarioId,
          estado: { in: ['PENDIENTE', 'CONFIRMADA', 'PROPUESTA_PENDIENTE'] },
          fechaCita: { gte: this.tiempo.fechaDeCalendario(this.tiempo.sumarDias(hoy, -1)) },
        },
        select: {
          id: true,
          fechaCita: true,
          horaInicio: true,
          barberia: { select: { zonaHoraria: true } },
        },
      });

      const futuras = candidatas.filter(
        (reserva) =>
          this.tiempo
            .aInstante(
              fechaCalendarioISO(reserva.fechaCita),
              horaRelojHHMM(reserva.horaInicio),
              reserva.barberia.zonaHoraria,
            )
            .getTime() > ahora.getTime(),
      );

      if (futuras.length > 0) {
        await tx.reserva.updateMany({
          where: { id: { in: futuras.map((reserva) => reserva.id) } },
          data: {
            estado: 'CANCELADA',
            canceladoPorId: solicitante.id,
            motivoCodigo: 'OTRO',
            motivoDetalle: 'Cuenta eliminada por la plataforma',
          },
        });
      }

      // 6 · la auditoría sobrevive sin FK al usuario: el correo queda escrito en
      // el contexto para no perder de quién era el evento.
      await tx.$executeRaw`
        UPDATE "auditoria"
        SET "usuario_id" = NULL,
            "contexto" = COALESCE("contexto", '{}'::jsonb)
              || jsonb_build_object(
                   'correoEliminado', ${usuario.correo}::text,
                   'usuarioEliminadoId', ${usuarioId}::text
                 )
        WHERE "usuario_id" = ${usuarioId}::uuid
      `;

      // 7 · borrar la fila. `usuario_roles`, cliente_barberias y el resto de
      // CASCADE se limpian solos; los RESTRICT ya se comprobaron arriba.
      await tx.usuario.delete({ where: { id: usuarioId } });

      // Verificación explícita de T-72: el correo queda libre.
      const restantes = await tx.usuario.count({ where: { correo: usuario.correo } });

      const reservasCanceladas = futuras.length;
      const pagosDesvinculados = pagosRegistrados.count + pagosAnulados.count;
      const cajasDesvinculadas = cajasAbiertas.count + cajasCerradas.count;

      // 8 · evento final, con el actor y el correo del eliminado.
      await this.auditoria.registrarEvento(
        {
          usuarioId: solicitante.id,
          accion: 'USUARIO_ELIMINADO',
          entidad: 'usuarios',
          entidadId: usuarioId,
          contexto: {
            correo: usuario.correo,
            nombreCompleto: usuario.nombreCompleto,
            respaldoId: respaldo.id,
            reservasCanceladas,
            pagosDesvinculados,
            cajasDesvinculadas,
            correoLiberado: restantes === 0,
          },
        },
        tx,
      );

      this.logger.warn(
        `Cuenta ${usuario.correo} ELIMINADA por ${solicitante.correo} (respaldo ${respaldo.id}, ${reservasCanceladas} reservas canceladas)`,
      );

      return {
        id: usuarioId,
        correo: usuario.correo,
        correoLiberado: restantes === 0,
        respaldoId: respaldo.id,
        reservasCanceladas,
        pagosDesvinculados,
        cajasDesvinculadas,
      } satisfies EliminarUsuarioResultado;
    });
  }

  /**
   * `GET /plataforma/usuarios/:id/eliminacion` · resumen de solo lectura (T-74).
   *
   * La UI no puede inventar cuántas reservas o pagos se van a desvincular: este
   * cálculo es el MISMO que aplica `eliminarUsuario`, para que el modal muestre
   * cifras reales y no una promesa genérica. También devuelve los bloqueos
   * vigentes (último administrador, admin de sede, responsable, etc.) para que
   * el botón de confirmar no ofrezca algo que el backend va a rechazar.
   */
  async previsualizarEliminacion(usuarioId: string): Promise<PrevisualizacionEliminacion> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, correo: true, nombreCompleto: true },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    const roles = await this.prisma.usuarioRol.findMany({
      where: { usuarioId },
      select: {
        estado: true,
        rol: { select: { nombre: true } },
        barberia: { select: { id: true, nombre: true } },
      },
    });

    const esAdminGlobal = roles.some(
      (rol) =>
        rol.estado === 'ACTIVO' &&
        rol.barberia === null &&
        rol.rol.nombre === ROL_ADMINISTRADOR,
    );

    const sedesAdministradas: SedeAfectada[] = roles.flatMap((rol) =>
      rol.estado === 'ACTIVO' && rol.rol.nombre === ROL_ADMIN_BARBERIA && rol.barberia
        ? [{ id: rol.barberia.id, nombre: rol.barberia.nombre }]
        : [],
    );

    const ahora = this.tiempo.ahora();
    const hoy = this.tiempo.fechaLocal(ahora);

    const [candidatas, sedesResponsable, pagosRegistrados, pagosAnulados, cajasAbiertas, cajasCerradas, propuestasHorario, solicitudesResueltas, administradores] =
      await Promise.all([
        this.prisma.reserva.findMany({
          where: {
            clienteId: usuarioId,
            estado: { in: ['PENDIENTE', 'CONFIRMADA', 'PROPUESTA_PENDIENTE'] },
            fechaCita: { gte: this.tiempo.fechaDeCalendario(this.tiempo.sumarDias(hoy, -1)) },
          },
          select: {
            fechaCita: true,
            horaInicio: true,
            barberia: { select: { zonaHoraria: true } },
          },
        }),
        this.prisma.barberia.findMany({
          where: { responsableId: usuarioId },
          select: { id: true, nombre: true },
        }),
        this.prisma.pago.count({ where: { registradoPor: usuarioId } }),
        this.prisma.pago.count({ where: { anuladoPor: usuarioId } }),
        this.prisma.cierreCaja.count({ where: { abiertoPor: usuarioId } }),
        this.prisma.cierreCaja.count({ where: { cerradoPor: usuarioId } }),
        this.prisma.propuestaHorario.count({ where: { creadoPor: usuarioId } }),
        this.prisma.solicitudAntecedente.count({ where: { resueltoPor: usuarioId } }),
        esAdminGlobal
          ? this.prisma.usuarioRol.count({
              where: {
                rol: { nombre: ROL_ADMINISTRADOR },
                barberiaId: null,
                estado: 'ACTIVO',
                usuario: { estadoCuenta: 'ACTIVO' },
              },
            })
          : Promise.resolve(0),
      ]);

    const reservasFuturas = candidatas.filter(
      (reserva) =>
        this.tiempo
          .aInstante(
            fechaCalendarioISO(reserva.fechaCita),
            horaRelojHHMM(reserva.horaInicio),
            reserva.barberia.zonaHoraria,
          )
          .getTime() > ahora.getTime(),
    ).length;

    const bloqueos: string[] = [];
    if (esAdminGlobal && administradores <= 1) bloqueos.push('ULTIMO_ADMINISTRADOR');
    if (sedesAdministradas.length > 0) bloqueos.push('USUARIO_ES_ADMIN_SEDE');
    if (sedesResponsable.length > 0) bloqueos.push('USUARIO_ES_RESPONSABLE_SEDE');
    if (propuestasHorario > 0) bloqueos.push('USUARIO_CON_PROPUESTAS_HORARIO');
    if (solicitudesResueltas > 0) bloqueos.push('USUARIO_CON_SOLICITUDES_ANTECEDENTES');

    return {
      id: usuario.id,
      correo: usuario.correo,
      reservasFuturas,
      pagosDesvinculados: pagosRegistrados + pagosAnulados,
      cajasDesvinculadas: cajasAbiertas + cajasCerradas,
      sedesAdministradas,
      sedesResponsable,
      propuestasHorario,
      solicitudesResueltas,
      puedeEliminar: bloqueos.length === 0,
      bloqueos,
    };
  }

  // ── T-73 · transferir la administración de una sede ────────────────────────

  /**
   * `PATCH /plataforma/sedes/:sedeId/transferir-admin` · cambia de dueño.
   *
   * El trigger `fn_admin_barberia_unico_por_sede` permite UN `ADMIN_BARBERIA`
   * ACTIVO por sede y cuenta activa, así que el orden es obligatorio: primero se
   * degrada al anterior (`INACTIVO`, no se borra la fila) y después se promueve
   * al nuevo. Todo en una transacción serializable: si la promoción falla, el
   * dueño anterior sigue siendo dueño.
   *
   * El nuevo administrador: cuenta ACTIVA y, si ya tenía un vínculo
   * `ADMIN_BARBERIA` INACTIVO en la sede, se reactiva en vez de duplicarlo. Si no
   * tenía ninguno, se crea. Un vínculo `BARBERO` se conserva: la cuenta dual
   * (ADMIN_BARBERIA + BARBERO en la misma sede) es válida.
   */
  async transferirAdministracionSede(
    sedeId: string,
    dto: TransferirAdministracionDto,
    solicitante: UsuarioAutenticado,
  ): Promise<TransferenciaAdministracionResultado> {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const sede = await tx.barberia.findUnique({
        where: { id: sedeId },
        select: { id: true, nombre: true },
      });

      if (!sede) {
        throw new NotFoundException('Barbería no encontrada.');
      }

      const adminActual = await tx.usuarioRol.findFirst({
        where: {
          barberiaId: sedeId,
          estado: 'ACTIVO',
          rol: { nombre: ROL_ADMIN_BARBERIA },
          usuario: { estadoCuenta: 'ACTIVO' },
        },
        select: {
          id: true,
          usuarioId: true,
          usuario: { select: { id: true, correo: true, nombreCompleto: true } },
        },
      });

      if (!adminActual) {
        throw errorDeConflicto(
          'SEDE_SIN_ADMIN',
          'La sede no tiene administrador activo: no hay administración que transferir.',
        );
      }

      if (adminActual.usuarioId === dto.nuevoAdminId) {
        throw errorDeConflicto(
          'TRANSFERENCIA_AL_MISMO_ADMIN',
          'La cuenta indicada ya administra esta sede.',
        );
      }

      const nuevo = await tx.usuario.findUnique({
        where: { id: dto.nuevoAdminId },
        select: { id: true, correo: true, nombreCompleto: true, estadoCuenta: true },
      });

      if (!nuevo) {
        throw new NotFoundException('Usuario no encontrado.');
      }

      if (nuevo.estadoCuenta !== 'ACTIVO') {
        throw errorDeConflicto(
          'CUENTA_NO_ACTIVA',
          'Solo una cuenta ACTIVA puede recibir la administración de una sede.',
        );
      }

      const rolAdmin = await tx.rol.findUnique({
        where: { nombre: ROL_ADMIN_BARBERIA },
        select: { id: true },
      });

      if (!rolAdmin) {
        throw new InternalServerErrorException(
          'Configuración incompleta: el rol ADMIN_BARBERIA no existe. Ejecuta el seed.',
        );
      }

      const vinculoNuevo = await tx.usuarioRol.findFirst({
        where: {
          usuarioId: dto.nuevoAdminId,
          barberiaId: sedeId,
          rol: { nombre: ROL_ADMIN_BARBERIA },
        },
        select: { id: true, estado: true },
      });

      if (vinculoNuevo?.estado === 'ACTIVO') {
        throw errorDeConflicto(
          'YA_ES_ADMIN_SEDE',
          'La cuenta ya administra esta sede.',
        );
      }

      // El trigger exige que no queden dos ACTIVOS: degradar primero.
      await tx.usuarioRol.update({
        where: { id: adminActual.id },
        data: { estado: 'INACTIVO' },
      });

      if (vinculoNuevo) {
        await tx.usuarioRol.update({
          where: { id: vinculoNuevo.id },
          data: { estado: 'ACTIVO' },
        });
      } else {
        await tx.usuarioRol.create({
          data: { usuarioId: dto.nuevoAdminId, rolId: rolAdmin.id, barberiaId: sedeId },
        });
      }

      await this.auditoria.registrarEvento(
        {
          usuarioId: solicitante.id,
          barberiaId: sedeId,
          accion: 'ADMIN_TRANSFERIDO',
          entidad: 'usuario_roles',
          entidadId: vinculoNuevo?.id ?? adminActual.id,
          contexto: {
            sedeId,
            sedeNombre: sede.nombre,
            adminAnteriorId: adminActual.usuarioId,
            adminAnteriorCorreo: adminActual.usuario?.correo ?? null,
            nuevoAdminId: nuevo.id,
            nuevoAdminCorreo: nuevo.correo,
          },
        },
        tx,
      );

      this.logger.warn(
        `Administración de ${sede.nombre} transferida de ${adminActual.usuarioId} a ${nuevo.correo} por ${solicitante.correo ?? solicitante.id}`,
      );

      return {
        sedeId,
        adminAnteriorId: adminActual.usuarioId,
        nuevoAdminId: nuevo.id,
      } satisfies TransferenciaAdministracionResultado;
    });
  }
}
