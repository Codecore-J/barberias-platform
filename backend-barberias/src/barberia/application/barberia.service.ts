import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import type { CreateBarberiaDto } from './dto/create-barberia.dto.js';
import type { UpdateBarberiaDto } from './dto/update-barberia.dto.js';
import type { BarberiaResponseDto } from './dto/barberia-response.dto.js';
import type { VincularBarberiaDto } from './dto/vincular-barberia.dto.js';
import { plainToInstance } from 'class-transformer';
import { BarberiaResponseDto as BarberiaResponse } from './dto/barberia-response.dto.js';
import type { BarberiaLecturaDto } from './dto/barberia-lectura.dto.js';
import { BarberiaLecturaDto as BarberiaLectura } from './dto/barberia-lectura.dto.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  alcanceCumple,
  esAdministradorGlobal,
  validarAsignacionRol,
} from '../../iam/domain/roles.js';

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

  constructor(private readonly prisma: PrismaService) {}

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

  async findAllByResponsable(responsableId: string): Promise<BarberiaResponseDto[]> {
    const barberias = await this.prisma.barberia.findMany({
      where: { responsableId },
      orderBy: { nombre: 'asc' },
    });
    return barberias.map((b) => this.toResponse(b));
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

    const veCodigo =
      this.esAdministrador(usuario) ||
      this.tieneAlgunRolEnBarberia(id, usuario, ['ADMIN_BARBERIA']);

    return veCodigo ? this.toResponse(barberia) : this.toLectura(barberia);
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
        // Idempotent return or throw conflict
        return existing;
      }

      // Conteo estricto (T2.2)
      const count = await tx.clienteBarberia.count({
        where: { usuarioId },
      });

      const estadoVinculacion = count >= 5 ? 'PENDIENTE' : 'ACTIVO';
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
      return nuevaVinculacion;
    });
  }

  // ── SELECCIONAR BARBERÍA ACTIVA (T2.3) ─────────────────────────────────────

  /**
   * Garantiza que el usuario solo tenga una barbería activa a la vez.
   * Ejecuta en una transacción atómica para desactivar previas y activar la nueva.
   */
  async seleccionarBarberiaActiva(usuarioId: string, barberiaId: string) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const vinculacion = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId,
            barberiaId,
          },
        },
      });

      if (!vinculacion) {
        throw new NotFoundException('No estás vinculado a esta barbería.');
      }

      if (vinculacion.estadoVinculacion !== 'ACTIVO') {
        throw new ForbiddenException('Tu vinculación a esta barbería no está activa.');
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
