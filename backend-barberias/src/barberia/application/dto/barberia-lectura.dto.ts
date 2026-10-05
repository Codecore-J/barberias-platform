/**
 * Lectura pública de una barbería (E1-05, decisión 3).
 *
 * Es el mismo `BarberiaResponseDto` sin los dos campos que permiten entrar en
 * la barbería con un código: `codigoAcceso` y `enlaceUnico`. Los recibe el
 * ADMIN_BARBERIA de esa barbería y el ADMINISTRADOR global; el resto de usuarios
 * autenticados ven solo los datos de contacto y ubicación.
 */
export class BarberiaLecturaDto {
  id: string;
  nombre: string;
  descripcion: string | null;
  telefono: string;
  ubicacion: string;
  responsableId: string;
  estado: string;
}