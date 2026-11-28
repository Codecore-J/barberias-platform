# Pendientes de la Fase 7 · 27 nov 2026 (cerrado)

## Formato dominicano en el registro público — COMPLETADO

T-75 se extendió el mismo 27 nov 2026: el contrato de identidad es ahora único
en todo el sistema.

- `RegisterDto` (`POST /auth/register`): teléfono dominicano de 10 dígitos con
  prefijo **809 / 829 / 849** (acepta `+1`, espacios y guiones, y normaliza a la
  forma local) y cédula de 11 dígitos con dígito verificador (los guiones se
  descartan al guardar).
- `UpdateContactDto` (corrección de contacto de la cuenta pendiente): mismo
  teléfono dominicano y misma normalización.
- `CrearUsuarioPlataformaDto` (alta administrativa): ya lo exigía desde T-75.
- Frontend: `src/app/shared/validators/identidad.validators.ts` replica las
  reglas; el registro y la pantalla de verificación filtran el `+1`, avisan del
  prefijo y de la cédula inválida antes de enviar.
- Fixtures E2E: `test/utils/identidad-fixtures.ts` (`telefonoFixture`,
  `cedulaFixture`) y los teléfonos de las suites migrados a prefijos reales.

Verificación: 1272 pruebas de backend (UTC y America/Santo_Domingo), 349 E2E y
311 de frontend en verde.
