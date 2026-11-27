# Pendientes de la Fase 7 · 27 nov 2026

## 1. Formato dominicano en el registro público (T-75, aplazado)

T-75 endureció el alta administrativa de usuario (`CrearUsuarioPlataformaDto`):
teléfono de 10 dígitos con prefijo **809 / 829 / 849** (acepta `+1` y normaliza)
y cédula de 11 dígitos con dígito verificador.

**Decisión del dueño (27 nov 2026): no extenderlo por ahora** a:

- `POST /auth/register` (`RegisterDto`): sigue aceptando cualquier teléfono de 10
  dígitos y cualquier cédula de 11, sin prefijo ni verificador.
- `PATCH` de corrección de contacto (`UpdateContactDto`): mismo contrato laxo.

Consecuencia conocida: una cuenta puede nacer por el registro público con un
teléfono que el alta administrativa rechazaría. Si se decide unificar, hay que:

1. Aplicar `TelefonoDominicano()` / `CedulaDominicana()` en `RegisterDto` y
   `UpdateContactDto` (los validadores ya existen en `src/shared/identidad.validator.ts`).
2. Actualizar las fixtures E2E que hoy usan prefijos inventados (`999…`, `600…`,
   `8…`) y cédulas sin verificador; `test/utils/identidad-fixtures.ts` ya tiene
   `telefonoFixture()` y `cedulaFixture()`.
3. Revisar los datos existentes: los teléfonos fuera de 809/829/849 no podrían
   editarse sin corregirlos primero.
