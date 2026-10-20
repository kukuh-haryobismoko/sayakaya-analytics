#!/usr/bin/env bash
# Refresh the Monthly Review deck: data -> HTML -> PDF -> Supabase Storage.
#
# Run it after the 02:05 WIB snapshot lands. It refuses to do anything when the
# snapshot for today is missing, so a failed scheduled query cannot ship a deck
# labelled with a date it does not have.
#
#   ./presentation-docs/refresh-monthly-review.sh              # full run + publish
#   ./presentation-docs/refresh-monthly-review.sh --no-upload  # build only
#   ./presentation-docs/refresh-monthly-review.sh --force       # rebuild even if the date is unchanged
#   ./presentation-docs/refresh-monthly-review.sh --skip-generate
#
# REVIEW_MONTH selects the month under review (default 2026-09). A new month
# needs its own design-deck directory; see README-monthly-review.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DECK_DIR="presentation-docs/design-deck-october"
DATA="$DECK_DIR/data.json"
PDF="presentation-docs/sayakaya-october-review-deck.pdf"
OBJECT="presentation-decks/review-october.pdf"
REVIEW_MONTH="${REVIEW_MONTH:-2026-09}"

NO_UPLOAD=0
FORCE=0
SKIP_GEN=0
for arg in "$@"; do
  case "$arg" in
    --no-upload) NO_UPLOAD=1 ;;
    --force) FORCE=1 ;;
    --skip-generate) SKIP_GEN=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [ -f .env ]; then set -a; . ./.env; set +a; fi
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$ROOT/service-account.json}"
[ -f "$GOOGLE_APPLICATION_CREDENTIALS" ] || { echo "missing BigQuery key: $GOOGLE_APPLICATION_CREDENTIALS" >&2; exit 1; }

chrome() {
  for c in "${CHROME:-}" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$(command -v google-chrome || true)" "$(command -v chromium || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done
  echo "no Chrome found (set CHROME)" >&2; return 1
}

if [ "$SKIP_GEN" -eq 0 ]; then
  tmp="$(mktemp "${TMPDIR:-/tmp}/review-data.XXXXXX")"
  echo "generating data for $REVIEW_MONTH (about 2 minutes)..."
  node presentation-docs/generate-monthly-review-data.js "$REVIEW_MONTH" > "$tmp"

  # GATE: the newest snapshot row must be today's partition, otherwise the
  # 02:05 job has not run and the deck would claim a date it does not have.
  gate="$(python3 - "$tmp" <<'PY'
import json, sys, datetime
d = json.load(open(sys.argv[1]))
rows = d.get("dailyAum") or []
last = str((rows[-1]["d"] or {}).get("value") if isinstance(rows[-1]["d"], dict) else rows[-1]["d"])[:10] if rows else ""
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).date().isoformat()
print(("OK" if last == today else "STALE") + " " + last + " " + today + " " + str(d.get("partialThrough")))
PY
)"
  read -r verdict last today through <<<"$gate"
  if [ "$verdict" != "OK" ] && [ "$FORCE" -eq 0 ]; then
    echo "snapshot not in yet: newest row is $last, today is $today. Nothing written; retry later or pass --force." >&2
    rm -f "$tmp"; exit 3
  fi

  old_through=""
  [ -f "$DATA" ] && old_through="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("partialThrough",""))' "$DATA")"
  if [ "$through" = "$old_through" ] && [ "$FORCE" -eq 0 ] && [ "$SKIP_GEN" -eq 0 ]; then
    echo "data.json is already through $through; nothing to do (use --force to rebuild)"
    rm -f "$tmp"; exit 0
  fi
  mv "$tmp" "$DATA"
  echo "data.json through $through (newest snapshot $last)"
else
  echo "using existing $DATA"
fi

python3 "$DECK_DIR/build-deck.py"
# --no-sandbox is needed on CI runners (root in a container); harmless elsewhere.
"$(chrome)" --headless --no-sandbox --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 \
  --print-to-pdf="$PDF" "$DECK_DIR/deck-print.html" 2>/dev/null
echo "pdf: $(python3 -c 'import os,sys;print(os.path.getsize(sys.argv[1]))' "$PDF") bytes, $(pdfinfo "$PDF" | awk '/^Pages/{print $2}') pages"

if [ "$NO_UPLOAD" -eq 0 ]; then
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || { echo "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" >&2; exit 1; }
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/storage/v1/object/$OBJECT" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "x-upsert: true" \
    -H "Content-Type: application/pdf" --data-binary "@$PDF")"
  case "$code" in
    200|201) echo "published: $OBJECT" ;;
    *) echo "upload failed: HTTP $code" >&2; exit 1 ;;
  esac
fi
