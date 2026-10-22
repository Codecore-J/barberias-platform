<!-- Explicación concisa de por qué estos números son coherentes -->

| Indicador | Valor | ¿Por qué coincide con el código? |
|---|---|---|
| Backend unit tests | 637 passed / 53 files | `src/**/*.spec.ts` + `test/**/*.spec.ts`; tests de dominios puros (huecos, reserva-grupal, estados, táctica), servicios E1/E3/E4 y E2E helper specs que vitest trata como unitarios. |
| E2E files | 16 suites | Carpeta `test/` con suites veraces de integración en base real: auth, barbería, reservas, catálogo, agenda, configuración, pagos, auditoría, permisos, cross-tenant, E3-03, E3-11/12/13, fidelización, health, throttler. |
| E2E tests | 93 | Total assertions de suites E2E del log `e2e_full.log`; incluye 10 fallidos en E3-03 parte 2. |
| Branches integradas en 81d40a0 | 5 | `fix/e0-e1-cimientos-finales`, `fix/e3-contract-alignment`, `fix/e2-05-margin-conflict`, `ci/run-e2e-tests`, más rama de merge `feat/e3-03-validaciones` en el contexto. |
| Líneas de código vistas | Se ejecutó `read_files` sobre decenas de archivos clave y varias partes fueron truncadas por límite de caracteres; solo se usó lo que pudo verificarse hasta el corte. | Las secciones del informe que dependen de archivos grandes (ej. `notificacion.service.spec.ts`) quedan como “verificado hasta el corte de lectura” en vez de afirmación ciega. |

**Notas de validez:**

- Los conteos de tests (637 / 53 / 93) son coherentes con lo que el proyecto expone: vitest detecta `*.spec.ts`; el `test:e2e` usa `vitest.config.e2e.ts` distinto y esto explica por qué un mismo repositorio tiene dos números de suites.
- El número de E2E suites (16) coincide con los archivos `.e2e-spec.ts` que existen y están bajo `test/`; `e4-02-oportunidades.clean.e2e-spec.ts` mencionado en un lado del contexto **no existe** en este entorno, lo cual es relevante para E4-02: solo hay un archivo E2E de este tema (el de Carril A).
- Se confirma que hay 5 ramas integradas mencionadas en el prompt, siendo 4 de ellas `fix/` o `ci/` y una `feat/e3-03-validaciones` como rama de contexto del informe.
