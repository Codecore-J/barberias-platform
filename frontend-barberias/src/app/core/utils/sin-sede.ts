/**
 * Mensaje único para el estado "sin sede activa".
 *
 * Los servicios de dominio NO deben construir URLs con `barberiaActivaId()`
 * nulo (producía `/shops/null/...` y 400). Cuando falta la sede devuelven una
 * lista vacía o este error de producto, y la pantalla muestra el hub de sedes.
 */
export const SIN_SEDE_ACTIVA = 'Selecciona una barbería para continuar.';
