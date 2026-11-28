import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { tablaCalificada } from '../../shared/db/esquema.js';
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

    // F8 · rendimiento: UNA consulta por petición.
    //
    // Antes este guard hacía tres consultas EN SERIE en cada petición que
    // atravesaba una ruta de sede: el estado de la barbería, `usuario_roles` y
    // —solo si no había rol— `cliente_barberias`. Es el punto más caliente del
    // backend (catálogo, agenda, horarios, analíticas), así que las tres cosas
    // viajan ahora en una sola consulta:
    //   - `estado` de la sede, para conservar el bloqueo de I-01;
    //   - `EXISTS` en `usuario_roles` con `estado = 'ACTIVO'` (personal);
    //   - `EXISTS` en `cliente_barberias` con `estado_vinculacion = 'ACTIVO'`.
    //
    // Los dos filtros ACTIVO siguen EN EL SQL: un vínculo suspendido no habilita
    // y la decisión no depende de una comprobación en memoria. Las tablas van
    // calificadas con `tablaCalificada` (H58) y los valores son parámetros, nunca
    // texto pegado al SQL. Si la consulta falla, la excepción sube: el guard
    // falla cerrado, no concede.
    const filas = await this.prisma.$queryRaw<
      Array<{ estado: string; es_personal: boolean; es_cliente: boolean }>
    >`
      SELECT b.estado AS estado,
             EXISTS (
               SELECT 1
                 FROM ${Prisma.raw(tablaCalificada('usuario_roles'))} ur
                WHERE ur.usuario_id = ${user.id}::uuid
                  AND ur.barberia_id = b.id
                  AND ur.estado = 'ACTIVO'
             ) AS es_personal,
             EXISTS (
               SELECT 1
                 FROM ${Prisma.raw(tablaCalificada('cliente_barberias'))} cb
                WHERE cb.usuario_id = ${user.id}::uuid
                  AND cb.barberia_id = b.id
                  AND cb.estado_vinculacion = 'ACTIVO'
             ) AS es_cliente
        FROM ${Prisma.raw(tablaCalificada('barberias'))} b
       WHERE b.id = ${barberiaId}::uuid
    `;

    // I-01 · la sede tiene que seguir OPERANDO, no solo existir el vínculo. Sin
    // esto, suspender una barbería (E2-07) apagaba su ficha pero su personal
    // seguía leyendo y escribiendo el catálogo: `usuario_roles` no cambia al
    // suspender la sede. Una sede suspendida no admite operaciones de nadie, ni
    // del personal ni del cliente.
    const sede = filas[0];
    if (!sede) {
      throw new ForbiddenException('La barbería indicada no existe.');
    }
    if (sede.estado !== 'ACTIVO') {
      throw new ForbiddenException(
        'La barbería está suspendida: no admite operaciones mientras permanezca inactiva.',
      );
    }

    // Personal por rol o cliente por vínculo ACTIVO: las dos puertas del E1-06.
    if (sede.es_personal || sede.es_cliente) {
      return true;
    }

    throw new ForbiddenException(
      'No estás vinculado a esta barbería: no puedes ver su catálogo.',
    );
  }
}
