import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CreateAntecedenteDto } from './dto/create-antecedente.dto.js';
import { EvaluarAntecedenteDto, DecisionAntecedente } from './dto/evaluar-antecedente.dto.js';
import { maskName, maskEmail, maskPhone } from '../domain/anonymizer.utils.js';
import { esAdministradorGlobalPorId } from '../../iam/domain/roles.js';

@Injectable()
export class AntecedenteService {
  private readonly logger = new Logger(AntecedenteService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valida que el usuario tenga acceso como Barbero o Administrador en la barbería.
   */
  private async validateBarberoOrAdminAccess(usuarioId: string, barberiaId: string) {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { responsableId: true },
    });

    if (!barberia) {
      throw new NotFoundException('Barbería no encontrada');
    }

    if (barberia.responsableId === usuarioId) {
      return { isResponsable: true, isAdmin: true };
    }

    // E1-04 (D05): el rol global es ADMINISTRADOR.
    if (await esAdministradorGlobalPorId(this.prisma, usuarioId)) {
      return { isResponsable: false, isAdmin: true };
    }

    const rolesUser = (await this.prisma.usuarioRol.findMany({
      where: { usuarioId, barberiaId },
      include: { rol: true },
    })) ?? [];

    const isAdmin = rolesUser.some((ur) => ur.rol?.nombre === 'ADMIN_BARBERIA');
    const isBarbero = rolesUser.some((ur) => ur.rol?.nombre === 'BARBERO');

    if (!isAdmin && !isBarbero) {
      throw new ForbiddenException(
        'No tienes permisos para registrar o consultar antecedentes en esta barbería',
      );
    }

    return { isResponsable: false, isAdmin };
  }

  /**
   * Valida que el usuario tenga exclusivamente rol administrativo o sea dueño de la barbería.
   */
  private async validateAdminAccess(usuarioId: string, barberiaId: string) {
    const { isAdmin } = await this.validateBarberoOrAdminAccess(usuarioId, barberiaId);
    if (!isAdmin) {
      throw new ForbiddenException(
        'Solo los administradores o el responsable de la barbería pueden evaluar antecedentes',
      );
    }
  }

  /**
   * Registra una observación/antecedente técnico o conductual sobre un cliente.
   * Regla T7.1: Estado inicial = PENDIENTE para revisión de administración.
   */
  async crear(usuarioId: string, barberiaId: string, dto: CreateAntecedenteDto) {
    const { isAdmin } = await this.validateBarberoOrAdminAccess(usuarioId, barberiaId);

    // Validar que el cliente exista
    const cliente = await this.prisma.usuario.findUnique({
      where: { id: dto.usuarioId },
      select: { id: true, nombreCompleto: true },
    });

    if (!cliente) {
      throw new NotFoundException(`El cliente con ID ${dto.usuarioId} no fue encontrado`);
    }

    const antecedente = await this.prisma.antecedente.create({
      data: {
        usuarioId: dto.usuarioId,
        barberiaOrigenId: barberiaId,
        categoria: dto.categoria,
        contenido: dto.contenido,
        origen: isAdmin ? 'ADMIN' : 'BARBERO',
        estadoValidacion: 'PENDIENTE',
        compartido: dto.compartido ?? false,
      },
    });

    this.logger.log(
      `Antecedente ${antecedente.id} creado en barbería ${barberiaId} para el cliente ${dto.usuarioId} por usuario ${usuarioId}`,
    );

    return antecedente;
  }

  /**
   * Flujo de Aprobación/Rechazo de Antecedentes (T7.1).
   * PENDIENTE -> APROBADO | RECHAZADO (con motivo obligatorio).
   */
  async evaluar(
    usuarioId: string,
    barberiaId: string,
    antecedenteId: string,
    dto: EvaluarAntecedenteDto,
  ) {
    await this.validateAdminAccess(usuarioId, barberiaId);

    const antecedente = await this.prisma.antecedente.findFirst({
      where: {
        id: antecedenteId,
        barberiaOrigenId: barberiaId,
      },
    });

    if (!antecedente) {
      throw new NotFoundException(
        `Antecedente con ID ${antecedenteId} no encontrado en esta barbería`,
      );
    }

    if (antecedente.estadoValidacion !== 'PENDIENTE') {
      throw new BadRequestException(
        `El antecedente ya fue evaluado previamente con estado ${antecedente.estadoValidacion}`,
      );
    }

    const actualizado = await this.prisma.antecedente.update({
      where: { id: antecedente.id },
      data: {
        estadoValidacion: dto.decision,
        motivoRechazo:
          dto.decision === DecisionAntecedente.RECHAZADO ? dto.motivoRechazo : null,
      },
    });

    this.logger.log(
      `Antecedente ${antecedente.id} evaluado a ${dto.decision} por admin ${usuarioId}`,
    );

    return actualizado;
  }

  /**
   * Lista los antecedentes pendientes de validación en la barbería.
   */
  async listarPendientes(usuarioId: string, barberiaId: string) {
    await this.validateAdminAccess(usuarioId, barberiaId);

    return this.prisma.antecedente.findMany({
      where: {
        barberiaOrigenId: barberiaId,
        estadoValidacion: 'PENDIENTE',
      },
      include: {
        usuario: {
          select: {
            id: true,
            nombreCompleto: true,
            correo: true,
          },
        },
      },
      orderBy: { creadoAt: 'desc' },
    });
  }

  /**
   * Lista los antecedentes registrados de un cliente.
   * Regla T7.2 (Anonimización estricta inter-barberías):
   * - Registros propios: Acceso completo con datos personales sin enmascarar.
   * - Registros de otras barberías: Solo si compartido === true y estadoValidacion === 'APROBADO'.
   *   Los datos personales (nombre, correo, teléfono) se enmascaran de forma irreversible.
   */
  async listarPorCliente(usuarioId: string, barberiaId: string, clienteId: string) {
    await this.validateBarberoOrAdminAccess(usuarioId, barberiaId);

    const antecedentes = await this.prisma.antecedente.findMany({
      where: {
        usuarioId: clienteId,
        OR: [
          // 1. Propios de esta barbería
          { barberiaOrigenId: barberiaId },
          // 2. De otras barberías (solo compartidos y aprobados)
          {
            barberiaOrigenId: { not: barberiaId },
            compartido: true,
            estadoValidacion: 'APROBADO',
          },
        ],
      },
      include: {
        usuario: {
          select: {
            id: true,
            nombreCompleto: true,
            correo: true,
            telefono: true,
          },
        },
        barberiaOrigen: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { creadoAt: 'desc' },
    });

    return antecedentes.map((item) => {
      const esPropio = item.barberiaOrigenId === barberiaId;

      return {
        id: item.id,
        usuarioId: item.usuarioId,
        barberiaOrigenId: esPropio ? item.barberiaOrigenId : null,
        origenBarberia: esPropio ? ('PROPIA' as const) : ('EXTERNA' as const),
        nombreBarberiaOrigen: esPropio
          ? item.barberiaOrigen?.nombre
          : 'Red de Barberías (Aliada)',
        categoria: item.categoria,
        contenido: item.contenido,
        origen: item.origen,
        estadoValidacion: item.estadoValidacion,
        compartido: item.compartido,
        motivoRechazo: esPropio ? item.motivoRechazo : null,
        creadoAt: item.creadoAt,
        cliente: {
          id: item.usuario.id,
          nombreCompleto: esPropio
            ? item.usuario.nombreCompleto
            : maskName(item.usuario.nombreCompleto),
          correo: esPropio ? item.usuario.correo : maskEmail(item.usuario.correo),
          telefono: esPropio ? item.usuario.telefono : maskPhone(item.usuario.telefono),
          esAnonimizado: !esPropio,
        },
      };
    });
  }
}
