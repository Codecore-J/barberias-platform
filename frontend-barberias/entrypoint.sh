#!/bin/sh
# entrypoint del frontend (Paso 18) · runtime config sin recompilar.
#
# Genera /usr/share/nginx/html/assets/env.js con la API_URL real del contenedor
# y arranca nginx. Así una MISHA imagen sirve entorno distintos: solo cambia
# `docker run -e API_URL=...`.
set -eu

# `PRIMEUI_LICENSE` es la clave de licencia de PrimeUI/PrimeNG. Se escribe igual
# que API_URL para que la misma imagen sirva con cualquier clave —o ninguna— sin
# recompilar, y para que nunca acabe versionada en el repositorio.
if [ -n "${API_URL:-}" ] || [ -n "${PRIMEUI_LICENSE:-}" ]; then
  # Escapado mínimo para que el valor quede como string JS válido aunque traiga
  # barras o comillas.
  escapar_js() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

  HTML_DIR="/usr/share/nginx/html"
  mkdir -p "$HTML_DIR/assets"

  {
    printf '%s\n' '// Generado en el arranque del contenedor por entrypoint.sh — NO editar.'
    printf '%s\n' 'window.__env = window.__env || {};'
    if [ -n "${API_URL:-}" ]; then
      printf 'window.__env.API_URL = "%s";\n' "$(escapar_js "$API_URL")"
    fi
    if [ -n "${PRIMEUI_LICENSE:-}" ]; then
      printf 'window.__PRIMEUI_LICENSE__ = "%s";\n' "$(escapar_js "$PRIMEUI_LICENSE")"
    fi
  } > "$HTML_DIR/assets/env.js"

  if [ -n "${API_URL:-}" ]; then
    echo "[entrypoint] API_URL de runtime configurada."
  fi
  if [ -n "${PRIMEUI_LICENSE:-}" ]; then
    echo "[entrypoint] Licencia de PrimeUI inyectada en window.__PRIMEUI_LICENSE__."
  fi
fi

exec nginx -g "daemon off;"