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
# The deck follows the calendar. Each month has its own deck: the month of the
# newest close (today - 1 day) is the partial one and the month before it is the
# one under review. So on the 1st this still rebuilds the month that just ended,
# with all its days (the final version); the new month's deck starts on the 2nd. October
# lives in design-deck-october/; any later month builds from
# design-deck-YYYY-MM/ if that is committed, otherwise from an auto-draft copy
# of the newest committed deck in .draft-deck-YYYY-MM/ (git-ignored, banner on
# every slide). Its PDF goes to Storage as review-YYYY-MM.pdf, which adds the
# month's tab to the dashboard. A past month's deck is never touched again.
# REVIEW_TODAY=YYYY-MM-DD fakes the date, for tests. See README-monthly-review.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export REVIEW_TODAY="${REVIEW_TODAY:-$(TZ=Asia/Jakarta date +%F)}"
# Month of the last close (today - 1 day): on the 1st that is still the month that just ended.
PART="$(python3 -c 'import datetime as d,os;print((d.date.fromisoformat(os.environ["REVIEW_TODAY"]) - d.timedelta(days=1)).isoformat()[:7])')"
py=${PART:0:4}; pm=$((10#${PART:5:2}))
if [ "$pm" -eq 1 ]; then py=$((py - 1)); pm=12; else pm=$((pm - 1)); fi
REVIEW_MONTH="${REVIEW_MONTH:-$(printf '%04d-%02d' "$py" "$pm")}"

if [ "$PART" = "2026-10" ]; then
  DECK_DIR="presentation-docs/design-deck-october"
  PDF="presentation-docs/sayakaya-october-review-deck.pdf"
  OBJECT="presentation-decks/review-october.pdf"
else
  DECK_DIR="presentation-docs/design-deck-$PART"
  PDF="presentation-docs/sayakaya-$PART-review-deck.pdf"
  OBJECT="presentation-decks/review-$PART.pdf"
fi
export DECK_DRAFT=0
if [ ! -d "$DECK_DIR" ]; then
  src="$(ls -d presentation-docs/design-deck-20??-??/ 2>/dev/null | sort | tail -1 || true)"
  src="${src:-presentation-docs/design-deck-october/}"
  src="${src%/}"
  DECK_DIR="presentation-docs/.draft-deck-$PART"
  mkdir -p "$DECK_DIR"
  cp "$src/build-deck.py" "$DECK_DIR/build-deck.py"
  export DECK_DRAFT=1 DECK_DRAFT_FROM="${src##*design-deck-}"
  echo "no design-deck-$PART yet: building an auto-draft from $src"
fi
DATA="$DECK_DIR/data.json"

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
  # node exits 0 with no output when a query never returns (e.g. the Mac slept mid-run)
  [ -s "$tmp" ] || { echo "generator wrote no data (cut off mid-run?). Nothing written; retry later." >&2; rm -f "$tmp"; exit 3; }

  # GATE: the newest snapshot row must be today's partition, otherwise the
  # 02:05 job has not run and the deck would claim a date it does not have.
  gate="$(python3 - "$tmp" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
rows = d.get("dailyAum") or []
last = str((rows[-1]["d"] or {}).get("value") if isinstance(rows[-1]["d"], dict) else rows[-1]["d"])[:10] if rows else ""
today = os.environ["REVIEW_TODAY"]
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
