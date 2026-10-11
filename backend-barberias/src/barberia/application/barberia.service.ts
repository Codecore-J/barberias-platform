import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import type { CreateBarberiaDto } from './dto/create-barberia.dto.js';
import type { UpdateBarberiaDto } from './dto/update-barberia.dto.js';
import type { BarberiaResponseDto } from './dto/barberia-response.dto.js';
import type { VincularBarberiaDto } from './dto/vincular-barberia.dto.js';
import type { ResolverVinculacionDto } from './dto/resolver-vinculacion.dto.js';
import { plainToInstance } from 'class-transformer';
import { BarberiaResponseDto as BarberiaResponse } from './dto/barberia-response.dto.js';
import type { BarberiaLecturaDto } from './dto/barberia-lectura.dto.js';
import { BarberiaLecturaDto as BarberiaLectura } from './dto/barberia-lectura.dto.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  alcanceCumple,
  esAdministradorGlobal,
  esAdministradorGlobalPorId,
  validarAsignacionRol,
} from '../../iam/domain/roles.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';
import { ESTADOS } from '../../shared/domain/estados.js';
import { reglaDeNegocio, errorDeConflicto } from '../../shared/errors/d40.errors.js';
import type { Prisma } from '@prisma/client';

/**
 * E3-12 (§5.3 · qué ocupa espacio). Una desvinculación no puede dejar reservas
 * vivas sin dueño en la agenda de la sede: `PROPUESTA_PENDIENTE` ocupa el hueco
 * propuesto (D18) igual que `PENDIENTE` y `CONFIRMADA`.
 */
export const ESTADOS_QUE_BLOQUEAN_DESVINCULAR = [
  ESTADOS.PENDIENTE,
  ESTADOS.PROPUESTA_PENDIENTE,
  ESTADOS.CONFIRMADA,
] as const;


/** Genera un slug URL-safe de hasta `maxLen` caracteres */
function generateSlug(text: string, maxLen = 40): string {
  const slug = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, maxLen);
  return slug.length > 0 ? slug : 'barberia';
}


/** Código de acceso alfanumérico de 8 caracteres (mayúsculas + dígitos) */
function generateCodigoAcceso(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join('');
}

@Injectable()
export class BarberiaService {
  private readonly logger = new Logger(BarberiaService.name);

  /** E2-04: el reloj central; la zona sale de `barberias.zona_horaria`. */
  private readonly tiempo = new TiempoService();

  constructor(
    private readonly prisma: PrismaService,
    // E3-12: la aprobación/rechazo de la 6ª notifican y auditan. Opcionales
    // para no romper los unitarios que construyen el servicio solo con prisma.
    @Optional() private readonly auditoriaService?: AuditoriaService,
    @Optional() private readonly notificacionService?: NotificacionService,
  ) {}

  /** Registra el evento si hay servicio de auditoría montado (D28). */
  private async auditar(
    dto: {
      usuarioId: string | null;
      accion: string;
      entidad: string;
      entidadId: string;
      contexto: Record<string, any>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!this.auditoriaService) return;
    await this.auditoriaService.registrarEvento(dto, tx as any);
  }


  // ── Helpers de mapeo ───────────────────────────────────────────────────────

  /** Mismo payload que `toResponse` sin `codigoAcceso` ni `enlaceUnico`. */
  private toLectura(barberia: any): BarberiaLecturaDto {
    return plainToInstance(BarberiaLectura, {
      id: barberia.id,
      nombre: barberia.nombre,
      descripcion: barberia.descripcion ?? null,
      telefono: barberia.telefono,
      ubicacion: barberia.ubicacion,
      responsableId: barberia.responsableId,
      estado: barberia.estado,
    });
  }

  private toResponse(barberia: any): BarberiaResponseDto {
    return plainToInstance(BarberiaResponse, {
      id: barberia.id,
      nombre: barberia.nombre,
      descripcion: barberia.descripcion ?? null,
      telefono: barberia.telefono,
      ubicacion: barberia.ubicacion,
      codigoAcceso: barberia.codigoAcceso,
      enlaceUnico: barberia.enlaceUnico,
      responsableId: barberia.responsableId,
      estado: barberia.estado,
    });
  }

  // ── CREAR ──────────────────────────────────────────────────────────────────

  /**
   * Crea una nueva barbería y asigna al usuario responsable el rol ADMIN_BARBERIA
   * dentro de un contexto multi-tenant (transacción SERIALIZABLE).
   *
   * Invariantes:
   *  - El slug y el código de acceso se generan en el servidor.
   *  - Se asigna automáticamente rol ADMIN_BARBERIA en usuario_roles.
   *  - Se crea la ConfiguracionBarberia por defecto.
   */
  async create(
    responsableId: string,
    dto: CreateBarberiaDto,
  ): Promise<BarberiaResponseDto> {
    return withSerializableTransaction(this.prisma, async (tx) => {
      // Generar identificadores únicos con colisión mínima
      const baseSlug = generateSlug(dto.nombre);
      const suffix = Date.now().toString(36).slice(-4);
      const enlaceUnico = `${baseSlug}-${suffix}`;
      const codigoAcceso = generateCodigoAcceso();

      // Verificar que el responsable existe
      const responsable = await tx.usuario.findUnique({
        where: { id: responsableId },
        select: { id: true },
      });
      if (!responsable) {
        throw new NotFoundException(`Usuario ${responsableId} no encontrado.`);
      }

      // Crear la barbería
      const barberia = await tx.barberia.create({
        data: {
          nombre: dto.nombre,
          descripcion: dto.descripcion,
          telefono: dto.telefono,
          ubicacion: dto.ubicacion,
          codigoAcceso,
          enlaceUnico,
          responsableId,
          estado: 'ACTIVO',
        },
      });

      // Asignar rol ADMIN_BARBERIA al responsable en este tenant
      const rolAdmin = await tx.rol.findUnique({
        where: { nombre: 'ADMIN_BARBERIA' },
        select: { id: true, nombre: true, ambito: true },
      });

      if (rolAdmin) {
        // E1-04: un rol de ámbito BARBERIA exige barbería.
        validarAsignacionRol(rolAdmin, barberia.id);
        await tx.usuarioRol.upsert({
          where: {
            uk_usuario_rol_barberia: {
              usuarioId: responsableId,
              rolId: rolAdmin.id,
              barberiaId: barberia.id,
            },
          },
          create: {
            usuarioId: responsableId,
            rolId: rolAdmin.id,
            barberiaId: barberia.id,
          },
          update: {},
        });
      }

      // Crear configuración por defecto
      await tx.configuracionBarberia.create({
        data: { barberiaId: barberia.id },
      });

      this.logger.log(`Barbería creada: ${barberia.id} por usuario ${responsableId}`);
      return this.toResponse(barberia);
    });
  }

  // ── LISTAR PERSONAL ────────────────────────────────────────────────────────

  /**
   * ¿El usuario tiene alguno de estos roles en ESA barbería? (E1-03 · H19)
   *
   * La comprobación es la misma que aplica E1-02 en auditoría: el decorador
   * `@Roles(...)` solo mira la lista plana de roles, así que sin esta
   * validación un admin o barbero de la barbería A vería el personal de la B.
   *
   * E1-04: un `barberiaId` nulo solo comodín para roles de ámbito GLOBAL.
   */
  private tieneAlgunRolEnBarberia(
    barberiaId: string,
    usuario: UsuarioAutenticado,
    roles: string[],
  ): boolean {
    return (usuario.rolesDetallados ?? []).some(
      (rol) => roles.includes(rol.nombre) && alcanceCumple(rol, barberiaId),
    );
  }

  /** El ADMINISTRADOR tiene acceso transversal: no está acotado a una barbería. */
  private esAdministrador(usuario: UsuarioAutenticado): boolean {
    return esAdministradorGlobal(usuario);
  }

  /**
   * E1-05/E1-07: criterio único para `codigoAcceso` y `enlaceUnico`. Lo usan
   * tanto la lectura por id como la lista de sedes, para que no vuelvan a
   * existir dos reglas distintas para el mismo dato.
   */
  private veCodigoDe(barberiaId: string, usuario: UsuarioAutenticado): boolean {
    return (
      this.esAdministrador(usuario) ||
      this.tieneAlgunRolEnBarberia(barberiaId, usuario, ['ADMIN_BARBERIA'])
    );
  }

  /**
   * Lista el personal (barberos y administradores) de una barbería.
   *
   * Puede leerla un ADMIN_BARBERIA o un BARBERO de esa misma barbería, y el
   * ADMINISTRADOR global por la regla global. Cualquier otro recibe 403.
   *
   * El correo y el teléfono son datos de contacto: solo los ve un
   * administrador. Un BARBERO recibe el resto de campos sin esos dos.
   */
  async findPersonal(barberiaId: string, usuario: UsuarioAutenticado) {
    const esGlobal = !!usuario && this.esAdministrador(usuario);
    const esAdmin =
      esGlobal ||
      (!!usuario && this.tieneAlgunRolEnBarberia(barberiaId, usuario, ['ADMIN_BARBERIA']));
    const puedeLeer =
      esAdmin ||
      (!!usuario && this.tieneAlgunRolEnBarberia(barberiaId, usuario, ['BARBERO']));

    if (!puedeLeer) {
      throw new ForbiddenException(
        'No posees el rol ADMIN_BARBERIA ni BARBERO en esa barbería.',
      );
    }

    const roles = await this.prisma.usuarioRol.findMany({
      where: { barberiaId },
      include: {
        usuario: {
          select: { id: true, nombreCompleto: true, correo: true, telefono: true, estadoCuenta: true }
        },
        rol: true
      }
    });

    // Group by user since a user might have multiple roles in the same barberia
    const userMap = new Map<string, any>();
    for (const r of roles) {
      if (!userMap.has(r.usuario.id)) {
        userMap.set(r.usuario.id, {
          id: r.usuario.id,
          nombreCompleto: r.usuario.nombreCompleto,
          correo: r.usuario.correo,
          telefono: r.usuario.telefono,
          estado: r.usuario.estadoCuenta,
          roles: []
        });
      }
      userMap.get(r.usuario.id).roles.push(r.rol.nombre);
    }

    const personal = Array.from(userMap.values());

    if (esAdmin) {
      return personal;
    }

    // BARBERO: se elimina el contacto del payload, no se deja en `undefined`
    // para que no aparezca al serializar.
    return personal.map(({ correo, telefono, ...resto }) => resto);
  }

  // ── LISTAR (propias del responsable) ──────────────────────────────────────

  /**
   * E1-07. Lista las sedes donde el usuario es responsable.
   *
   * El filtro `responsableId` ya impide sacar barberías ajenas, pero eso no es
   * lo mismo que la regla del código de acceso: quien figura como responsable
   * puede no tener su fila `usuario_roles` (la corrupción que ya hubo en E1-04),
   * y entonces recibiría `codigoAcceso` y `enlaceUnico` sin ser administrador de
   * nada. Por eso cada sede de la lista pasa por el MISMO criterio que usa
   * `findOne`: la puerta de entrada solo se entrega al ADMIN_BARBERIA de esa sede
   * y al ADMINISTRADOR global.
   */
  async findAllByResponsable(
    responsableId: string,
    usuario: UsuarioAutenticado,
  ): Promise<(BarberiaResponseDto | BarberiaLecturaDto)[]> {
    const barberias = await this.prisma.barberia.findMany({
      where: { responsableId },
      orderBy: { nombre: 'asc' },
    });
    return barberias.map((b) =>
      this.veCodigoDe(b.id, usuario) ? this.toResponse(b) : this.toLectura(b),
    );
  }

  // ── LISTAR TODAS (solo ADMINISTRADOR) ───────────────────────────────────

  async findAll(): Promise<BarberiaResponseDto[]> {
    const barberias = await this.prisma.barberia.findMany({
      orderBy: { nombre: 'asc' },
    });
    return barberias.map((b) => this.toResponse(b));
  }

  // ── OBTENER UNA ────────────────────────────────────────────────────────────

  /**
   * E1-05 (decisión 3): cualquier usuario autenticado puede leer una barbería,
   * pero `codigoAcceso` y `enlaceUnico` —que son la puerta de entrada— solo se
   * entregan al ADMIN_BARBERIA de esa barbería y al ADMINISTRADOR global.
   */
  async findOne(
    id: string,
    usuario: UsuarioAutenticado,
  ): Promise<BarberiaResponseDto | BarberiaLecturaDto> {
    const barberia = await this.prisma.barberia.findUnique({ where: { id } });
    if (!barberia) {
      throw new NotFoundException(`Barbería ${id} no encontrada.`);
    }

    return this.veCodigoDe(id, usuario)
      ? this.toResponse(barberia)
      : this.toLectura(barberia);
  }

  // ── ACTUALIZAR ─────────────────────────────────────────────────────────────

  /**
   * Solo el responsable o el ADMINISTRADOR global puede actualizar.
   * Comprobación de pertenencia: authUserId === barberia.responsableId
   */
  async update(
    id: string,
    authUserId: string,
    dto: UpdateBarberiaDto,
    esGlobal = false,
  ): Promise<BarberiaResponseDto> {
    const barberia = await this.prisma.barberia.findUnique({ where: { id } });
    if (!barberia) {
      throw new NotFoundException(`Barbería ${id} no encontrada.`);
    }

    if (!esGlobal && barberia.responsableId !== authUserId) {
      throw new ForbiddenException('Solo el responsable puede modificar esta barbería.');
    }

    const updated = await this.prisma.barberia.update({
      where: { id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.telefono && { telefono: dto.telefono }),
        ...(dto.ubicacion && { ubicacion: dto.ubicacion }),
        ...(dto.estado && { estado: dto.estado }),
      },
    });

    return this.toResponse(updated);
  }

  // ── ELIMINAR (soft-delete: estado → INACTIVO) ──────────────────────────────

  async remove(id: string, authUserId: string, esGlobal = false): Promise<void> {
    const barberia = await this.prisma.barberia.findUnique({ where: { id } });
    if (!barberia) {
      throw new NotFoundException(`Barbería ${id} no encontrada.`);
    }

    if (!esGlobal && barberia.responsableId !== authUserId) {
      throw new ForbiddenException('Solo el responsable puede eliminar esta barbería.');
    }

    await this.prisma.barberia.update({
      where: { id },
      data: { estado: 'INACTIVO' },
    });

    this.logger.log(`Barbería ${id} desactivada por usuario ${authUserId}`);
  }

  // ── VINCULAR CLIENTE A BARBERÍA (T2.2) ─────────────────────────────────────

  /**
   * Vincula a un usuario a una barbería utilizando su código de acceso.
   * Si el usuario ya tiene 5 o más vinculaciones, la nueva queda en estado PENDIENTE.
   * Utiliza SERIALIZABLE para evitar condición de carrera en el conteo.
   */
  async vincularCliente(usuarioId: string, dto: VincularBarberiaDto) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const barberia = await tx.barberia.findUnique({
        where: { codigoAcceso: dto.codigoAcceso },
      });

      if (!barberia || barberia.estado !== 'ACTIVO') {
        throw new NotFoundException('Barbería no encontrada o inactiva.');
      }

      // Check if already linked
      const existing = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId,
            barberiaId: barberia.id,
          },
        },
      });

      if (existing) {
        // E3-12 · D21: revincular reactiva la MISMA fila. No se borra ni se
        // recrea, de modo que `contador_no_presentado`, `esta_restringido` y
        // `motivo_restriccion` se conservan (D20: la restricción no se evade
        // desvinculándose).
        if (existing.estadoVinculacion === 'DESVINCULADO') {
          const reactivada = await tx.clienteBarberia.update({
            where: { id: existing.id },
            data: {
              estadoVinculacion: 'ACTIVO',
              // Solo puede ser la activa si no tiene otra: hay un índice único
              // parcial que lo garantiza en la base.
              esBarberiaActiva: !(await tx.clienteBarberia.findFirst({
                where: { usuarioId, esBarberiaActiva: true },
                select: { id: true },
              })),
            },
          });

          this.logger.log(`Usuario ${usuarioId} revinculó la barbería ${barberia.id}`);
          await this.auditar(
            {
              usuarioId,
              accion: 'VINCULACION_REVINCULADA',
              entidad: 'cliente_barberias',
              entidadId: reactivada.id,
              contexto: {
                barberiaId: barberia.id,
                estadoAnterior: 'DESVINCULADO',
                estadoNuevo: 'ACTIVO',
                contadorNoPresentado: reactivada.contadorNoPresentado,
                estaRestringido: reactivada.estaRestringido,
              },
            },
            tx,
          );
          return reactivada;
        }

        // Cualquier otro estado (ACTIVO o PENDIENTE_APROBACION) es idempotente.
        return existing;
      }

      // Conteo estricto (T2.2)
      const count = await tx.clienteBarberia.count({
        where: { usuarioId },
      });

      // E2-03/D10: el estado de la 6ª vinculación es `PENDIENTE_APROBACION`
      // (catálogo cerrado de `cliente_barberias.estado_vinculacion`). Antes se
      // escribía `PENDIENTE`, un valor fuera de catálogo que el CHECK de la base
      // ahora rechaza.
      const estadoVinculacion = count >= 5 ? 'PENDIENTE_APROBACION' : 'ACTIVO';
      const esBarberiaActiva = count === 0; // Si es la primera, la marcamos como activa por defecto

      const nuevaVinculacion = await tx.clienteBarberia.create({
        data: {
          usuarioId,
          barberiaId: barberia.id,
          estadoVinculacion,
          esBarberiaActiva,
        },
      });

      this.logger.log(`Usuario ${usuarioId} vinculado a Barbería ${barberia.id}. Estado: ${estadoVinculacion}`);

      await this.auditar(
        {
          usuarioId,
          accion: 'VINCULACION_CREADA',
          entidad: 'cliente_barberias',
          entidadId: nuevaVinculacion.id,
          contexto: {
            barberiaId: barberia.id,
            estado: estadoVinculacion,
            requiereAprobacion: estadoVinculacion === 'PENDIENTE_APROBACION',
          },
        },
        tx,
      );

      return nuevaVinculacion;
    });
  }

  // ── SELECCIONAR BARBERÍA ACTIVA (T2.3) ─────────────────────────────────────

  /**
   * Garantiza que el usuario solo tenga una barbería activa a la vez.
   * Ejecuta en una transacción atómica para desactivar previas y activar la nueva.
   *
   * E1-06 · parte 3: el vínculo ya no es solo `cliente_barberias`.
   *
   * El decorador admite a los cuatro roles y la matriz lo documenta así, pero el
   * servicio exigía una fila en `cliente_barberias` —que un BARBERO o un
   * responsable no tienen, porque entran por `usuario_roles` o por
   * `barberia.responsableId`—. Resultado: el guard le dejaba pasar y el servicio
   * le respondía 404 «No estás vinculado a esta barbería», justo el caso para el
   * que existe la ruta (`tenant.service.ts:137` la encadena tras crear sede).
   *
   * Ahora se acepta cualquiera de los tres vínculos reales: `cliente_barberias`
   * (el cliente que entró por código), `usuario_roles.barberia_id` (barbero y
   * ADMIN_BARBERIA) y `barberia.responsable_id` (el dueño). El ADMINISTRADOR
   * global no necesita vínculo: es transversal, igual que en el resto del backend.
   */
  async seleccionarBarberiaActiva(usuarioId: string, barberiaId: string, usuario?: UsuarioAutenticado) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const vinculacion = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId,
            barberiaId,
          },
        },
      });

      if (vinculacion && vinculacion.estadoVinculacion !== 'ACTIVO') {
        throw new ForbiddenException('Tu vinculación a esta barbería no está activa.');
      }

      if (!vinculacion) {
        // Sin fila en `cliente_barberias` se admite el rol de la sede y el dueño,
        // pero entonces no hay nada que activar: la marca de sede activa vive en
        // `cliente_barberias`. Se devuelve la sede para que el frontend la cachee.
        const [rolEnSede, sede, esGlobal] = await Promise.all([
          tx.usuarioRol.findFirst({ where: { usuarioId, barberiaId }, select: { id: true } }),
          tx.barberia.findUnique({ where: { id: barberiaId }, select: { id: true, responsableId: true } }),
          usuario ? Promise.resolve(esAdministradorGlobal(usuario)) : esAdministradorGlobalPorId(tx, usuarioId),
        ]);

        if (!sede) {
          throw new NotFoundException('Barbería no encontrada.');
        }

        if (!rolEnSede && !esGlobal && sede.responsableId !== usuarioId) {
          throw new NotFoundException('No estás vinculado a esta barbería.');
        }

        this.logger.log(`Usuario ${usuarioId} seleccionó la barbería ${barberiaId} por rol`);
        return { usuarioId, barberiaId, esBarberiaActiva: true, vinculo: 'ROL' };
      }

      // Desactivar todas las barberías para este usuario
      await tx.clienteBarberia.updateMany({
        where: { usuarioId },
        data: { esBarberiaActiva: false },
      });

      // Activar la seleccionada
      const activa = await tx.clienteBarberia.update({
        where: {
          uk_cliente_barberia: {
            usuarioId,
            barberiaId,
          },
        },
        data: { esBarberiaActiva: true },
      });

      this.logger.log(`Usuario ${usuarioId} activó la barbería ${barberiaId}`);
      return activa;
    });
  }

  // ── E3-12 · vinculación, sexta aprobación y desvinculación ────────────────

  /**
   * E3-12 (§1.2) · la 6ª vinculación del cliente queda `PENDIENTE_APROBACION`
   * (D10) y solo la resuelve el ADMINISTRADOR global.
   *
   * Se lista el vínculo junto con el cliente y la sede para que el panel de
   * plataforma no necesite tres consultas.
   */
  async listarVinculacionesPendientes() {
    return this.prisma.clienteBarberia.findMany({
      where: { estadoVinculacion: 'PENDIENTE_APROBACION' },
      include: {
        usuario: { select: { id: true, nombreCompleto: true, correo: true } },
        barberia: { select: { id: true, nombre: true, ubicacion: true, estado: true } },
      },
      orderBy: { creadoAt: 'asc' },
    });
  }

  /**
   * Acepta o rechaza una vinculación pendiente. Ambas resoluciones:
   *  - exigen que la fila esté `PENDIENTE_APROBACION` (409 `ESTADO_INVALIDO`);
   *  - notifican al cliente (§1.2);
   *  - auditan con `VINCULACION_APROBADA` / `VINCULACION_RECHAZADA` (D28).
   *
   * Al aprobar pasa a `ACTIVO`; al rechazar a `DESVINCULADO`. En los dos casos
   * se conserva la fila: D20/D21 prohíben que la restricción se evade borrando.
   */
  async resolverVinculacion(
    vinculacionId: string,
    decision: 'APROBAR' | 'RECHAZAR',
    usuario: UsuarioAutenticado,
    motivo?: string,
  ) {
    const vinculacion = await this.prisma.clienteBarberia.findUnique({
      where: { id: vinculacionId },
      include: {
        usuario: { select: { id: true, nombreCompleto: true, correo: true } },
        barberia: { select: { id: true, nombre: true } },
      },
    });

    if (!vinculacion) {
      throw new NotFoundException(`Vinculación ${vinculacionId} no encontrada.`);
    }

    if (vinculacion.estadoVinculacion !== 'PENDIENTE_APROBACION') {
      throw errorDeConflicto(
        'ESTADO_INVALIDO',
        `La vinculación está en ${vinculacion.estadoVinculacion}: solo se resuelve una pendiente de aprobación.`,
      );
    }

    const esAprobada = decision === 'APROBAR';
    const estadoNuevo = esAprobada ? 'ACTIVO' : 'DESVINCULADO';

    const actualizada = await this.prisma.clienteBarberia.update({
      where: { id: vinculacion.id },
      data: { estadoVinculacion: estadoNuevo },
    });

    await this.auditar({
      usuarioId: usuario.id,
      accion: esAprobada ? 'VINCULACION_APROBADA' : 'VINCULACION_RECHAZADA',
      entidad: 'cliente_barberias',
      entidadId: vinculacion.id,
      contexto: {
        barberiaId: vinculacion.barberiaId,
        clienteId: vinculacion.usuarioId,
        estadoAnterior: 'PENDIENTE_APROBACION',
        estadoNuevo,
        ...(motivo ? { motivo } : {}),
      },
    });

    if (this.notificacionService) {
      const sede = vinculacion.barberia.nombre;
      const contenido = esAprobada
        ? `Tu vinculación con "${sede}" fue aprobada. Ya puedes reservar en esa sede.`
        : `Tu vinculación con "${sede}" fue rechazada${motivo ? `: ${motivo}` : '.'}`;

      this.notificacionService
        .enviarNotificacion({
          usuarioId: vinculacion.usuarioId,
          tipo: esAprobada ? 'VINCULACION_APROBADA' : 'VINCULACION_RECHAZADA',
          contenido,
        })
        .catch((err) =>
          this.logger.warn(`No se pudo despachar notificación de vinculación: ${err.message}`),
        );
    }

    this.logger.log(
      `Vinculación ${vinculacion.id} ${estadoNuevo} por ${usuario.id}${motivo ? ` (${motivo})` : ''}`,
    );

    return actualizada;
  }

  /**
   * E3-12 (§1.2) · datos públicos de la sede a partir de su enlace único.
   *
   * Es lo que el frontend necesita para resolver el QR. Devuelve la lectura
   * PÚBLICA: `toLectura` omite `codigoAcceso` y `enlaceUnico`, así que escanear
   * el QR no descubre la puerta de entrada a la sede.
   */
  async buscarPorEnlace(enlace: string): Promise<BarberiaLecturaDto> {
    const barberia = await this.prisma.barberia.findUnique({
      where: { enlaceUnico: enlace },
    });

    if (!barberia || barberia.estado !== 'ACTIVO') {
      throw new NotFoundException('Barbería no encontrada para ese enlace.');
    }

    return this.toLectura(barberia);
  }

  /**
   * E3-12 (§7.5) · el CLIENTE deja su vínculo sin perder el historial.
   *
   * Escribes `DESVINCULADO` y `es_barberia_activa = false` sobre la MISMA fila:
   * no se borra nada, así que `contador_no_presentado`, `esta_restringido` y
   * `motivo_restriccion` sobreviven (D20) y revincular los reutiliza (D21).
   *
   * Bloqueo (422 `RESERVAS_FUTURAS`): mientras queden reservas `PENDIENTE`,
   * `PROPUESTA_PENDIENTE` o `CONFIRMADA`, la sede seguiría con un hueco ocupado
   * por alguien que ya no es cliente.
   */
  async desvincular(usuarioId: string, barberiaId: string) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const [vinculacion, barberia] = await Promise.all([
        tx.clienteBarberia.findUnique({
          where: { uk_cliente_barberia: { usuarioId, barberiaId } },
        }),
        tx.barberia.findUnique({ where: { id: barberiaId } }),
      ]);

      if (!barberia) {
        throw new NotFoundException('Barbería no encontrada.');
      }
      if (!vinculacion) {
        throw new NotFoundException('No tienes vínculo con esta barbería.');
      }
      if (vinculacion.estadoVinculacion === 'DESVINCULADO') {
        throw errorDeConflicto(
          'YA_DESVINCULADO',
          'Tu vínculo con esta barbería ya estaba desvinculado.',
        );
      }

      // "Futuras" se decide en la zona de la sede (E2-04): una reserva de hoy
      // sigue ocupando agenda hasta que termine el día local.
      const fechaHoy = this.tiempo.fechaLocal(
        this.tiempo.ahora(),
        barberia.zonaHoraria || ZONA_POR_DEFECTO,
      );
      const futuras = await tx.reserva.count({
        where: {
          clienteId: usuarioId,
          barberiaId,
          estado: { in: [...ESTADOS_QUE_BLOQUEAN_DESVINCULAR] },
          fechaCita: { gte: this.tiempo.fechaDeCalendario(fechaHoy) },
        },
      });

      if (futuras > 0) {
        throw reglaDeNegocio(
          'RESERVAS_FUTURAS',
          `Tienes ${futuras} reserva(s) futura(s) en esta sede. Cancelalas antes de desvincularte.`,
        );
      }

      const actualizada = await tx.clienteBarberia.update({
        where: { id: vinculacion.id },
        data: { estadoVinculacion: 'DESVINCULADO', esBarberiaActiva: false },
      });

      await this.auditar(
        {
          usuarioId,
          accion: 'VINCULACION_DESVINCULADA',
          entidad: 'cliente_barberias',
          entidadId: vinculacion.id,
          contexto: {
            barberiaId,
            estadoAnterior: vinculacion.estadoVinculacion,
            estadoNuevo: 'DESVINCULADO',
            contadorNoPresentado: vinculacion.contadorNoPresentado,
            estaRestringido: vinculacion.estaRestringido,
          },
        },
        tx,
      );

      this.logger.log(`Usuario ${usuarioId} se desvinculó de la barbería ${barberiaId}`);
      return actualizada;
    });
  }
}
