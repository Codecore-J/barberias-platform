import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { esAdministradorGlobal } from '../domain/roles.js';
import { resolverBarberiaId } from './current-barberia.decorator.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';

/**
 * E1-06 · paso 5: el catálogo de una sede es PRIVADO hasta el vínculo.
 *
 * `RolesGuard` decide por ROL, y el rol no es la pertenencia: `CLIENTE` es de
 * ámbito GLOBAL con `barberia_id` nulo, así que `alcanceCumple` lo admitía
 * contra cualquier sede y un cliente autenticado leía el catálogo entero de una
 * barbería ajena con solo mandar `x-barberia-id`. Esto convertía el catálogo en
 * un directorio de sedes con precios, accesible a cualquiera con una cuenta.
 *
 * Aquí sí se exige la pertenencia real, contra las DOS tablas que la expresan:
 *  - `usuario_roles.barberia_id`: el ADMIN_BARBERIA y el BARBERO entran por rol.
 *  - `cliente_barberias`: el CLIENTE entra por su código de acceso, y la fila
 *    tiene que estar `ACTIVA`: un vínculo suspendido no habilita a leer.
 *
 * El ADMINISTRADOR global se salta la comprobación: es transversal por diseño
 * (D05) y ese bypass no se toca.
 */
@Injectable()
export class VinculoBarberiaGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: UsuarioAutenticado = request.user;

    // Sin sesión no hay nada que decidir: `JwtAuthGuard` ya lo ha denegado
    // antes, pero el guard no debe dar por hecho ese orden.
    if (!user || !user.id) {
      throw new ForbiddenException('Acceso denegado: usuario no autenticado.');
    }

    // El ADMINISTRADOR global es transversal (D05): sigue viendo todo.
    if (esAdministradorGlobal(user)) {
      return true;
    }

    // Misma cadena que el decorador `@CurrentBarberiaId` y que `RolesGuard`: si
    // no hay sede, la ruta responde 400 y no se consulta nada.
    const barberiaId = resolverBarberiaId(request);
    if (!barberiaId) {
      // Sin sede no hay catálogo que decidir sobre; la ruta contesta 400 más
      // abajo, en el decorador. Se devuelve true para no duplicar ese mensaje.
      return true;
    }

    // Personal: entra por `usuario_roles`.
    const rol = await this.prisma.usuarioRol.findFirst({
      where: { usuarioId: user.id, barberiaId },
      select: { id: true },
    });
    if (rol) {
      return true;
    }

    // Cliente: entra por `cliente_barberias` y la fila tiene que estar ACTIVA.
    const vinculo = await this.prisma.clienteBarberia.findFirst({
      where: { usuarioId: user.id, barberiaId, estadoVinculacion: 'ACTIVO' },
      select: { id: true },
    });
    if (vinculo) {
      return true;
    }

    throw new ForbiddenException(
      'No estás vinculado a esta barbería: no puedes ver su catálogo.',
    );
  }
}