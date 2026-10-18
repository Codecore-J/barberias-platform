/**
 * E3-12/2 · la invitación de una sede (regla 1.10).
 *
 * Es lo ÚNICO que un ADMIN_BARBERIA necesita para abrir su puerta de entrada:
 * el código que se dicta y el enlace único que se imprime. No es
 * `BarberiaResponseDto`: aquel arrastra datos de la sede que aquí sobran, y
 * devolverlos por una ruta pensada para compartir un enlace acaba enseñando el
 * teléfono del local en un QR.
 *
 * El enlace completo NO se compone aquí. El backend no conoce (ni debe conocer)
 * el origen desde el que se sirve el frontend; lo arma la pantalla que lo pinta,
 * que es la única que sabe en qué dominio está corriendo.
 */
export class InvitacionSedeDto {
  barberiaId: string;
  nombre: string;
  codigoAcceso: string;
  enlaceUnico: string;
}
