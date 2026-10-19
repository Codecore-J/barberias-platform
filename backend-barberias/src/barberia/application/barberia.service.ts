import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
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
import { plainToInstance } from 'class-transformer';
import * as bcrypt from 'bcrypt';
import { reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { BarberiaResponseDto as BarberiaResponse } from './dto/barberia-response.dto.js';
import type { BarberiaLecturaDto } from './dto/barberia-lectura.dto.js';
import { BarberiaLecturaDto as BarberiaLectura } from './dto/barberia-lectura.dto.js';
import type { UnirseBarberiaDto } from './dto/unirse-barberia.dto.js';
import type { InvitacionSedeDto } from './dto/invitacion-sede.dto.js';
import { InvitacionSedeDto as InvitacionSede } from './dto/invitacion-sede.dto.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  ROL_ADMINISTRADOR,
  ROL_ADMIN_BARBERIA,
  alcanceCumple,
  esAdministradorGlobal,
  esAdministradorGlobalPorId,
  validarAsignacionRol,
} from '../../iam/domain/roles.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
// E3-12: el estado de la 6.ª vinculación y su límite viven en el dominio de la
// vinculación, compartidos con el flujo que las resuelve (VinculacionService).
import { ESTADOS_VINCULACION, LIMITE_VINCULACIONES } from '../domain/vinculacion.js';

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

/**
 * E1-07 · D04: un responsable puede tener como máximo dos sedes ACTIVAS. Las
 * inactivas no cuentan: suspender una sede devuelve el cupo sin borrar nada.
 */
export const MAX_BARBERIAS_POR_RESPONSABLE = 2;

/**
 * E3-12/2 · la invitación tal y como llega por el cuerpo: las dos puertas son
 * opcionales por separado, pero el cliente tiene que traer EXACTAMENTE una. El
 * tipo es estructural —y no la unión de los dos DTO— para que el acceso a
 * `enlaceUnico` no dependa de qué DTO concreto envió la petición.
 */
type PuertaDeEntradaSolicitada = { codigoAcceso?: string; enlaceUnico?: string };

@Injectable()
export class BarberiaService {
  private readonly logger = new Logger(BarberiaService.name);

  constructor(
    private readonly prisma: PrismaService,
    // P-SD-4: suspender o reactivar una sede deja rastro DURABLE en la tabla
    // de auditoría, no solo un `logger.log`. Dependencia requerida (no
    // `@Optional`): el módulo ya importa `AuditoriaModule` y un cambio de estado
    // sin rastro no puede degradarse en silencio.
    private readonly auditoria: AuditoriaService,
    // H71: reabrir una vinculación cerrada avisa a la plataforma. `@Optional`
    // a propósito: el aviso es best-effort y su ausencia (una cola caída, un
    // test unitario que no lo necesita) no puede impedir que el cliente vuelva
    // a pedir paso.
    @Optional() private readonly notificacion?: NotificacionService,
  ) {}

  // ── Helpers de mapeo ───────────────────────────────────────────────────────

  /** Mismo payload que `toResponse` sin `codigoAcceso` ni `enlaceUnico`. */
  private toLectura(barberia: any): BarberiaLecturaDto {
    return plainToInstance(BarberiaLectura, {
      id: barberia.id,
      nombre: barberia.nombre,
      descripcion: barberia.descripcion ?? null,
      telefono: barberia.telefono,
      ubicacion: barberia.ubicacion,
      logoUrl: barberia.logoUrl ?? null,
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
      logoUrl: barberia.logoUrl ?? null,
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
   *  - Se asigna automáticamente rol ADMIN_BARBERIA en usuario_roles (salvo
   *    para el ADMINISTRADOR global, que ya es transversal).
   *  - Se crea la ConfiguracionBarberia por defecto.
   */
  async create(
    responsableId: string,
    dto: CreateBarberiaDto,
  ): Promise<BarberiaResponseDto> {
    return withSerializableTransaction(this.prisma, async (tx) => {
      // 1. El responsable tiene que existir antes de contar o escribir nada.
      const responsable = await tx.usuario.findUnique({
        where: { id: responsableId },
        select: { id: true },
      });
      if (!responsable) {
        throw new NotFoundException(`Usuario ${responsableId} no encontrado.`);
      }

      // 2. E1-07 · D04: límite de DOS sedes ACTIVAS por responsable. El conteo
      //    vive dentro de la transacción SERIALIZABLE: dos altas simultáneas
      //    del mismo usuario no pueden saltarse el cupo. Las sedes INACTIVAS no
      //    cuentan, de modo que suspender una devuelve el cupo (D04).
      const barberiasActivas = await tx.barberia.count({
        where: { responsableId, estado: 'ACTIVO' },
      });

      if (barberiasActivas >= MAX_BARBERIAS_POR_RESPONSABLE) {
        throw reglaDeNegocio(
          'LIMITE_BARBERIAS',
          `Alcanzaste el límite máximo de ${MAX_BARBERIAS_POR_RESPONSABLE} sedes activas por responsable.`,
          { limite: MAX_BARBERIAS_POR_RESPONSABLE, activas: barberiasActivas },
        );
      }

      // 3. E0-07: el rol ADMIN_BARBERIA es requisito de la operación, no un
      //    adorno. Antes se buscaba después de crear la sede y, si faltaba, el
      //    `if (rolAdmin)` la dejaba creada SIN responsable operativo. Ahora se
      //    comprueba antes de escribir y se falla con un error explícito.
      //    El ADMINISTRADOR global está exento: es transversal (D05).
      const esAdministradorDePlataforma = await tx.usuarioRol.findFirst({
        where: {
          usuarioId: responsableId,
          rol: { nombre: ROL_ADMINISTRADOR },
        },
        select: { id: true },
      });

      let rolAdminBarberia: { id: string; nombre: string; ambito: string } | null = null;

      if (!esAdministradorDePlataforma) {
        rolAdminBarberia = await tx.rol.findUnique({
          where: { nombre: ROL_ADMIN_BARBERIA },
          select: { id: true, nombre: true, ambito: true },
        });

        if (!rolAdminBarberia) {
          throw new InternalServerErrorException(
            'Configuración incompleta: el rol ADMIN_BARBERIA no existe. Ejecuta el seed antes de crear sedes.',
          );
        }
      }

      // 4. Identificadores generados en el servidor.
      const baseSlug = generateSlug(dto.nombre);
      const suffix = Date.now().toString(36).slice(-4);
      const enlaceUnico = `${baseSlug}-${suffix}`;
      const codigoAcceso = generateCodigoAcceso();

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

      // 5. E0-07: el responsable recibe su rol EN ESTA sede. Un rol de ámbito
      //    BARBERIA siempre lleva `barberiaId` (E1-04). El ADMINISTRADOR global
      //    no necesita la fila: `RolesGuard` ya lo deja pasar (D05).
      if (!esAdministradorDePlataforma && rolAdminBarberia) {
        validarAsignacionRol(rolAdminBarberia, barberia.id);
        await tx.usuarioRol.upsert({
          where: {
            uk_usuario_rol_barberia: {
              usuarioId: responsableId,
              rolId: rolAdminBarberia.id,
              barberiaId: barberia.id,
            },
          },
          create: {
            usuarioId: responsableId,
            rolId: rolAdminBarberia.id,
            barberiaId: barberia.id,
          },
          update: {},
        });
      }

      // 6. Configuración por defecto.
      await tx.configuracionBarberia.create({
        data: { barberiaId: barberia.id },
      });

      // 7. E1-07: auditoría en la MISMA transacción. `barberiaId` va en la
      //    columna propia (no solo en el JSON) para que la consulta por sede
      //    use el índice y no dependa de que cada llamador recuerde la clave.
      await this.auditoria.registrarEvento(
        {
          usuarioId: responsableId,
          accion: 'BARBERIA_CREADA',
          entidad: 'barberias',
          entidadId: barberia.id,
          barberiaId: barberia.id,
          contexto: {
            nombre: barberia.nombre,
            estado: barberia.estado,
          },
        },
        tx,
      );

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
      // H61 (Ola 3): SIN `orderBy` el listado salía en el orden FÍSICO de las
      // filas, así que el mismo endpoint devolvía el personal en distinto orden
      // entre corridas y la prueba que mira `body[0]` fallaba según qué filas
      // hubieran ocupado antes esos huecos de página. Orden estable y con
      // sentido: primero el ADMIN_BARBERIA de la sede (los nombres de rol van en
      // orden alfabético) y, dentro del mismo rol, por correo.
      orderBy: [{ rol: { nombre: 'asc' } }, { usuario: { correo: 'asc' } }],
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
    const tieneRol = (nombre: string) =>
      usuario.rolesDetallados?.some((r) => r.nombre === nombre) ||
      usuario.roles?.includes(nombre);

    const esStaff = tieneRol('ADMINISTRADOR') || tieneRol('ADMIN_BARBERIA') || tieneRol('BARBERO');

    if (!esStaff && tieneRol('CLIENTE')) {
      const vinculaciones = await this.prisma.clienteBarberia.findMany({
        where: {
          usuarioId: usuario.id,
          estadoVinculacion: 'ACTIVO',
          barberia: { estado: 'ACTIVO' },
        },
        include: {
          barberia: true,
        },
        orderBy: { barberia: { nombre: 'asc' } },
      });
      const results = vinculaciones
        .map((v) => v.barberia)
        .filter((b) => !!b)
        .map((b) => this.veCodigoDe(b.id, usuario) ? this.toResponse(b) : this.toLectura(b));
      return results;
    }

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

  // ── INVITACIÓN DE LA SEDE (E3-12/2 · regla 1.10) ───────────────────────────

  /**
   * Devuelve la puerta de entrada de UNA sede: su código y su enlace único.
   *
   * El decorador de la ruta (`@Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')`) no
   * basta y esa es la razón de que esto sea un método y no un `findOne`: la ruta
   * usa `:id`, así que el `RolesGuard` NO resuelve la sede del parámetro y un
   * ADMIN_BARBERIA de la sede B pasaría el guard preguntando por la A. La
   * pertenencia la exige aquí la MISMA regla que entrega el código en la lectura
   * por id (`veCodigoDe`, E1-05/E1-07): el ADMIN_BARBERIA de ESA sede y el
   * ADMINISTRADOR global.
   *
   * Antes de E3-12/2 esto era un `findOne`, que no fallaba: devolvía la LECTURA
   * abierta de la sede ajena —200 con datos de contacto y sin código—, así que un
   * admin recibía 200 sobre una sede que no es suya. Un 200 es una respuesta
   * legible como «es tuya»; por eso aquí el rechazo es explícito.
   */
  async obtenerInvitacion(
    id: string,
    usuario: UsuarioAutenticado,
  ): Promise<InvitacionSedeDto> {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id },
      select: { id: true, nombre: true, codigoAcceso: true, enlaceUnico: true },
    });

    if (!barberia) {
      throw new NotFoundException(`Barbería ${id} no encontrada.`);
    }

    if (!this.veCodigoDe(id, usuario)) {
      throw new ForbiddenException(
        'Solo el ADMIN_BARBERIA de esa barbería (o el ADMINISTRADOR global) puede ver su invitación.',
      );
    }

    return plainToInstance(InvitacionSede, {
      barberiaId: barberia.id,
      nombre: barberia.nombre,
      codigoAcceso: barberia.codigoAcceso,
      enlaceUnico: barberia.enlaceUnico,
    });
  }

  // ── ACTUALIZAR ─────────────────────────────────────────────────────────────

  /**
   * Solo el responsable o el ADMINISTRADOR global puede actualizar.
   * Comprobación de pertenencia: authUserId === barberia.responsableId
   *
   * E3-13 · D26/D27: la edición directa ya no lo puede todo. Solo
   * `descripcion`, `ubicacion`, `logoUrl` y `telefono`; el nombre y el estado se
   * rechazan con 422 porque tienen su propio camino (solicitud aprobada y
   * soft-delete). Cambiar el teléfono exige la contraseña actual.
   */
  async update(
    id: string,
    authUserId: string,
    dto: UpdateBarberiaDto,
    esGlobal = false,
  ): Promise<BarberiaResponseDto> {
    if (dto.nombre !== undefined) {
      throw reglaDeNegocio(
        'NOMBRE_REQUIERE_SOLICITUD',
        'El nombre de la barbería solo cambia mediante una solicitud aprobada por la administración.',
      );
    }

    if (dto.estado !== undefined) {
      throw reglaDeNegocio(
        'ESTADO_NO_EDITABLE',
        'El estado de la barbería no se edita aquí: usa PATCH /barberias/:id/estado para suspenderla o reactivarla.',
      );
    }

    const barberia = await this.prisma.barberia.findUnique({ where: { id } });
    if (!barberia) {
      throw new NotFoundException(`Barbería ${id} no encontrada.`);
    }

    if (!esGlobal && barberia.responsableId !== authUserId) {
      throw new ForbiddenException('Solo el responsable puede modificar esta barbería.');
    }

    if (dto.telefono !== undefined && dto.telefono !== barberia.telefono) {
      await this.verificarPasswordActual(authUserId, dto.passwordActual);
    }

    const updated = await this.prisma.barberia.update({
      where: { id },
      data: {
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.telefono !== undefined && { telefono: dto.telefono }),
        ...(dto.ubicacion !== undefined && { ubicacion: dto.ubicacion }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
      },
    });

    return this.toResponse(updated);
  }

  /**
   * D27 · el teléfono es un dato de contacto: cambiarlo exige la contraseña
   * actual del solicitante. La comparación es la misma que en el login
   * (`bcrypt.compare`, timing-safe) y nunca se registra el valor.
   */
  private async verificarPasswordActual(
    usuarioId: string,
    passwordActual?: string,
  ): Promise<void> {
    if (!passwordActual) {
      throw reglaDeNegocio(
        'PASSWORD_REQUERIDA',
        'Cambiar el teléfono exige tu contraseña actual (D27).',
      );
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { passwordHash: true },
    });

    const valida = !!usuario && (await bcrypt.compare(passwordActual, usuario.passwordHash));

    if (!valida) {
      throw reglaDeNegocio('PASSWORD_INCORRECTA', 'La contraseña actual no es correcta.');
    }
  }

  // ── CAMBIAR ESTADO (E2-07: suspender y reactivar, no «eliminar») ───────────

  /**
   * E2-07 · suspender (`INACTIVO`) y reactivar (`ACTIVO`) son la MISMA operación
   * con dos valores, así que comparten ruta y reglas.
   *
   * Antes `DELETE /barberias/:id` solo sabía desactivar —y con un verbo que dice
   * «eliminar» aunque el efecto sea «suspender»—, así que volver a activar una
   * sede exigía tocar la base a mano. Sigue siendo una decisión de plataforma
   * (decisión 4: el `@Roles` de la ruta solo admite ADMINISTRADOR), y el método
   * conserva su comprobación de responsable para no depender solo del guard.
   *
   * Idempotente: pedir el estado que ya tiene no escribe ni falla.
   */
  async cambiarEstado(
    id: string,
    authUserId: string,
    estado: 'ACTIVO' | 'INACTIVO',
    esGlobal = false,
  ): Promise<void> {
    const barberia = await this.prisma.barberia.findUnique({ where: { id } });
    if (!barberia) {
      throw new NotFoundException(`Barbería ${id} no encontrada.`);
    }

    if (!esGlobal && barberia.responsableId !== authUserId) {
      throw new ForbiddenException('Solo el responsable puede cambiar el estado de esta barbería.');
    }

    if (barberia.estado === estado) {
      return;
    }

    // P-SD-4: el cambio y su rastro salen juntos (misma transacción): no puede
    // quedar la sede suspendida sin el evento ni el evento sin la suspensión.
    // El contexto guarda anterior/nuevo, que es lo que la auditoría de una
    // suspensión tiene que poder responder un mes después.
    await this.prisma.$transaction(async (tx) => {
      await tx.barberia.update({
        where: { id },
        data: { estado },
      });

      await this.auditoria.registrarEvento(
        {
          usuarioId: authUserId,
          accion: estado === 'INACTIVO' ? 'BARBERIA_SUSPENDIDA' : 'BARBERIA_REACTIVADA',
          entidad: 'barberias',
          entidadId: id,
          contexto: {
            anterior: { estado: barberia.estado },
            nuevo: { estado },
          },
        },
        tx,
      );
    });

    this.logger.log(`Barbería ${id} pasó a ${estado} por usuario ${authUserId}`);
  }

  // ── VINCULAR CLIENTE A BARBERÍA (T2.2) ─────────────────────────────────────

  /**
   * Vincula a un usuario a una barbería utilizando su código de acceso.
   * Si el usuario ya tiene 5 o más vinculaciones, la nueva queda PENDIENTE.
   * Utiliza SERIALIZABLE para evitar condición de carrera en el conteo.
   *
   * H71 · D21: un vínculo `DESVINCULADO` NO se devuelve muerto. Hasta E3-12 ese
   * estado no lo escribía nadie, así que devolver la fila tal cual era inocuo;
   * desde que el rechazo de la 6.ª vinculación lo escribe, devolverla sin más
   * dejaba al cliente condenado de por vida, porque la única fila posible del
   * par (usuario, sede) ya existía y el `uk_cliente_barberia` impide crear otra.
   * Ahora la fila se REABRE: vuelve a la circulación y, si el cliente sigue por
   * encima del límite de D10, otra vez a la bandeja de la plataforma.
   *
   * E3-12/3: ese MISMO estado es el que libera el cupo. Al cerrar un vínculo el
   * cliente recupera la plaza (el conteo de abajo solo mira los vivos), así que
   * quien se desvincula de una sede no queda condenado a la bandeja de
   * aprobación para la siguiente.
   */
  async vincularCliente(usuarioId: string, dto: VincularBarberiaDto | UnirseBarberiaDto) {
    // E3-12/2: la sede se resuelve por la puerta que trajo el cliente —código o
    // enlace único—, pero TODO lo demás (el conteo de D10, la reapertura de H71,
    // la auditoría y el estado resultante) es exactamente el mismo camino que ya
    // estaba blindado. Resolver la puerta es lo único que cambia.
    const puerta = this.resolverPuertaDeEntrada(dto);

    // H71: la transacción devuelve la fila Y, si tocó reabrir, lo que hay que
    // avisar. El aviso se despacha DESPUÉS del commit y fuera de la transacción.
    const { vinculo, reapertura } = await withSerializableTransaction(this.prisma, async (tx) => {
      const barberia = await tx.barberia.findUnique({
        where: puerta,
      });

      if (!barberia || barberia.estado !== 'ACTIVO') {
        throw new NotFoundException('Barbería no encontrada o inactiva.');
      }

      const existing = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId,
            barberiaId: barberia.id,
          },
        },
      });

      // Idempotencia: un vínculo VIVO se devuelve tal cual. Volver a introducir
      // el código no cambia nada ni pide aprobación otra vez. Solo la fila
      // CERRADA se reabre.
      if (existing && existing.estadoVinculacion !== ESTADOS_VINCULACION.DESVINCULADO) {
        return { vinculo: existing, reapertura: null };
      }

      // Conteo estricto (T2.2) sobre los vínculos VIVOS. D10 limita las
      // barberías en las que el cliente ESTÁ, no las filas que alguna vez tuvo:
      // un `DESVINCULADO` conserva su historial (D20/D21) pero no ocupa plaza,
      // así que al cerrar un vínculo el cliente recupera el cupo. Ese único
      // filtro cubre también la fila que se está reabriendo —en la base todavía
      // está `DESVINCULADO`, y no se cuenta a sí misma—, y por eso la exclusión
      // explicita por `id` ya no hace falta.
      const count = await tx.clienteBarberia.count({
        where: {
          usuarioId,
          estadoVinculacion: { not: ESTADOS_VINCULACION.DESVINCULADO },
        },
      });

      // D10 · la 6.ª vinculación queda PENDIENTE_APROBACION hasta que el
      // ADMINISTRADOR la apruebe. El estado y el límite NO son literales de
      // aquí: los comparte con el flujo que la resuelve (E3-12), que es el
      // único que puede sacar a un cliente de esta espera.
      const estadoVinculacion =
        count >= LIMITE_VINCULACIONES
          ? ESTADOS_VINCULACION.PENDIENTE_APROBACION
          : ESTADOS_VINCULACION.ACTIVO;

      // H71 · D21: la fila cerrada se REABRE con el estado que le toca hoy
      // —pendiente si el cliente sigue por encima del límite, activa si ya
      // tiene hueco— y deja rastro del antes y el después (D28).
      if (existing) {
        const reactivada = await tx.clienteBarberia.update({
          where: { id: existing.id },
          data: { estadoVinculacion },
        });

        await this.auditoria.registrarEvento(
          {
            usuarioId,
            accion: 'VINCULACION_REACTIVADA',
            entidad: 'cliente_barberias',
            entidadId: existing.id,
            contexto: {
              barberiaId: barberia.id,
              anterior: { estadoVinculacion: existing.estadoVinculacion },
              nuevo: { estadoVinculacion },
            },
          },
          tx,
        );

        this.logger.log(
          `Vinculación ${existing.id} de ${usuarioId} con la barbería ${barberia.id} reabierta como ${estadoVinculacion}`,
        );
        return {
          vinculo: reactivada,
          reapertura: { nombreBarberia: barberia.nombre, estadoVinculacion },
        };
      }

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
      return { vinculo: nuevaVinculacion, reapertura: null };
    });

    // Solo hay algo que avisar cuando la reapertura devuelve trabajo a la
    // plataforma: si la fila volvió ACTIVA no hay nada que aprobar.
    if (reapertura && reapertura.estadoVinculacion === ESTADOS_VINCULACION.PENDIENTE_APROBACION) {
      this.avisarReaperturaPendiente(reapertura.nombreBarberia);
    }

    return vinculo;
  }

  /**
   * E3-12/2 · traduce la invitación que llegó por el cuerpo a la clave con la que
   * se BUSCA la sede, y rechaza las dos formas en que una puerta puede estar mal
   * pedida. Se ejecuta ANTES de abrir la transacción: un cuerpo inválido no tiene
   * por qué llegar a la base (ni ocupar una conexión serializable).
   *
   * El enlace se normaliza (`trim` + minúsculas) porque viaja IMPRESO: quien lo
   * escanea o lo pega suele arrastrar espacios y el diccionario del QR es
   * indiferente a las mayúsculas, mientras que `enlace_unico` se guarda siempre
   * en minúsculas (`create` lo compone con `generateSlug`). El código de acceso,
   * en cambio, solo se recorta: su alfabeto es de mayúsculas y quien lo teclea lo
   * hace en un campo que ya las fuerza (la pantalla del modal), así que reescribir
   * aquí lo que el usuario escribió solo escondería un código mal copiado.
   */
  private resolverPuertaDeEntrada(
    dto: PuertaDeEntradaSolicitada,
  ): { codigoAcceso: string } | { enlaceUnico: string } {
    const codigoAcceso = dto.codigoAcceso?.trim();
    const enlaceUnico = dto.enlaceUnico?.trim().toLowerCase();

    if (codigoAcceso && enlaceUnico) {
      throw reglaDeNegocio(
        'INVITACION_AMBIGUA',
        'Envía SOLO el código de acceso o SOLO el enlace de invitación de la sede, no los dos.',
      );
    }

    if (!codigoAcceso && !enlaceUnico) {
      throw reglaDeNegocio(
        'INVITACION_REQUERIDA',
        'Falta la puerta de entrada: envía el código de acceso o el enlace de invitación de la sede.',
      );
    }

    return codigoAcceso ? { codigoAcceso } : { enlaceUnico: enlaceUnico as string };
  }

  /**
   * H71 · avisa a la plataforma de que una vinculación cerrada volvió a pedir
   * paso, para que la bandeja de E3-12 no sea la única forma de enterarse.
   *
   * Best-effort y en segundo plano (H62): resolver la búsqueda de administradores
   * o encolar el aviso no puede hacer esperar al cliente que acaba de introducir
   * su código, y una cola caída tampoco puede dejar sin reabrir una vinculación
   * que en la base ya está reabierta. Todos los fallos se registran, ninguno sube.
   */
  private avisarReaperturaPendiente(nombreBarberia: string): void {
    void this.notificarReaperturaPendiente(nombreBarberia).catch(() => undefined);
  }

  private async notificarReaperturaPendiente(nombreBarberia: string): Promise<void> {
    if (!this.notificacion) {
      return;
    }

    try {
      const admins = await this.prisma.usuarioRol.findMany({
        where: { rol: { nombre: ROL_ADMINISTRADOR } },
        select: { usuarioId: true },
        distinct: ['usuarioId'],
      });

      for (const admin of admins) {
        this.notificacion
          .enviarNotificacion({
            usuarioId: admin.usuarioId,
            tipo: 'VINCULACION_PENDIENTE_APROBACION',
            contenido: `Una vinculación cerrada volvió a quedar pendiente de aprobación (${nombreBarberia}). Revísala en la bandeja de vinculaciones.`,
          })
          .catch((error: Error) =>
            this.logger.warn(
              `No se pudo despachar el aviso de vinculación reabierta a ${admin.usuarioId}: ${error.message}`,
            ),
          );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron resolver los ADMINISTRADOR para avisar de la vinculación reabierta: ${(error as Error).message}`,
      );
    }
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
}
