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
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { AMBITO_BARBERIA } from '../domain/roles.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';
import type { CambiarEstadoCuentaDto } from './dto/cambiar-estado-cuenta.dto.js';
import type { CrearUsuarioPlataformaDto } from './dto/crear-usuario-plataforma.dto.js';
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

  /**
   * Lista todos los usuarios de la plataforma.
   *
   * Contrato:
   * - `GET /plataforma/usuarios` → `200` con `UsuarioListResponseDto[]`.
   * - Solo `ADMINISTRADOR` (D05), aprobado por `RolesGuard` + `@Roles`.
   * - Orden: `fecha_registro DESC` (la columna se llama `creado_at`).
   * - `roles` sale como un array de strings con los nombres, sin repetir: un
   *   `ADMIN_BARBERIA` con tres sedes aparece una sola vez.
   *
   * El `select` es explícito a propósito: `password_hash`, `token_version` y
   * `cedula` no se leen, así que no hay forma de que se cuelen en la respuesta.
   */
  async obtenerTodosLosUsuarios(): Promise<UsuarioListResponseDto[]> {
    const usuarios = await this.prisma.usuario.findMany({
      orderBy: { creadoAt: 'desc' },
      select: {
        id: true,
        nombreCompleto: true,
        correo: true,
        telefono: true,
        estadoCuenta: true,
        creadoAt: true,
        usuarioRoles: {
          select: {
            rol: {
              select: { nombre: true },
            },
          },
        },
      },
    });

    return usuarios.map((usuario) => ({
      id: usuario.id,
      nombreCompleto: usuario.nombreCompleto,
      correo: usuario.correo,
      telefono: usuario.telefono,
      estadoCuenta: usuario.estadoCuenta,
      fechaRegistro: usuario.creadoAt,
      roles: [...new Set(usuario.usuarioRoles.map(({ rol }) => rol.nombre))],
    }));
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
      const creado = await this.prisma.$transaction(async (tx) => {
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
}
