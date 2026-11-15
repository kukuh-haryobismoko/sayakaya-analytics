#!/usr/bin/env python3
"""Build the November 2026 AI Taskforce deck from the September deck's CSS + logo.
Run from presentation-docs/. Writes ai-taskforce-november-2026.html and the speaker-notes .md;
the PDF is printed by Chrome (see the bottom of this file)."""
import re, pathlib, subprocess

here = pathlib.Path(__file__).parent
sep = (here / "ai-taskforce-september-2026.html").read_text()
css = re.search(r"<style>(.*?)</style>", sep, re.S).group(1)
logo = re.search(r'class="logo-mark" src="([^"]+)"', sep).group(1)
css += """
.src{position:absolute;bottom:26px;left:72px;right:130px;font-size:11px;color:#8a90a6;line-height:1.4}
.tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;border-radius:20px;padding:1px 8px;vertical-align:1px}
.tag.m{background:var(--teal-tint);color:#0a8f61;border:1px solid #b7ecd9}
.tag.e{background:var(--amber-tint);color:#9a6f00;border:1px solid #f1dc9a}
.tag.q{background:var(--indigo-tint);color:var(--indigo);border:1px solid #cfd6f7}
.bars{display:flex;align-items:flex-end;gap:26px;height:200px;border-bottom:2px solid var(--line);padding:0 14px}
.bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%}
.bar .v{font-weight:800;font-size:18px;margin-bottom:6px;text-align:center}
.bar .b{width:100%;border-radius:8px 8px 0 0}
.bar-lbl{display:flex;gap:26px;padding:8px 14px 0}.bar-lbl div{flex:1;text-align:center;font-size:12.5px;color:var(--muted);line-height:1.35}
.stack{display:flex;height:30px;border-radius:8px;overflow:hidden;margin:10px 0 8px}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
table.t{width:100%;border-collapse:collapse;font-size:13.5px}
table.t th{text-align:left;padding:9px 14px;font-size:11.5px;letter-spacing:1px;text-transform:uppercase;background:var(--indigo-tint);color:var(--indigo)}
table.t td{padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.4}
table.t td:first-child{font-weight:700;white-space:nowrap}
.tl{display:flex}.tl>div{flex:1;border-top:4px solid var(--indigo);padding:14px 22px 0 0}
.tl .when{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:var(--indigo);margin-bottom:10px}
.tl ul{margin:0;padding-left:18px;font-size:14.5px;line-height:1.55}
.ask{display:flex;gap:20px;align-items:flex-start;background:#f7f8fc;border:1px solid var(--line);border-left:4px solid var(--indigo);border-radius:12px;padding:18px 24px;margin-bottom:16px}
.ask .n{font-size:30px;font-weight:800;color:var(--indigo);line-height:1}.ask .h{font-weight:700;font-size:18px}.ask .d{font-size:14.5px;color:var(--muted);margin-top:4px;line-height:1.5}
"""
M = '<span class="tag m">Measured</span>'
E = '<span class="tag e">Estimate</span>'
Q = '<span class="tag q">Qualitative</span>'
slides, notes = [], []


def card(t, b, c="indigo"):
    return f'<div class="card accent-{c}"><div class="card-title">{t}</div><p class="card-body">{b}</p></div>'


def stat(n, l):
    return f'<div class="stat-card"><div class="num">{n}</div><div class="lbl">{l}</div></div>'


def slide(n, eyebrow, title, body, note, src=""):
    s = (f'<div class="slide"><div class="eyebrow eyebrow-dash">{eyebrow}</div><h1 class="title">{title}</h1>{body}'
         + (f'<div class="src">{src}</div>' if src else "") + f'<div class="page-num">{n:02d}</div></div>')
    slides.append(s)
    notes.append((title, note))




EXTRA = '.card-title{font-size:21px!important}.card-body{font-size:17px!important;line-height:1.5!important}.card-grid{margin-top:44px!important;gap:26px!important}.tl{margin-top:60px!important}.tl ul{font-size:20px!important;line-height:1.7!important}.tl .when{font-size:15px!important}table.t{font-size:15.5px!important}table.t td{padding:11px 14px!important}'
d = here
import base64, json
IMG = here / "shots"


def img(name, box, w):
    from PIL import Image
    import io
    im = Image.open(IMG / ("v2-" + name + ".jpg")).convert("RGB").crop(box)
    im = im.resize((w * 2, round(im.height * w * 2 / im.width)))
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    b = base64.b64encode(buf.getvalue()).decode()
    return ('<div style="width:%dpx;flex:none;border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:0 4px 16px rgba(30,40,90,.12)">'
            '<img src="data:image/jpeg;base64,%s" style="width:%dpx;display:block"></div>') % (w, b, w)


def txt(feature, impact, who, sz=16):
    return ('<div style="font-size:%dpx;line-height:1.45;min-width:0"><p style="margin:0"><b style="color:var(--indigo)">Feature</b><br>%s</p>'
            '<p style="margin:14px 0 0"><b style="color:#0a8f61">Business impact</b><br>%s</p>'
            '<p style="margin:14px 0 0;font-size:%dpx;color:var(--muted)"><b>Used by:</b> %s</p></div>') % (sz, feature, impact, sz - 2, who)


def side(image, feature, impact, who, w=1040):
    return wide(image, feature, impact, who, w)


def wide(image, feature, impact, who, w=1000):
    bx = image[1]; w = min(w, round(360 * (bx[2] - bx[0]) / (bx[3] - bx[1])))
    return ('<div style="margin-top:18px">' + img(*image, w) + '</div>'
            '<div style="display:flex;gap:30px;margin-top:14px;font-size:15px;line-height:1.4"><div style="flex:1"><b style="color:var(--indigo)">Feature</b><br>' + feature + '</div>'
            '<div style="flex:1"><b style="color:#0a8f61">Business impact</b><br>' + impact + '</div><div style="flex:.7;color:var(--muted)"><b>Used by:</b> ' + who + '</div></div>')


slides.append('<div class="slide cover"><div class="cover-top"><img class="logo-mark" src="' + logo + '" alt="Sayakaya"></div>'
 '<div class="cover-mid"><div class="eyebrow-dash">AI Taskforce &middot; Update</div><h1>How AI supports the Sayakaya business and its team</h1>'
 '<p class="sub">What we built with the AI assistant since September: the live dashboard, the teams using it, what it saves and where it goes next.</p></div>'
 '<div class="cover-bottom"><span>SAYAKAYA</span><span>Board of Directors &middot; 19 November 2026</span></div></div>')
notes.append(("Title", "Companion to the numbers deck. Screens come from the live dashboard. Only AUM values are blurred; names, emails and phone numbers are blurred as a safety measure."))

slide(2, "SUMMARY", "AI turned the analytics work into a dashboard the whole company uses every day",
 '<div class="card-grid" style="margin-top:30px">'
 + card("Growth: see what works", "Booth and promo results, and where new users drop out, on one screen. Impact: budget goes to the channels that convert.", "indigo")
 + card("Decisions: ask in plain words", "Ask answers a business question in seconds; AI Insights writes the weekly digest and flags unusual days. Impact: no waiting for an analyst.", "teal")
 + card("Finance and ops: less manual work", "Revenue by fund, investor lookups, bulk exports and delivery tracking are ready screens. Impact: routine reports no longer start from a blank file.", "amber")
 + card("Cloud cost: down by about 70%", "Data reads in BigQuery (Google's data warehouse) fell from about 10.1 TiB to 3.7 TiB per month. Impact: the monthly bill fell by an estimated Rp 0.87 M.", "rose") + '</div>',
 "Four messages, each proven on a later slide with a real screen. Cost figures are an estimate from job logs, basis on the cost slide. Time saved and revenue effect were not measured, so impact is described, not counted.")

slide(3, "WHO USES IT", "Eleven Sayakaya logins use the dashboard: management, finance, operations, marketing and product",
 '<table class="t" style="margin-top:20px"><tr><th>Team</th><th>Logins</th><th>What they use it for</th></tr>'
 '<tr><td>Management (CEO and CPO)</td><td>maureen, ramano</td><td>Growth, revenue, funnel, booth and promo views, Ask, monthly review. Maureen also uses AI Insights.</td></tr>'
 '<tr><td>Finance</td><td>tiur</td><td>Revenue by fund, portfolio and reconciliation views, partner (remisier) revenue, forecasts; exports revenue detail.</td></tr>'
 '<tr><td>Operations</td><td>audrey, robby</td><td>Investor lookups and corrections (portfolio fix), reconciliation, revenue, referral and booth views.</td></tr>'
 '<tr><td>Marketing and sales</td><td>hardy, gilang</td><td>Booth events, promo recap, referral program, push lists. Hardy also uses Ask.</td></tr>'
 '<tr><td>Product manager</td><td>imel</td><td>Explores the product: funnel, user behaviour, onboarding, Ask, SQL explorer.</td></tr>'
 '<tr><td>Analytics owner</td><td>kukuh</td><td>Builds every feature, manages access, sends scheduled reports.</td></tr>'
 '<tr><td>Customer service, viewer</td><td>cs, guest</td><td>cs: overview and investor lists. guest: presentation tab only.</td></tr></table>'
 '<p style="margin:10px 0 0;font-size:12.5px;color:var(--muted)">Roles of maureen, ramano, imel and tiur confirmed by the analytics owner. Other team labels inferred from each login\'s access list.</p>',
 "Source: dashboard user list (11 logins). Roles of maureen and ramano (CEO and CPO), imel (product manager) and tiur (finance) confirmed by Kukuh; other labels are inference from access lists. Confirm before the meeting.")

slide(4, "ONE PLATFORM, SAFE ACCESS", "Each colleague sees only the sections they need, and every action leaves a trail",
 wide(("admin", (56, 50, 1730, 608)), "One login per person with a per-section access list (the blue chips). Every login, export and Ask question is also written to an activity log.",
      "Investor data stays with the people who need it, and the company can answer who opened or exported what. Emails are blurred here.", "kukuh administers access; everyone works inside their own list."),
 "Investor data is sensitive. Access is per section and applies immediately. The activity log records logins, exports, Ask questions and sensitive views.")

slide(5, "GROWTH: BOOTH EVENTS", "Marketing and sales see what each booth delivered, from sign-up to first purchase",
 side(("booth-event", (50, 239, 1730, 900)), "Every event code followed from registration to KYC (identity check), first purchase and money in, by booth and by sales person.",
      "Shows which booths and sales people convert, so effort and budget go where it pays. The roster and dates are editable by the analytics owner.",
      "audrey, hardy, ramano, maureen (access list)"),
 "Live screen, Nov 1-15 range. 331 registered with an event code, 235 passed KYC, 29 bought, Rp 156.66 M bought. Booth period 19 Oct 2026 to 10 Jan 2027, 29 codes. Fund and person names replaced or blurred.")

slide(6, "GROWTH: PROMOS", "Finance and marketing see what a promo costs next to the fee it earns",
 side(("promo-recap", (48, 305, 1728, 780)), "One screen per promo code: buys, who qualifies, who is still waiting, who withdrew early, bonus owed vs sent, and fee earned.",
      "Promo cost (bonus) is tracked against the fee earned, so a promo that does not pay for itself is visible.",
      "hardy, gilang, ramano, maureen (access list)", 1100),
 "Live screen, 1 Jan to 15 Nov 2026: 691 promo buys by 375 customers; fee earned Rp 66.02 M of Rp 113.76 M management fee. Bonus owed Rp 8.4 M, sent Rp 339.35 M, plus 248 set by hand.")

slide(7, "RETENTION", "The product team can see where new sign-ups drop out",
 side(("funnel-kpi", (0, 0, 1680, 357)), "A funnel from first tap on Register to KYC and first paid purchase, split by phone type and sign-up method. Cards show the key rates; the box below lists every step.",
      "Points the product team to the one step to fix first: here 82% of verified users never placed a first buy order.",
      "imel, ramano, maureen (access list)"),
 "Live screen, 17 Aug to 15 Nov 2026. 1,227 phones started sign-up, 57.3% passed KYC, 9.5% paid a first buy. Biggest drop-off 82% before placing a first buy order. Counts are of phones, not people.")

slide(8, "ASK", "Anyone with access can ask a business question in plain words and get the answer in seconds",
 wide(("ask", (55, 55, 1720, 610)), "Type a question in everyday English. The answer is written from live data, with the SQL and table behind it one click away.",
      "A manager gets a number in seconds instead of sending a request to the analyst and waiting.", "hardy, imel, ramano, maureen, kukuh", 1040),
 "Question typed live: How many users registered and completed KYC each month since September? Answer from the live data: 1,176 registered and 782 completed KYC since September (130/67 Sep, 612/426 Oct, 434/289 Nov). The tool also noted its own caveat. Ask is open to five logins; the activity log shows hardy asked 6 questions since September, so adoption can grow.")

slide(9, "AI INSIGHTS: WEEKLY DIGEST", "AI writes the weekly digest for management, so nobody has to draft it",
 wide(("ai-digest", (0, 115, 1740, 695)), "One click writes a short digest. The figures come from the database; the AI only writes the sentences around them.",
      "Management gets a readable weekly summary in seconds. AUM values are blurred in this deck.", "maureen, kukuh (access list)", 1040),
 "Digest produced live on the dashboard. AUM figures blurred. Open to two logins; actual use is not measured.")

slide(10, "AI INSIGHTS: ANOMALY SCAN", "AI flags unusual days, so problems are seen in the same week",
 wide(("ai-anomaly", (0, 0, 1740, 450)), "Scans recent days and lists any where buying, selling or AUM moved far from the normal pattern (z-score = how many standard deviations).",
      "A spike such as buy volume of Rp 35.1 B on 5 Nov is flagged immediately, not found at month end. AUM rows are blurred.", "maureen, kukuh (access list)", 1040),
 "Anomaly scan run live on the dashboard. Row shown: 2026-11-05 buy volume Rp 35,105,490,000, z-score 3.47. The same page also has a churn action list (names blurred) and a data-quality check.")

slide(11, "FINANCE", "Finance sees management-fee revenue by fund and month from one screen",
 side(("revenue", (45, 375, 1749, 895)), "Fee revenue per fund and period, split between AperD and the investment manager, filterable and exportable to Excel.",
      "Finance checks fee income and the partner share without a hand-built sheet. tiur exported 38 revenue-detail files since September.",
      "tiur, audrey, robby, imel, ramano, maureen", 1040),
 "Range 1 Jan to 31 Oct 2026. The AUM series and axis are hidden for the deck. Headline on screen: management fee revenue down 35.9% over the range, Rp 434.6 M (Jan) to Rp 278.7 M (Oct).")

# --- user review slide: usage evidence from the activity log, no invented quotes
Q = '<div style="margin-top:12px;border:1.5px dashed #c9cfe8;border-radius:10px;padding:10px 12px;font-size:13.5px;color:var(--muted);line-height:1.4">In their words: <i>quote to collect from %s before 19 Nov</i></div>'
def col(team, color, rows, who):
    return ('<div style="flex:1;min-width:0;background:#f7f8fc;border:1px solid var(--line);border-top:4px solid ' + color + ';border-radius:12px;padding:16px 18px">'
            '<div style="font-size:20px;font-weight:800">' + team + '</div><div style="font-size:13px;color:var(--muted);margin-top:2px">' + who[0] + '</div>'
            '<ul style="margin:14px 0 0;padding-left:18px;font-size:19px;line-height:1.5">' + ''.join('<li>' + r + '</li>' for r in rows) + '</ul>' + Q % who[1] + '</div>')
slide(12, "USER REVIEW", "Operations, finance and marketing already use the dashboard for routine work",
 '<div style="display:flex;gap:22px;margin-top:26px">'
 + col("Operations", "var(--indigo)", ["audrey: 327 actions on 49 days, mostly 180 investor lookups (portfolio fix) and 146 exports", "robby: 32 actions on 4 days, 24 investor lookups"], ("audrey, robby", "audrey and robby"))
 + col("Finance", "var(--teal)", ["tiur: 40 exports, active on 12 days", "38 of them revenue-detail files in Excel, for fee reconciliation work"], ("tiur", "tiur"))
 + col("Marketing", "var(--amber)", ["hardy: 33 actions on 23 days, 27 product-performance PDFs and 6 Ask questions", "gilang: 9 referral-program exports, active on 15 days"], ("hardy, gilang", "hardy and gilang")) + '</div>',
 "These are measured usage facts from the dashboard activity log, 8 Sep to 15 Nov 2026 (days = days with any logged event, including logins). They are not quotes. The dashed boxes are placeholders: collect one sentence from each team before the meeting, or delete the boxes. I did not find any written feedback in the project history and did not invent any.",
 "Source: dashboard activity log, 8 Sep to 15 Nov 2026. Measured usage, not survey feedback.")

# --- BigQuery cost
Rq = {}
for r in json.loads((here / "bq-cost-q5.json").read_text()):
    Rq.setdefault(r["src"], {})[r["per"]] = r["gib"]
DAYS = {"A": 30, "B": 16, "C": 14}
def n(s, p): return Rq[s][p] * 30 / DAYS[p]
SRC = [("dashboard_app", "Dashboard screens", "Snapshot tables split by date; date filters rewritten so one day reads one slice (15 Oct)"),
       ("connected_sheets", "Connected Sheets", "2 files daily to weekly, 6 files switched off"),
       ("scheduled_query", "Scheduled queries", "2 unused queries switched off"),
       ("metabase", "Metabase", "No change by us; less use"),
       ("adhoc", "Ad-hoc queries", "No change by us; fewer manual runs")]
tot = {p: sum(n(s, p) for s, _, _ in SRC) for p in DAYS}
def bill(p): return max(tot[p] / 1024 - 1, 0) * 7.5 * 18050
rows = ''
for s, lbl, why in SRC:
    a, b, c = n(s, "A"), n(s, "B"), n(s, "C")
    rows += '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td><b>%+.0f%%</b></td><td style="font-weight:400;font-size:13px">%s</td></tr>' % (lbl, f"{a:,.0f}", f"{b:,.0f}", f"{c:,.0f}", (c / a - 1) * 100, why)
rows += '<tr style="background:var(--indigo-tint)"><td>Total GiB</td><td>%s</td><td>%s</td><td>%s</td><td><b>%+.0f%%</b></td><td></td></tr>' % (f"{tot['A']:,.0f}", f"{tot['B']:,.0f}", f"{tot['C']:,.0f}", (tot['C'] / tot['A'] - 1) * 100)
rows += '<tr style="background:var(--indigo-tint)"><td>Bill, Rp</td><td>%s</td><td>%s</td><td>%s</td><td><b>%+.0f%%</b></td><td style="font-weight:400;font-size:13px">%s</td></tr>' % (
    f"{round(bill('A'), -3):,.0f}", f"{round(bill('B'), -3):,.0f}", f"{round(bill('C'), -3):,.0f}", (bill('C') / bill('A') - 1) * 100, "About Rp %.1f M saved per year at the Nov rate (estimate)" % ((bill('A') - bill('C')) * 12 / 1e6))
mx = bill("A")
bars = '<div class="bars" style="height:110px;gap:16px">' + ''.join(
    '<div class="bar"><div class="v" style="font-size:14px">Rp %.2f M</div><div class="b" style="height:%dpx;background:%s"></div></div>' % (bill(p) / 1e6, bill(p) / mx * 80, col_)
    for p, col_ in (("A", "#9aa3d6"), ("B", "#14c687"), ("C", "#34459f"))) + '</div>' \
    '<div class="bar-lbl"><div>Sep</div><div>Late Oct</div><div>Nov 1-14</div></div>'
slide(13, "COST", "The monthly BigQuery bill fell by about 70% after we changed how the dashboard reads data",
 '<div style="margin-top:14px"><div><table class="t" style="font-size:13px;line-height:1.2" id="ct"><tr><th>Source (GiB per 30 days)</th><th>Sep</th><th>Late Oct</th><th>Nov 1&ndash;14</th><th>Change</th><th>What changed</th></tr>' + rows + '</table></div>'
 '<div style="display:flex;gap:30px;margin-top:12px;align-items:flex-end"><div style="width:330px;flex:none"><div style="font-weight:700;font-size:14px;margin-bottom:6px">Estimated monthly bill</div>' + bars + '</div><div style="flex:1">'
 + '<p style="font-size:13px;color:var(--muted);margin:0;line-height:1.35">The dashboard makes about 110,000 queries a month, up from 80,000, but each reads far less data. The bill is lower than Sep because of the 15 Oct changes; Nov is a little above late Oct (dashboard use rose, not yet analysed). The bill falls faster than data read (70% vs 63%) because the first 1 TiB each month is free. Three more savings were identified; if done, the monthly bill could reach about Rp 84,000 (estimate).</p></div></div></div>',
 "BigQuery bills per amount of data read. Source: BigQuery job log (billed bytes), Sep 1-30, Oct 16-31 (16 days) and Nov 1-14 (14 days), each scaled to 30 days. Late Oct is the first stretch after the 15 Oct changes. Dashboard screens: the snapshot tables (portfolios and similar) were split by date and the date filters rewritten; tested identical on 15 of 15 queries; the Largest funds query went from 5.2 GiB to 30 MB. Connected Sheets: two files from daily to weekly, six switched off. Scheduled queries: kalcer and kalcer_fix switched off. Metabase and ad-hoc were not changed. ESTIMATE basis: US$7.50 per TiB, 1 TiB free per month, Rp 18,050 per US$, storage excluded. These are list-price assumptions, not billing records, so check against the Google Cloud invoice. The earlier figure Rp 1,045,000 to about Rp 246,000 used a 14-day baseline; this slide uses calendar periods, so the numbers differ slightly.",
 "Source: BigQuery job log, billed bytes per source. ESTIMATE: US$7.50 per TiB, 1 TiB free per month, Rp 18,050 per US$, storage excluded. Not billing records.")

def box(t, sub, c):
    return '<div style="flex:1;border:2px solid %s;border-radius:12px;padding:22px 14px;text-align:center"><div style="font-weight:800;font-size:20px">%s</div><div style="font-size:16px;color:var(--muted);margin-top:6px;line-height:1.35">%s</div></div>' % (c, t, sub)
def flow(boxes, c):
    return '<div style="display:flex;align-items:center;gap:10px">' + '<div style="font-size:28px;color:#5b66b8">&rarr;</div>'.join(box(t, u, c) for t, u in boxes) + '</div>'
slide(14, "NEXT TARGET", "Next target: finish CI/CD and run releases on Google Cloud instead of one person's computer",
 '<p style="margin:12px 0 0;font-size:15px;color:var(--muted)">CI/CD = every change is tested and released automatically.</p>'
 '<div style="margin-top:22px;font-weight:800;font-size:15px;color:var(--muted)">TODAY</div><div style="margin-top:8px">' + flow([("Change", "written on a computer"), ("Test + release", "one script, run by hand by one person"), ("Live", "dashboard, database, Cloud Run")], "#c9cfe8") + '</div>'
 '<div style="margin-top:14px;font-size:16px;color:var(--muted)">The automatic Google Cloud release exists but is switched off: it failed on every push until the secure Google Cloud login is finished.</div>'
 '<div style="margin-top:26px;font-weight:800;font-size:15px;color:#0a8f61">TARGET</div><div style="margin-top:8px">' + flow([("Approved change", "merged"), ("Auto test", "on Google Cloud, not GitHub"), ("Auto release", "secure login, no stored keys"), ("Live", "with an audit trail")], "#14c687") + '</div>'
 '<div style="margin-top:26px;font-size:18px"><b>Business impact:</b> faster, safer releases; a fix does not wait for one person; same controls as the rest of the platform.</div>',
 "User-stated target: complete CI/CD development and move it to Google Cloud from GitHub. Current state from the repo: the Cloud Run deploy workflow exists but its push trigger is commented out until the keyless Google Cloud login (workload identity federation) is set up; its last runs on 17 Sep were skipped. Today the release is done by a script run on one machine. Some scheduled jobs (monthly review deck, e-statement schedule backup tick, GitHub Pages) also still run on GitHub. Business results are expected benefits, not measured.")

(d / "ai-taskforce-business-support-2026-11.html").write_text('<!doctype html><html><head><meta charset="utf-8"><title>AI at Sayakaya</title><style>' + css + EXTRA + '#ct td{padding:5px 12px!important}.rv{font-size:17px!important}' + '</style></head><body>\n' + "\n".join(slides) + "\n</body></html>")
(d / "ai-taskforce-business-support-2026-11-speaker-notes.md").write_text("# AI at Sayakaya: speaker notes\n\n" + "\n".join("## Slide %d: %s\n%s\n" % (i + 1, re.sub("<[^>]+>", "", t), n_) for i, (t, n_) in enumerate(notes)))
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless=new", "--no-pdf-header-footer", "--print-to-pdf=" + str(d / "AI Taskforce Sayakaya - Business Support.pdf"), "file://" + str(d / "ai-taskforce-business-support-2026-11.html")], check=True, capture_output=True)
print("ok", {p: round(tot[p]) for p in tot}, {p: round(bill(p), -3) for p in tot})
