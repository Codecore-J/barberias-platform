#!/bin/sh
# entrypoint del frontend (Paso 18) · runtime config sin recompilar.
#
# Genera /usr/share/nginx/html/assets/env.js con la API_URL real del contenedor
# y arranca nginx. Así una MISHA imagen sirve entorno distintos: solo cambia
# `docker run -e API_URL=...`.
set -eu

API_URL="${API_URL:-http://localhost:3000/api/v1}"

# Escapado mínimo para que el valor quede como string JS válido aunque traiga
# barras o comillas.
API_URL_ESCAPADA=$(printf '%s' "$API_URL" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

HTML_DIR="/usr/share/nginx/html"
mkdir -p "$HTML_DIR/assets"

cat > "$HTML_DIR/assets/env.js" <<EOF
// Generado en el arranque del contenedor por entrypoint.sh — NO editar.
// Se sobrescribe en cada arranque con la variable de entorno API_URL.
window.__env = {
  API_URL: "${API_URL_ESCAPADA}",
};
EOF

echo "[entrypoint] Servindo la SPA con API_URL=${API_URL}"

exec nginx -g "daemon off;"