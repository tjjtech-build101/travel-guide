#!/usr/bin/env bash
# Smoke test de la API contra Supabase local con el seed de demo (PRD 00, "Cómo probarlo").
# Uso: (en otra terminal `pnpm --filter api dev`) y después `bash apps/api/scripts/smoke.sh`
# Variables: API (default http://localhost:8787), SUPABASE_URL / SUPABASE_ANON_KEY (default: apps/api/.env).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$HERE/../.env" ]]; then
  set -a; # shellcheck disable=SC1091
  source "$HERE/../.env"; set +a
fi
API="${API:-http://localhost:8787}"
: "${SUPABASE_URL:?falta SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?falta SUPABASE_ANON_KEY}"
command -v jq >/dev/null || { echo "Necesitás jq"; exit 1; }

TRIP=10000000-0000-0000-0000-000000000001
LEG_MVD=20000000-0000-0000-0000-000000000001
PASSWORD=build101-demo
PASS=0; FAIL=0

ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $*"; FAIL=$((FAIL+1)); }
check(){ local desc="$1" cond="$2"; if [[ "$cond" == "true" ]]; then ok "$desc"; else bad "$desc"; fi; }

login() {
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1@demo.build101.dev\",\"password\":\"$PASSWORD\"}" | jq -r .access_token
}

# tool <jwt|-> <name> <json> [actor]  → imprime "<status>\n<body>"
tool() {
  local jwt="$1" name="$2" body="$3" actor="${4:-user}"
  local auth=(); [[ "$jwt" != "-" ]] && auth=(-H "Authorization: Bearer $jwt")
  curl -s -w '\n%{http_code}' -X POST "$API/tools/$name" "${auth[@]}" \
    -H 'Content-Type: application/json' -H "x-actor: $actor" -d "$body"
}
status() { tail -n1 <<<"$1"; }
body()   { sed '$d' <<<"$1"; }

rest() { # rest <jwt> <path>  (PostgREST con RLS del usuario)
  curl -s "$SUPABASE_URL/rest/v1/$2" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $1"
}

echo "== health"
curl -s "$API/health" | jq -c '{ok, missing_env, google}'

echo "== login"
ANA=$(login ana); SOFI=$(login sofi)
check "login Ana" "$([[ -n "$ANA" && "$ANA" != null ]] && echo true || echo false)"
check "login Sofi" "$([[ -n "$SOFI" && "$SOFI" != null ]] && echo true || echo false)"

echo "== errores del contrato"
R=$(tool - add_block '{}'); check "sin JWT → 401" "$([[ $(status "$R") == 401 ]] && echo true || echo false)"
R=$(tool "$ANA" no_existe '{}'); check "herramienta desconocida → 404" "$([[ $(status "$R") == 404 ]] && echo true || echo false)"
R=$(tool "$ANA" add_block '{"trip_id":"x"}')
check "input inválido → 400 invalid_input" "$([[ $(status "$R") == 400 && $(body "$R" | jq -r .error.code) == invalid_input ]] && echo true || echo false)"

echo "== día 2026-10-18 (Ana)"
R=$(tool "$ANA" get_day_plan "{\"trip_id\":\"$TRIP\",\"date\":\"2026-10-18\"}")
DAY=$(body "$R" | jq -r .data.day.id)
check "get_day_plan por trip_id+date → day_id ($DAY)" "$([[ $(status "$R") == 200 && "$DAY" != null ]] && echo true || echo false)"

echo "== add_block compartido (humano) → aplica"
NEW="{\"trip_id\":\"$TRIP\",\"leg_id\":\"$LEG_MVD\",\"day_id\":\"$DAY\",\"type\":\"meal\",\"title\":\"Smoke: café en Plaza Matriz\",\"start_time\":\"14:00\",\"duration_min\":45,\"time_flex\":\"afternoon\",\"lat\":-34.9071,\"lng\":-56.2045}"
R=$(tool "$ANA" add_block "$NEW"); B=$(body "$R")
TOKEN1=$(jq -r .undo_token <<<"$B"); BLOCK1=$(jq -r .data.block.id <<<"$B")
check "mode=applied con undo_token y feed_id" "$(jq '.data.mode=="applied" and (.undo_token|length)==32 and (.feed_id!=null)' <<<"$B")"
check "participantes default = miembros del tramo (4)" "$(jq '.data.block.participant_ids|length==4' <<<"$B")"
FEEDS=$(rest "$ANA" "activity_feed?select=id,kind&undo_token=eq.$TOKEN1" | jq length)
check "1 fila en activity_feed con ese undo_token" "$([[ "$FEEDS" == 1 ]] && echo true || echo false)"

echo "== add_block compartido (x-actor: agent) → propuesta"
NEW2=$(jq '.title="Smoke: propuesta del agente"' <<<"$NEW")
R=$(tool "$ANA" add_block "$NEW2" agent); B=$(body "$R")
TOKEN2=$(jq -r .undo_token <<<"$B"); PROP=$(jq -r .data.proposal_id <<<"$B")
check "mode=proposed con proposal_id" "$(jq '.data.mode=="proposed" and .data.proposal_id!=null' <<<"$B")"
check "agent_proposals pending" "$(rest "$ANA" "agent_proposals?select=status&id=eq.$PROP" | jq '.[0].status=="pending"')"
check "el bloque propuesto NO está en blocks" "$(rest "$ANA" "blocks?select=id&title=eq.Smoke:%20propuesta%20del%20agente" | jq 'length==0')"

echo "== agente sobre bloque personal (privado) de Juan → 403"
PRIV=$(body "$(tool "$SOFI" get_day_plan "{\"day_id\":\"$DAY\"}")" | jq -r '[.data.blocks[]|select(.masked)][0].id')
R=$(tool "$ANA" update_block "{\"block_id\":\"$PRIV\",\"patch\":{\"title\":\"x\"}}" agent)
check "403 forbidden" "$([[ $(status "$R") == 403 && $(body "$R" | jq -r .error.code) == forbidden ]] && echo true || echo false)"

echo "== move_block con recompute_times + undo"
R=$(tool "$ANA" add_block "$(jq '.title="Smoke: mover" | .start_time="12:00"' <<<"$NEW")")
BLOCK3=$(body "$R" | jq -r .data.block.id); TOKEN3=$(body "$R" | jq -r .undo_token)
R=$(tool "$ANA" move_block "{\"block_id\":\"$BLOCK3\",\"day_id\":\"$DAY\",\"start_time\":\"15:30\"}"); B=$(body "$R")
TOKEN4=$(jq -r .undo_token <<<"$B")
check "move_block aplica (start 15:30, changed_block_ids=$(jq -c .data.changed_block_ids <<<"$B"))" "$(jq '.data.mode=="applied" and .data.block.start_time=="15:30:00"' <<<"$B")"
R=$(tool "$ANA" undo "{\"undo_token\":\"$TOKEN4\"}")
check "undo del move vuelve a 12:00" "$(rest "$ANA" "blocks?select=start_time&id=eq.$BLOCK3" | jq '.[0].start_time=="12:00:00"')"
tool "$ANA" undo "{\"undo_token\":\"$TOKEN3\"}" >/dev/null

echo "== undo"
R=$(tool "$ANA" undo "{\"undo_token\":\"$TOKEN1\"}")
check "undo → reverted" "$([[ $(status "$R") == 200 ]] && body "$R" | jq '.data.reverted==true' || echo false)"
check "el bloque ya no está" "$(rest "$ANA" "blocks?select=id&id=eq.$BLOCK1" | jq 'length==0')"
R=$(tool "$ANA" undo "{\"undo_token\":\"$TOKEN1\"}")
check "segundo undo → 409 already_undone" "$([[ $(status "$R") == 409 && $(body "$R" | jq -r .error.code) == already_undone ]] && echo true || echo false)"
R=$(tool "$ANA" undo "{\"undo_token\":\"$TOKEN2\"}")
check "undo de la propuesta → rejected" "$(rest "$ANA" "agent_proposals?select=status&id=eq.$PROP" | jq '.[0].status=="rejected"')"
R=$(tool "$SOFI" undo "{\"undo_token\":\"$TOKEN3\"}")
check "otro miembro (no organizer) no puede deshacer lo de Ana → 403 o 409" "$([[ $(status "$R") == 403 || $(status "$R") == 409 ]] && echo true || echo false)"

echo "== bloque personal/privado (Juan)"
JUAN=$(login juan)
PRIVNEW="{\"trip_id\":\"$TRIP\",\"leg_id\":\"$LEG_MVD\",\"day_id\":\"$DAY\",\"type\":\"free\",\"title\":\"Smoke: siesta\",\"start_time\":\"20:00\",\"duration_min\":30,\"is_private\":true}"
R=$(tool "$JUAN" add_block "$PRIVNEW" agent); B=$(body "$R"); TOKEN5=$(jq -r .undo_token <<<"$B"); BLOCK5=$(jq -r .data.block.id <<<"$B")
check "agente + personal (privado de Juan) → aplica, created_by_agent" "$(jq '.data.mode=="applied" and .data.block.created_by_agent==true and .data.block.participant_ids==["00000000-0000-0000-0000-000000000001"]' <<<"$B")"
check "feed busy_changed del día (sin detalles)" "$(rest "$SOFI" "activity_feed?select=payload&kind=eq.busy_changed&order=created_at.desc&limit=1" | jq --arg d "$DAY" '.[0].payload.day_id==$d and (.[0].payload|has("title")|not)')"
R=$(tool "$JUAN" remove_block "{\"block_id\":\"$BLOCK5\"}")
TOKEN6=$(body "$R" | jq -r .undo_token)
R=$(tool "$JUAN" undo "{\"undo_token\":\"$TOKEN6\"}")
check "undo de remove re-crea el privado con su participante" "$(rest "$JUAN" "block_participants?select=user_id&block_id=eq.$BLOCK5" | jq 'length==1')"
tool "$JUAN" undo "{\"undo_token\":\"$TOKEN5\"}" >/dev/null
R=$(tool "$ANA" add_block "$(jq '.title="Smoke: organizer deshace"' <<<"$NEW")"); TOKEN7=$(body "$R" | jq -r .undo_token)
R=$(tool "$JUAN" undo "{\"undo_token\":\"$TOKEN7\"}")
check "el organizer (Juan) deshace algo de Ana" "$([[ $(status "$R") == 200 ]] && echo true || echo false)"
R=$(curl -s -w '\n%{http_code}' "$API/jobs/00000000-0000-0000-0000-00000000dead" -H "Authorization: Bearer $ANA")
check "GET /jobs/:id inexistente → 404" "$([[ $(status "$R") == 404 ]] && echo true || echo false)"

echo "== lecturas"
R=$(tool "$ANA" get_trip_overview "{\"trip_id\":\"$TRIP\"}"); B=$(body "$R")
check "get_trip_overview: 4 tramos, summary ≤ 600" "$(jq '(.data.legs|length)==4 and (.data.summary|length)<=600 and (.data.summary|length)>0' <<<"$B")"
echo "    summary: $(jq -r .data.summary <<<"$B")"
R=$(tool "$SOFI" get_day_plan "{\"trip_id\":\"$TRIP\",\"date\":\"2026-10-18\"}"); B=$(body "$R")
check "Sofi ve 'Ocupado' el 18/10 (sin detalles)" "$(jq '[.data.blocks[]|select(.title=="Ocupado" and .masked and .notes==null and .lat==null)]|length>=1' <<<"$B")"
check "Sofi no ve 'Llamada de laburo'" "$(jq '[.data.blocks[]|select(.title|test("Llamada"))]|length==0' <<<"$B")"
echo "    plan Sofi 18/10: $(jq -c '[.data.blocks[]|"\(.start_time // "--") \(.title)"]' <<<"$B")"

echo "== Google"
R=$(tool "$ANA" search_places '{"query":"café","near":{"lat":-34.9071,"lng":-56.2045},"radius_m":800}')
if [[ $(status "$R") == 503 ]]; then
  echo "  · search_places → not_configured (sin GOOGLE_MAPS_API_KEY)"
else
  check "search_places café cerca de Plaza Matriz ≥ 3" "$(body "$R" | jq '.data|length>=3')"
fi
R=$(tool "$ANA" route_eta '{"stops":[{"lat":-34.9067,"lng":-56.1994},{"lat":-34.9064,"lng":-56.2139}],"mode":"walk"}')
TOTAL=$(body "$R" | jq .data.total_min)
check "route_eta Ciudadela → Mercado del Puerto a pie: $TOTAL min (10–25)" "$([[ $(status "$R") == 200 && $TOTAL -ge 10 && $TOTAL -le 25 ]] && echo true || echo false)"

echo
echo "Resultado: $PASS ok, $FAIL fallas"
[[ $FAIL == 0 ]]
