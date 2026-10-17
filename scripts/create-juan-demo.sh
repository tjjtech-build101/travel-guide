#!/bin/zsh
# Crea el usuario demo "Juan" en el Supabase de la nube del equipo,
# usando la service_role_key de apps/api/.env. Correrlo a mano:
#   zsh scripts/create-juan-demo.sh

cd "$(dirname "$0")/../apps/api"
SUPABASE_URL=$(grep -m1 "^SUPABASE_URL=" .env | cut -d= -f2-)
SERVICE_KEY=$(grep -m1 "^SUPABASE_SERVICE_ROLE_KEY=" .env | cut -d= -f2-)

curl -s -w "\nHTTP_STATUS:%{http_code}\n" "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "juan@demo.build101.dev",
    "password": "build101-demo",
    "email_confirm": true,
    "user_metadata": {"full_name": "Juan"}
  }'
