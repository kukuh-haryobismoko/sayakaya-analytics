# Monthly Review deck

Each month's deck reviews the previous full month against the month before
it, plus the current month so far. The October 2026 deck (in
`design-deck-october/`) is generated entirely from data, so a refresh is:

```bash
# 1. Pull every number (BigQuery + Supabase; takes about 2 minutes)
node presentation-docs/generate-monthly-review-data.js 2026-09 > presentation-docs/design-deck-october/data.json

# 2. Build the slides
python3 presentation-docs/design-deck-october/build-deck.py

# 3. Print to PDF
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer \
  --print-to-pdf="$PWD/presentation-docs/sayakaya-october-review-deck.pdf" \
  "file://$PWD/presentation-docs/design-deck-october/deck-print.html"

# 4. Publish to the Monthly Review tab (Supabase Storage, overwrites the old file)
set -a; . ./.env; set +a
curl -X POST "$SUPABASE_URL/storage/v1/object/presentation-decks/review-october.pdf" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "x-upsert: true" \
  -H "Content-Type: application/pdf" --data-binary @presentation-docs/sayakaya-october-review-deck.pdf
```

`data.json` holds account identifiers and is gitignored; never commit it.

Before republishing, reread the sentences about the partial month (the
"Oct · Nd" column, the Rp 50 B account's expected month-end exit, the
October pace). They were written for data through 7 October; numbers update
by themselves, claims about what October "is doing" may not hold.

For a new month: copy `design-deck-october/` to a new folder, run the data
script with the new review month, and rewrite the narrative in
`build-deck.py` for what that month's data shows. Then add the month to
`PRESENTATIONS` in `server/app.js` and `supabase/functions/api/index.ts`, and
a button to `#monthlyReviewMonthSeg` in `public/index.html`.
