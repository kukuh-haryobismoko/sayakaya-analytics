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

The four steps are wrapped in one script, which refuses to run before the
day's snapshot exists:

```bash
./presentation-docs/refresh-monthly-review.sh              # data -> build -> pdf -> Storage
./presentation-docs/refresh-monthly-review.sh --no-upload   # stop before publishing
```

It checks that `portfolio_with_code` has today's partition (written at 02:05
WIB) and exits 3 if not, skips the work when `data.json` is already through
today, and takes `CHROME=` for the browser path on Linux.

## When the numbers arrive

Scheduled queries in BigQuery Data Transfer (`asia-southeast2`, hours UTC):

| job | schedule | writes |
| --- | --- | --- |
| `portfolio_fix-sc` | 19:00, i.e. 02:00 WIB | `mi_fee_logs.portfolio_fix` |
| `portfolio_with_code` | 19:05, i.e. 02:05 WIB | `mi_fee_logs.portfolio_with_code` |
| `mi_fee`, `mi_fee_per_sales`, `portfolio` | 01:00, i.e. 08:00 WIB | `mi_fee_logs.*` |
| `revenue_apps` | 12:00, i.e. 19:00 WIB | `mi_fee_logs.revenue` |
| `users-sc`, `transactions-sc` | hourly | `main.users`, `main.transactions` |

A snapshot written at 02:05 WIB on day D carries the close of D-1, so a run at
03:05 WIB shows yesterday's close.

## Rules for a refresh

The generator takes today's date as the cut-off, so step 1 defines what the
deck says: "Data through <today minus 1>", the "Oct · Nd" column, pace rows
and every partial-month claim. Decide the cut-off before running it. It takes
about half a minute.

Numbers, dates and the sentences that depend on them are computed in
`build-deck.py` from `data.json`, so a plain re-run keeps them right:

- the cover date and the version line;
- the days the Rp 50 B account was out (from that account's own moves) and
  the day it came back;
- the "highest since <month>" registration pace;
- weeks since the referral program launched (31 Aug 2026);
- the fall in the last closes with no order behind it.

These do NOT update by themselves and have to be reread at each refresh,
because they compare against what the *previous* PDF said, or describe what
the dashboard could do at that time:

- `prev_top_bought` in `build-deck.py` (what the last deck said about the
  busiest referrer) — currently 0, from the 8 Oct 2026 run (41 signups, none
  bought);
- the `NEW` list on "06 · New in the dashboard": add what shipped since the
  last version's date; drop rows the audience has already seen if they push
  the list over one slide;
- the claims about the partial month ("October is doing X") were written for
  the data of that run; reread them before presenting.

Slide height is a hard 720px with `overflow: hidden`, so long copy is cut
off silently, not wrapped. After any text or chart edit, check it by running
Chrome headless and measuring every slide (adjust the path):

```bash
node -e "
const {spawn}=require('child_process');
const p=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--disable-gpu','--remote-debugging-port=9333','--window-size=1280,720','about:blank'],{stdio:'ignore'});
setTimeout(async()=>{
  const t=await (await fetch('http://127.0.0.1:9333/json/new?'+encodeURIComponent('file://'+process.env.PWD+'/presentation-docs/design-deck-october/deck-print.html'),{method:'PUT'})).json();
  const w=new WebSocket(t.webSocketDebuggerUrl); let i=0; const pend={};
  const send=(m,pr)=>new Promise(r=>{const n=++i;pend[n]=r;w.send(JSON.stringify({id:n,method:m,params:pr}))});
  w.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend[m.id])pend[m.id](m.result)};
  await new Promise(r=>w.onopen=r); await new Promise(r=>setTimeout(r,2500));
  const r=await send('Runtime.evaluate',{returnByValue:true,expression:\`(()=>{const o=[];document.querySelectorAll('.slide').forEach((s,i)=>{const rc=s.getBoundingClientRect();let worst=null;s.querySelectorAll('*').forEach(el=>{const b=el.getBoundingClientRect();if(b.height>0){const over=Math.round(b.bottom-(rc.bottom-68));if(worst===null||over>worst)worst=over}});if(worst>0)o.push({page:i+1,overflowPx:worst})});return JSON.stringify(o)})()\`});
  console.log(r.result.value); p.kill(); process.exit(0);
},1800)"
```

Anything above 0 means text sitting past the printable area; trim or shrink
it, re-run, then reprint the PDF. The same probe with `.click()`-style edits
is the quickest way to tell whether a slide change fits before presenting.

For a new month: copy `design-deck-october/` to a new folder, run the data
script with the new review month, and rewrite the narrative in
`build-deck.py` for what that month's data shows. Then add the month to
`PRESENTATIONS` in `server/app.js` and `supabase/functions/api/index.ts`, and
a button to `#monthlyReviewMonthSeg` in `public/index.html`.
