#!/usr/bin/env python3
"""October 2026 Monthly Review deck, generated from data.json.

    node presentation-docs/generate-monthly-review-data.js 2026-09 > presentation-docs/design-deck-october/data.json
    python3 presentation-docs/design-deck-october/build-deck.py
    -> deck-print.html (print to PDF with headless Chrome, see README-monthly-review.md)

Every number and chart comes from data.json, so the mid-October refresh is
the two commands above plus a PDF print. The sentences are written for the
data as of 8 Oct 2026; reread the ones marked REVIEW AT REFRESH when the
October figures change (they make claims about the partial month).
Same visual system as the September deck (design-deck-september/).
"""
import html, json, pathlib, sys
from datetime import date, timedelta

here = pathlib.Path(__file__).parent
d = json.loads((pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / "data.json").read_text())

# Last month's deck (Sep 2026) values this deck compares against.
LAST = {"top10": 52.7, "top100": 84.9, "dormant": 81.5, "aug_m1_shown": 28}


def v(x):
    return x["value"] if isinstance(x, dict) and "value" in x else x


def num(x):
    return float(v(x) or 0)


MINUS = "−"


def b(x, sign=False, dp=1):
    """Rupiah -> '260.0 B'."""
    val = num(x) / 1e9
    s = f"{abs(val):,.{dp}f} B"
    if sign:
        return ("+" if val >= 0 else MINUS) + s
    return (MINUS if val < 0 else "") + s


def m(x, dp=1):
    val = num(x) / 1e6
    return (MINUS if val < 0 else "") + f"{abs(val):,.{dp}f} M"


def pct(a, bb, dp=1):
    return f"{num(a) / num(bb) * 100:.{dp}f}%" if num(bb) else "n/a"


def chg(new, old):
    p = (num(new) / num(old) - 1) * 100
    return ("+" if p >= 0 else MINUS) + f"{abs(p):.1f}%"


def intc(x):
    return f"{int(num(x)):,}"


def esc(s):
    return html.escape(str(s))


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def mon(ym):
    return MONTHS[int(ym[5:7]) - 1]


def dlabel(iso):
    dt = date.fromisoformat(str(v(iso))[:10])
    return f"{dt.day} {MONTHS[dt.month - 1]}"


# ---- derived figures -------------------------------------------------------
rev_ym, cmp_ym, part_ym = d["reviewMonth"], d["comparisonMonth"], d["partialMonth"]
REV, CMP, PART = FULL[int(rev_ym[5:]) - 1], FULL[int(cmp_ym[5:]) - 1], FULL[int(part_ym[5:]) - 1]
part_days = d["partialDays"]
part_month_days = 31 if part_ym[5:] in ("01", "03", "05", "07", "08", "10", "12") else 30
through = date.fromisoformat(d["partialThrough"]) - timedelta(days=1)
THROUGH = f"{through.day} {FULL[through.month - 1]}"

aum = {r["ym"]: num(r["avg_nonraiz_aum"]) for r in d["aumTrendByMonth"]}
raiz_aum = {r["ym"]: num(r["avg_raiz_aum"]) for r in d["aumTrendByMonth"]}
revenue = {r["ym"]: num(r["total_aperd"]) * (1 - raiz_aum[r["ym"]] / num(r["avg_total_aum"])) for r in d["revenueTrendByMonth"]}
tx = d["txStats"]
net = {k: num(tx[k]["buy_volume"]) - num(tx[k]["sell_volume"]) for k in tx}
nf = {r["ym"]: r for r in d["netFlowByMonth"]}
pace = lambda x: num(x) / part_days * part_month_days

# Daily AUM, shifted one day: a portfolio_with_code row dated D holds the
# balance at the close of D-1 (same correction as the dashboard's HNWI tab).
daily = [(date.fromisoformat(str(v(r["d"]))) - timedelta(days=1), num(r["aum"])) for r in d["dailyAum"]]
close_today = daily[-1]
close_review_end = next((x for x in daily if x[0].isoformat() == f"{rev_ym}-30" or x[0].isoformat() == f"{rev_ym}-31"), None)
close_cmp_end = daily[0] if daily[0][0].month != int(rev_ym[5:]) else None

acct = d["largestAccount"]
acct_aum = num(acct["profile"]["aum_today"])
conc = d["concentration"]
conc_total = num(conc["total_aum"])
top1_share = acct_aum / conc_total * 100

rc = d["revenueCause"]
pm = d["productMix"]
fund_rate = {r["fund_name"]: num(r["review_aperd"]) / num(r["review_avg_aum"]) * 365 / d["daysInReviewMonth"] * 100 for r in pm}
sw = d["switchFlows"]
top_sw = sw[0]
sw_cost = num(top_sw["amount"]) * (fund_rate.get(top_sw["from_fund"], 0) - fund_rate.get(top_sw["to_fund"], 0)) / 100 / 12

reg = {r["ym"]: r for r in d["registrationsByMonth"]}
r2b = {r["ym"]: r for r in d["regToFirstBuy"]}
refm = {r["ym"]: r for r in d["referralByMonth"]}
coh = [r for r in d["cohortRetention"] if r["cohort_month"] >= "2026-01" and r["cohort_month"] <= rev_ym]
rh = d["retentionHeadline"]
dormant = (1 - rh["bought_last_365d"] / rh["ever_bought"]) * 100

ab = d["appBehavior"]
seg = {r["segment"]: r for r in ab["segments"]}
seg_c = {r["segment"]: r for r in ab["comparisonSegments"]}
app_users = sum(r["app_users"] for r in ab["segments"])
app_buyers = sum(r["buyers"] for r in ab["segments"])
app_buy_amt = sum(num(r["buy_amount"]) for r in ab["segments"])
baseline = ab["features"][0]["baseline_pct"] if ab["features"] else 0
push_named = [p for p in ab["push"] if p["campaign"] != "(no campaign name)"]
push_tx = next((p for p in ab["push"] if p["campaign"] == "(no campaign name)"), None)
push_opens = sum(p["opened_users"] for p in push_named)
push_bought = sum(p["opened_then_bought"] for p in push_named)
push_amt = sum(num(p["opened_buy_amount"]) for p in push_named)
push_recv_avg = sum(p["received_users"] for p in push_named) / max(len(push_named), 1)
intent = ab["intent"]
rq = d["referrerQuality"]
rq_ref = sum(r["referred"] for r in rq)
rq_bought = sum(r["bought"] for r in rq)
rq_top3_buyers = sum(sorted((r["bought"] for r in rq), reverse=True)[:3])
rp = {bool(r["via_referral"]): r for r in d["referralProgram"]["summary"]}
emails = d.get("emails", {})
email_cats = {c["category"]: c["sent"] for c in emails.get("byCategory", [])}
camps = d["campaigns"]
camps_zero = sum(1 for c in camps if not c["used_quota"])
camps_no_bonus = sum(1 for c in camps if c["bonus_amount"] is None)
gam = d["gaMatch"]
adj = {r["channel"]: r for r in d["adjustChannels"]}

GREEN, RED, MUTED = "#07724d", "#c00d3f", "#565b6b"
signc = lambda x: GREEN if num(x) >= 0 else RED


# ---- building blocks -------------------------------------------------------
def head(eyebrow, title, color="#3a50ab", sub=None):
    s = f'<div class="hd"><div class="eb" style="color:{color}">{eyebrow}</div><div class="tt">{title}</div>'
    if sub:
        s += f'<div class="sub">{sub}</div>'
    return s + "</div>"


def callout(text, bar="#3a50ab", label=None, dark=False):
    lab = f'<div class="cl-lab" style="color:{bar if not dark else "#8a99e8"}">{label}</div>' if label else ""
    cls = "callout dark" if dark else "callout"
    return f'<div class="{cls}"><div class="bar" style="background:{bar}"></div><div>{lab}<div class="cl-tx">{text}</div></div></div>'


def kpi(label, value, sub, color="#14161f", sub_color=MUTED):
    return (f'<div class="card kpi"><div class="k-lab">{label}</div><div class="k-val" style="color:{color}">{value}</div>'
            f'<div class="k-sub" style="color:{sub_color}">{sub}</div></div>')


def table(cols, rows, cls="t"):
    th = "".join(f"<th>{c}</th>" for c in cols)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>'


slides = []


def slide(body, dark=False):
    slides.append(f'<div class="slide {"dark" if dark else "light"}">{body}</div>')


# ---- 00 title ---------------------------------------------------------------
slide(f"""
<div class="title-wrap">
  <div style="display:flex;flex-direction:column;gap:20px">
    <div class="eb" style="color:#8a99e8;font-size:14px">Monthly meeting · {PART} 2026</div>
    <div class="big">SayaKaya<br>{PART} Review</div>
    <div style="font-size:21px;color:#b7bdd2;line-height:1.5">{REV} 2026 performance, with {CMP} for comparison. Data through {THROUGH}.</div>
    <div class="eb" style="color:#b7bdd2;font-size:12.5px">Version 1 · an update with {PART} figures through about 21 {PART} follows</div>
  </div>
  {callout('The <strong>RAIZ user segment is excluded from every figure in this deck</strong>, including app behaviour: accounts with a RAIZ or RAIZKAYA referrer code. Every AUM and holdings figure also excludes <strong>Avrist Liquid Fund and Avrist Indeks LQ45</strong>, same as last month. Numbers here will be lower than the dashboard, which counts the full book. <strong>New this month:</strong> app activity from Google Analytics now joins investor records (' + intc(gam["matched"]) + ' of ' + intc(gam["ga_users"]) + ' app user IDs in ' + REV + ' match an account).', "#ffc531", "Read this before the first number", dark=True)}
</div>""", dark=True)

# ---- 01 six numbers ---------------------------------------------------------
excl_rev = num(nf[rev_ym]["net_flow_excl_largest"])
slide(head(f"01 · Where we ended {REV}", "The month in six numbers") + f"""
<div class="grid3">
  {kpi(f"AUM · {mon(rev_ym)} daily avg", b(aum[rev_ym]), f"{chg(aum[rev_ym], aum[cmp_ym])} vs {mon(cmp_ym)} avg", sub_color=signc(aum[rev_ym]-aum[cmp_ym]))}
  {kpi("Platform fee (AperD)", m(revenue[rev_ym]), f"{chg(revenue[rev_ym], revenue[cmp_ym])} vs {mon(cmp_ym)}, while AUM rose", sub_color=signc(revenue[rev_ym]-revenue[cmp_ym]))}
  {kpi("Net flow", b(net['review'], True), f"{b(excl_rev, True)} without one account", color=signc(net['review']), sub_color=MUTED)}
  {kpi("New registrations", intc(reg[rev_ym]['registered']), f"{chg(reg[rev_ym]['registered'], reg[cmp_ym]['registered'])} vs {mon(cmp_ym)}, first rise since January", sub_color=GREEN)}
  {kpi("Active investors (bought in month)", intc(tx['review']['active_investors']), f"down from {intc(tx['comparison']['active_investors'])} in {CMP}; {intc(rh['ever_bought'])} ever bought", sub_color=RED)}
  {kpi(f"AUM · close {dlabel(close_today[0].isoformat())}", b(close_today[1]), f"back after a week at {b(min(x[1] for x in daily))}", sub_color=MUTED)}
</div>
{callout(f"Three of these six numbers are <strong>one account</strong>. It switched Rp 50.7 B into a lower-fee fund on 4 Sep, sold Rp 50.0 B on 29 Sep and bought it back on 6 Oct. Without it, {REV}'s net flow was <strong>{b(excl_rev, True)}</strong>, the second month in a row close to zero after five months of broad outflow. Registrations rose for the first time this year.", "#14c687")}
""")

# ---- 02 trajectory ----------------------------------------------------------
close_cmp = b(close_cmp_end[1]) if close_cmp_end else "-"
close_rev = b(close_review_end[1]) if close_review_end else "-"
traj = [
    ("AUM, daily avg", b(aum[cmp_ym]), b(aum[rev_ym]), b(aum[part_ym]) + "*", "-"),
    ("AUM, last close of the period", close_cmp, close_rev, b(close_today[1]), "-"),
    ("AperD fee revenue", m(revenue[cmp_ym]), m(revenue[rev_ym]), m(revenue[part_ym]), m(pace(revenue[part_ym])) + "*"),
    ("<strong>Net flow</strong>", b(net["comparison"], True), b(net["review"], True), b(net["partial"], True), "-"),
    ("<strong>Net flow, without the largest account</strong>", b(nf[cmp_ym]["net_flow_excl_largest"], True), b(nf[rev_ym]["net_flow_excl_largest"], True), b(nf[part_ym]["net_flow_excl_largest"], True), b(pace(nf[part_ym]["net_flow_excl_largest"]), True)),
    ("Buy volume", b(tx["comparison"]["buy_volume"]), b(tx["review"]["buy_volume"]), b(tx["partial"]["buy_volume"]), "-"),
    ("Sell volume", b(tx["comparison"]["sell_volume"]), b(tx["review"]["sell_volume"]), b(tx["partial"]["sell_volume"]), "-"),
    ("Median buy ticket", m(tx["comparison"]["median_buy_ticket"]), m(tx["review"]["median_buy_ticket"]), m(tx["partial"]["median_buy_ticket"]), "-"),
    ("Investors who bought", intc(tx["comparison"]["active_investors"]), intc(tx["review"]["active_investors"]), intc(tx["partial"]["active_investors"]), "-"),
    ("Registrations", intc(reg[cmp_ym]["registered"]), intc(reg[rev_ym]["registered"]), intc(reg[part_ym]["registered"]), intc(pace(reg[part_ym]["registered"]))),
    ("Signups via referral", intc(refm[cmp_ym]["via_referral"]), intc(refm[rev_ym]["via_referral"]), intc(refm[part_ym]["via_referral"]), intc(pace(refm[part_ym]["via_referral"]))),
]
everyone_aug = num(tx["comparison"]["buy_volume"]) - max(num(nf[cmp_ym]["largest_account_net"]), 0)
slide(f"""
<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px">
  {head("02 · Trajectory", f"{CMP} → {REV} → {PART}")}
  <div class="note" style="max-width:380px;text-align:right">{PART} is {part_days} of {part_month_days} days. Pace scales the {part_days}-day total to a full month; balances and people counts are never projected. Buys, sells and total flow get no pace: one Rp 50 B order makes a projection meaningless. *The Rp 50 B account was out for six of the seven days.</div>
</div>
<div class="card" style="padding:0;overflow:hidden">{table(["Metric", CMP, REV, f"{mon(part_ym)} · {part_days}d", f"{mon(part_ym)} pace"], traj, "t traj")}</div>
{callout(f"Everyone except that account bought <strong>{b(everyone_aug)}</strong> in {CMP} and <strong>{b(tx['review']['buy_volume'])}</strong> in {REV}, {abs((num(tx['review']['buy_volume']) / everyone_aug - 1) * 100):.0f}% less, from almost the same number of buy orders ({intc(tx['comparison']['buy_count'])} → {intc(tx['review']['buy_count'])}). The larger buyers paused; small buying carried on.", "#14c687", "The number nobody will spot on their own")}
""")

# ---- 03 AUM trend -------------------------------------------------------------
months = [k for k in sorted(aum) if k <= rev_ym]
W, H, X0, X1, Y0, Y1 = 1120, 330, 70, 1080, 20, 280
ymin, ymax = 100e9, 650e9
sx = lambda i: X0 + (X1 - X0) * i / len(months)
sy = lambda val: Y1 - (val - ymin) / (ymax - ymin) * (Y1 - Y0)
pts = [(sx(i), sy(aum[k])) for i, k in enumerate(months)]
today_x, today_y = sx(len(months)), sy(close_today[1])
grid = "".join(f'<line class="gl" x1="{X0}" y1="{sy(t*1e9):.1f}" x2="{X1}" y2="{sy(t*1e9):.1f}"/><text class="ax" x="{X0-12}" y="{sy(t*1e9)+5:.1f}" text-anchor="end">{t}</text>' for t in (200, 400, 600))
line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
area = f"{pts[0][0]:.1f},{Y1} " + line + f" {pts[-1][0]:.1f},{Y1}"
labels = "".join(f'<text class="vl" x="{x:.1f}" y="{y-14:.1f}" text-anchor="middle">{num(aum[months[i]])/1e9:.0f}</text>' for i, (x, y) in enumerate(pts) if i in (0, len(pts) - 4, len(pts) - 2, len(pts) - 1))
xlab = "".join(f'<text class="ax" x="{sx(i):.1f}" y="{Y1+28}" text-anchor="middle">{mon(k)}</text>' for i, k in enumerate(months))
svg = f"""<svg viewBox="0 0 {W} {H}" class="chart">{grid}
<polygon points="{area}" fill="#3a50ab" fill-opacity="0.08"/><polyline points="{line}" fill="none" stroke="#3a50ab" stroke-width="3"/>
{''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#3a50ab"/>' for x, y in pts)}
<line x1="{pts[-1][0]:.1f}" y1="{pts[-1][1]:.1f}" x2="{today_x:.1f}" y2="{today_y:.1f}" stroke="#3a50ab" stroke-width="2.5" stroke-dasharray="6 5"/>
<circle cx="{today_x:.1f}" cy="{today_y:.1f}" r="6" fill="#ffffff" stroke="#3a50ab" stroke-width="3"/>
<text class="vl" x="{today_x:.1f}" y="{today_y-16:.1f}" text-anchor="middle">{close_today[1]/1e9:.0f}</text>
{labels}{xlab}<text class="ax" x="{today_x:.1f}" y="{Y1+28}" text-anchor="middle">{dlabel(close_today[0].isoformat())}</text>
<line x1="{X0}" y1="{Y1}" x2="{X1}" y2="{Y1}" stroke="#8a90a3" stroke-width="1.5"/></svg>"""
slide(head(f"01 · Where we ended {REV}", f"AUM has held at 250 to 260 B for three months") + f"""
<div class="card chart-card"><div class="c-lab">Platform AUM, average daily balance per month · Rp billion · excl. RAIZ, 2 funds · last point: close on {dlabel(close_today[0].isoformat())}</div>{svg}</div>
<div class="note">{REV} averaged {b(aum[rev_ym])} ({chg(aum[rev_ym], aum[cmp_ym])}). {PART}'s {part_days}-day average ({b(aum[part_ym])}) is left off the line: the Rp 50 B account was out for six of those days. Its close on {dlabel(close_today[0].isoformat())}, {b(close_today[1])}, is plotted instead.</div>
{callout(f"One account is <strong>{top1_share:.1f}% of AUM today</strong> (Rp {acct_aum/1e9:.1f} B of {conc_total/1e9:.1f} B). Every month-level AUM, flow and fee figure moves with it, so from this deck on, flows are shown with and without the largest account.", "#3a50ab", "Why the line is flat but the month was not")}
""")

# ---- 04 the account -----------------------------------------------------------
dw = [x for x in daily if x[0].month in (int(rev_ym[5:]), int(part_ym[5:]))]
W2, H2, X0, X1, Y0, Y1 = 640, 270, 56, 620, 18, 228
dmin, dmax = 190e9, 270e9
sx2 = lambda i: X0 + (X1 - X0) * i / max(len(dw) - 1, 1)
sy2 = lambda val: Y1 - (min(max(val, dmin), dmax) - dmin) / (dmax - dmin) * (Y1 - Y0)
dpts = [(sx2(i), sy2(val)) for i, (_, val) in enumerate(dw)]
low = [i for i, (_, val) in enumerate(dw) if val < 230e9]
band = f'<rect x="{dpts[low[0]][0]-6:.1f}" y="{Y0}" width="{dpts[low[-1]][0]-dpts[low[0]][0]+12:.1f}" height="{Y1-Y0}" fill="#ff3165" fill-opacity="0.08"/>' if low else ""
ticks2 = "".join(f'<line class="gl" x1="{X0}" y1="{sy2(t*1e9):.1f}" x2="{X1}" y2="{sy2(t*1e9):.1f}"/><text class="ax" x="{X0-10}" y="{sy2(t*1e9)+5:.1f}" text-anchor="end">{t}</text>' for t in (200, 230, 260))
xt2 = "".join(f'<text class="ax" x="{sx2(i):.1f}" y="{Y1+24}" text-anchor="middle">{dlabel(dt.isoformat())}</text>' for i, (dt, _) in enumerate(dw) if dt.day in (1, 15) or i == len(dw) - 1)
ann = ""
if low:
    ann = (f'<text class="ax" x="{dpts[low[0]][0]-10:.1f}" y="{Y1-8}" text-anchor="end" style="fill:#c00d3f">sold 50.0 B</text>'
           f'<text class="ax" x="{dpts[low[-1]][0]-4:.1f}" y="{Y0+14}" text-anchor="end" style="fill:#07724d">bought back</text>')
svg2 = f"""<svg viewBox="0 0 {W2} {H2}" class="chart">{ticks2}{band}
<polyline points="{' '.join(f'{x:.1f},{y:.1f}' for x, y in dpts)}" fill="none" stroke="#3a50ab" stroke-width="2.5"/>
<circle cx="{dpts[-1][0]:.1f}" cy="{dpts[-1][1]:.1f}" r="5" fill="#3a50ab"/>{ann}{xt2}
<line x1="{X0}" y1="{Y1}" x2="{X1}" y2="{Y1}" stroke="#8a90a3" stroke-width="1.5"/></svg>"""
moves, i, mv = acct["moves"], 0, []
big_moves = [x for x in moves if num(x["amount"]) >= 10e9]
while i < len(big_moves):
    x = big_moves[i]
    nxt = big_moves[i + 1] if i + 1 < len(big_moves) else None
    if x["type"] in ("SWITCH_IN", "SWITCH_OUT") and nxt and nxt["type"] in ("SWITCH_IN", "SWITCH_OUT") and v(nxt["d"]) == v(x["d"]):
        out_, in_ = (x, nxt) if x["type"] == "SWITCH_OUT" else (nxt, x)
        mv.append((dlabel(x["d"]), "switched", f"{esc(out_['fund'])} → {esc(in_['fund'])}", b(out_["amount"])))
        i += 2
        continue
    kind = {"buy": "bought", "sell": "sold"}.get(x["type"], x["type"])
    mv.append((dlabel(x["d"]), f'<span style="color:{GREEN if kind == "bought" else RED};font-weight:600">{kind}</span>', esc(x["fund"]), b(x["amount"])))
    i += 1
slide(head("02 · Cause", "One account, Rp 50 B, in and out four times since May", sub=f"Registered {FULL[int(acct['profile']['registered'][5:]) - 1]} {acct['profile']['registered'][:4]}. Its moves of Rp 10 B or more; smaller ones left out. No identities in this deck.") + f"""
<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:20px">
  <div class="card chart-card"><div class="c-lab">Platform AUM at daily close · Rp billion</div>{svg2}</div>
  <div class="card" style="padding:0;overflow:hidden">{table(["Date", "Move", "Fund", "Amount"], mv, "t small moves")}</div>
</div>
<div class="grid3 tight" style="gap:16px">
  {callout(f"Last month we called {CMP}'s {b(net['comparison'], True)} broad participation. <strong>50.0 B of it was this account</strong>; everyone else was {b(nf[cmp_ym]['net_flow_excl_largest'], True)}. Our holdings check compared 31 Jul with 31 Aug, and the money was in place on both dates.", "#c00d3f", "Correction to last month")}
  {callout("Three exits so far, all on the 29th to the 31st of the month (May, July, September). If that holds, expect about <strong>−50 B around 29 to 31 October</strong>. A pattern, not a known plan: worth asking whoever looks after this account.", "#ffc531", "Watch the end of October")}
  {callout(f"At Sharia Balanced's {fund_rate.get('Sucorinvest Sharia Balanced Fund', 0):.2f}% a year to us, Rp 50 B earned about <strong>Rp {50e9*fund_rate.get('Sucorinvest Sharia Balanced Fund', 0)/100/12/1e6:.0f} M a month</strong>, a fifth of fee revenue. In Money Market ({fund_rate.get('Sucorinvest Money Market Fund', 0):.2f}%) it earns about Rp {50e9*fund_rate.get('Sucorinvest Money Market Fund', 0)/100/12/1e6:.0f} M.", "#3a50ab", "What it is worth")}
</div>
""")

# ---- 05 net flow ---------------------------------------------------------------
nm = [k for k in sorted(nf) if k >= "2026-03"]
W3, H3, X0, X1, Y0, Y1 = 1120, 300, 70, 1080, 16, 250
fmin, fmax = -120e9, 60e9
zero = Y1 - (0 - fmin) / (fmax - fmin) * (Y1 - Y0)
sy3 = lambda val: Y1 - (val - fmin) / (fmax - fmin) * (Y1 - Y0)
slot = (X1 - X0) / len(nm)
bars = ""
for i, k in enumerate(nm):
    tot, ex = num(nf[k]["net_flow"]), num(nf[k]["net_flow_excl_largest"])
    cx, bw = X0 + slot * i + slot / 2, slot * 0.56
    y = sy3(max(tot, 0))
    h = abs(sy3(tot) - zero)
    col = "#14c687" if tot >= 0 else "#ff3165"
    partial = k == part_ym
    style = f'fill="none" stroke="{col}" stroke-width="2" stroke-dasharray="5 4"' if partial else f'fill="{col}"'
    bars += f'<rect x="{cx-bw/2:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{max(h, 2):.1f}" rx="4" {style}/>'
    ty = y - 10 if tot >= 0 else y + h + 22
    bars += f'<text class="vl" x="{cx:.1f}" y="{ty:.1f}" text-anchor="middle" fill="{GREEN if tot >= 0 else RED}">{b(tot, True).replace(" B", "")}</text>'
    ey = sy3(ex)
    bars += f'<path d="M{cx:.1f} {ey-9:.1f} L{cx+9:.1f} {ey:.1f} L{cx:.1f} {ey+9:.1f} L{cx-9:.1f} {ey:.1f} Z" fill="#2c3348" stroke="#ffffff" stroke-width="2"/>'
    bars += f'<text class="vl2" x="{cx+14:.1f}" y="{ey+5:.1f}">{b(ex, True).replace(" B", "")}</text>'
    bars += f'<text class="ax" x="{cx:.1f}" y="{Y1+30}" text-anchor="middle">{mon(k)}{" · " + str(part_days) + "d" if partial else ""}</text>'
gl3 = "".join(f'<line class="gl" x1="{X0}" y1="{sy3(t*1e9):.1f}" x2="{X1}" y2="{sy3(t*1e9):.1f}"/><text class="ax" x="{X0-12}" y="{sy3(t*1e9)+5:.1f}" text-anchor="end">{("+" if t > 0 else "") + str(t).replace("-", MINUS)}</text>' for t in (60, -60, -120))
svg3 = f"""<svg viewBox="0 0 {W3} {H3+10}" class="chart">{gl3}<line x1="{X0}" y1="{zero:.1f}" x2="{X1}" y2="{zero:.1f}" stroke="#8a90a3" stroke-width="1.5"/>
<text class="ax" x="{X0-12}" y="{zero+5:.1f}" text-anchor="end">0</text>{bars}</svg>"""
slide(head("02 · Cause", "Without one account, net flow has been close to zero since August") + f"""
<div class="card chart-card"><div class="c-lab" style="display:flex;justify-content:space-between"><span>Net flow, buys minus sells · Rp billion · excl. RAIZ</span>
<span class="legend"><span class="sw" style="background:#14c687"></span><span class="sw" style="background:#ff3165;margin-left:-4px"></span> all accounts &nbsp;&nbsp; <span class="dia"></span> without the largest account that month</span></div>{svg3}</div>
{callout(f"From March to July, flow without the largest account ran {b(nf['2026-07']['net_flow_excl_largest'], True)} to {b(min(num(nf[k]['net_flow_excl_largest']) for k in nm), True)} a month: broad redemptions. Since {CMP} it has been <strong>{b(nf[cmp_ym]['net_flow_excl_largest'], True)}</strong>, <strong>{b(nf[rev_ym]['net_flow_excl_largest'], True)}</strong> and {b(nf[part_ym]['net_flow_excl_largest'], True)} so far in {PART}. The broad outflow stopped in {CMP}; the big swings since then are one account.", "#2c3348")}
""")

# ---- 06 revenue trend ------------------------------------------------------------
rm = [k for k in sorted(revenue) if k >= "2026-02"]
W4, H4, X0, X1, Y0, Y1 = 1120, 290, 70, 1080, 26, 240
rmax = 420e6
sy4 = lambda val: Y1 - val / rmax * (Y1 - Y0)
slot = (X1 - X0) / len(rm)
rb = ""
for i, k in enumerate(rm):
    partial = k == part_ym
    val = pace(revenue[k]) if partial else revenue[k]
    cx, bw = X0 + slot * i + slot / 2, slot * 0.62
    col = "#3a50ab" if k == rev_ym else ("#9aa4d6" if k < cmp_ym else "#6b7ac4")
    y = sy4(val)
    if partial:
        rb += f'<rect x="{cx-bw/2:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{Y1-y:.1f}" rx="4" fill="none" stroke="#8a90a3" stroke-width="2" stroke-dasharray="5 4"/>'
        rb += f'<text class="vl" x="{cx:.1f}" y="{y-10:.1f}" text-anchor="middle" fill="#8a90a3">{val/1e6:.0f} pace</text>'
    else:
        rb += f'<rect x="{cx-bw/2:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{Y1-y:.1f}" rx="4" fill="{col}"/>'
        rb += f'<text class="vl" x="{cx:.1f}" y="{y-10:.1f}" text-anchor="middle">{val/1e6:.0f}</text>'
    rb += f'<text class="ax" x="{cx:.1f}" y="{Y1+28}" text-anchor="middle">{mon(k)}{" · " + str(part_days) + "d" if partial else ""}</text>'
gl4 = "".join(f'<line class="gl" x1="{X0}" y1="{sy4(t*1e6):.1f}" x2="{X1}" y2="{sy4(t*1e6):.1f}"/><text class="ax" x="{X0-12}" y="{sy4(t*1e6)+5:.1f}" text-anchor="end">{t}</text>' for t in (100, 200, 300, 400))
svg4 = f'<svg viewBox="0 0 {W4} {H4+10}" class="chart">{gl4}{rb}<line x1="{X0}" y1="{Y1}" x2="{X1}" y2="{Y1}" stroke="#8a90a3" stroke-width="1.5"/></svg>'
slide(head(f"01 · Where we ended {REV}", f"AUM up {chg(aum[rev_ym], aum[cmp_ym])[1:]}, fee revenue down {chg(revenue[rev_ym], revenue[cmp_ym])[1:]}") + f"""
<div class="card chart-card"><div class="c-lab">Platform fee revenue, AperD share · Rp million per month · excl. RAIZ, 2 funds</div>{svg4}</div>
<div class="note">{REV} earned <strong>{m(revenue[rev_ym])}</strong>, {m(abs(revenue[rev_ym]-revenue[cmp_ym]))} less than {CMP}, even though average AUM rose. {PART}'s {part_days}-day pace ({m(pace(revenue[part_ym]))}) understates the month: the Rp 50 B account was out for six of the seven days. Next: where the money went.</div>
""")

# ---- 07 revenue cause -------------------------------------------------------------
steps = [(CMP, rc["comparison"]["revenue"], None), ("One fewer day", rc["daysEffect"], 1), ("Higher AUM", rc["aumEffect"], 1),
         ("Cheaper fund mix", rc["rateMixEffect"], 1), (REV, rc["review"]["revenue"], None)]
W5, H5, X0, X1, Y0, Y1 = 600, 300, 20, 590, 20, 240
lo, hi = 130e6, 160e6
sy5 = lambda val: Y1 - (val - lo) / (hi - lo) * (Y1 - Y0)
slot = (X1 - X0) / len(steps)
run, wf = 0, ""
for i, (lab, val, delta) in enumerate(steps):
    cx, bw = X0 + slot * i + slot / 2, slot * 0.6
    if delta is None:
        top, bot, col, txt = val, lo, "#3a50ab", f"{val/1e6:.1f}"
        run = val
    else:
        top, bot = max(run, run + val), min(run, run + val)
        col = "#14c687" if val >= 0 else "#ff3165"
        txt = ("+" if val >= 0 else MINUS) + f"{abs(val)/1e6:.1f}"
        run += val
    y, h = sy5(top), sy5(bot) - sy5(top)
    wf += f'<rect x="{cx-bw/2:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{max(h, 2):.1f}" rx="4" fill="{col}"/>'
    wf += f'<text class="vl" x="{cx:.1f}" y="{y-9:.1f}" text-anchor="middle" fill="{"#14161f" if delta is None else (GREEN if val >= 0 else RED)}">{txt}</text>'
    wf += f'<text class="ax" x="{cx:.1f}" y="{Y1+24}" text-anchor="middle" style="font-size:12px">{lab}</text>'
svg5 = f'<svg viewBox="0 0 {W5} {H5}" class="chart">{wf}<line x1="{X0}" y1="{Y1}" x2="{X1}" y2="{Y1}" stroke="#8a90a3" stroke-width="1.5"/></svg>'
swr = [(esc(r["from_fund"]).replace(" Fund", ""), esc(r["to_fund"]).replace(" Fund", ""), intc(r["accounts"]), b(r["amount"])) for r in sw[:5]]
slide(head("02 · Cause", f"The {abs(rc['change'])/1e6:.1f} M went on a cheaper fund mix", sub=f"Revenue = days × average AUM × fee rate, so the change splits exactly into three parts. Average AperD rate across the book: {rc['annualYieldPct']['comparison']:.3f}% → {rc['annualYieldPct']['review']:.3f}% a year.") + f"""
<div style="display:grid;grid-template-columns:minmax(0,0.95fr) minmax(0,1.05fr);gap:20px">
  <div class="card chart-card"><div class="c-lab">AperD revenue, {CMP} to {REV} · Rp million</div>{svg5}</div>
  <div class="card" style="padding:0;overflow:hidden"><div class="c-lab" style="padding:18px 20px 6px">Largest fund switches in {REV}</div>{table(["From", "To", "Accounts", "Amount"], swr, "t small moves2")}</div>
</div>
{callout(f"One rotation did most of it: <strong>{b(top_sw['amount'])}</strong> moved from {esc(top_sw['from_fund'])} ({fund_rate.get(top_sw['from_fund'], 0):.2f}% a year to us) to {esc(top_sw['to_fund'])} ({fund_rate.get(top_sw['to_fund'], 0):.2f}%) across {intc(top_sw['accounts'])} accounts between {dlabel(top_sw['first_day'])} and {dlabel(top_sw['last_day'])}, the Rp 50 B account included. At the new mix that is about <strong>Rp {sw_cost/1e6:.1f} M a month</strong> less in fees. A switch never shows up as an outflow, which is why AUM looked fine.", "#ff3165")}
""")

# ---- 08 concentration ------------------------------------------------------------
t10 = num(conc["top10_aum"]) / conc_total * 100
t100 = num(conc["top100_aum"]) / conc_total * 100
n_acc = int(num(conc["n_accounts_with_aum"]))
segs = [(top1_share, "#2c3348", "1 account", "#ffffff"), (t10 - top1_share, "#3a50ab", "next 9", "#ffffff"),
        (t100 - t10, "#8d9be0", "next 90", "#14161f"), (100 - t100, "#d5daf3", f"other {n_acc - 100:,}", "#14161f")]
share_bar = '<div class="card chart-card"><div class="c-lab">Who holds the book · share of AUM today</div><div class="sbar">' + "".join(
    f'<div style="width:{w:.2f}%;background:{c};color:{tc}"><span>{w:.1f}%</span><small>{lab}</small></div>' for w, c, lab, tc in segs) + "</div></div>"
slide(head("02 · Cause", "One account is a fifth of the book", color="#c00d3f") + f"""
<div class="grid4">
  <div class="card kpi dark-card"><div class="k-lab" style="color:#8a99e8">Largest account, today</div><div class="k-val" style="color:#fff">{top1_share:.1f}%</div><div class="k-sub" style="color:#b7bdd2">Rp {acct_aum/1e9:.1f} B of {conc_total/1e9:.1f} B</div></div>
  {kpi("Top 2 accounts", pct(conc['top2_aum'], conc_total), "of all AUM")}
  {kpi("Top 10", f"{t10:.1f}%", f"{'+' if t10 >= LAST['top10'] else MINUS}{abs(t10-LAST['top10']):.1f} pp vs last month ({LAST['top10']}%)")}
  {kpi("Top 100", f"{t100:.1f}%", f"{'+' if t100 >= LAST['top100'] else MINUS}{abs(t100-LAST['top100']):.1f} pp vs last month ({LAST['top100']}%)")}
</div>
{share_bar}
<div class="grid2">
  <div class="card text-card"><div class="k-lab">The other end of the book</div><div class="tx">{intc(conc['n_accounts_with_aum'])} accounts hold any AUM. <strong>{intc(conc['accounts_under_100k'])} hold under Rp 100,000</strong> and the median is Rp {intc(conc['median_aum'])}. The working base is about <strong>{intc(num(conc['n_accounts_with_aum'])-num(conc['accounts_under_100k']))} accounts</strong> above that floor (1,346 last month).</div></div>
  <div class="card text-card"><div class="k-lab">What this means for reporting</div><div class="tx">With one account at a fifth of AUM, a monthly average mostly reports that account. This deck shows flow with and without the largest account; the dashboard's Top investors tab lists the accounts behind the top-10 share.</div></div>
</div>
""")

# ---- 09 acquisition --------------------------------------------------------------
regs = [k for k in sorted(reg) if k <= part_ym]
reg_rows = []
for k in regs:
    partial = k == part_ym
    rr = reg[k]["registered"]
    reg_rows.append((f"{mon(k)} 2026" + (f" · {part_days}d" if partial else ""), intc(rr), intc(reg[k]["verified_ever"]),
                     intc(r2b[k]["bought_within_30d"]) + (" *" if k >= rev_ym else ""), f"{intc(refm[k]['via_referral'])} ({pct(refm[k]['via_referral'], rr, 0)})"))
org = adj.get("Organic", {})
mgm = adj.get("MGM program", {})
slide(head("03 · Acquisition", "Registrations rose for the first time this year") + f"""
<div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px">
  <div class="card" style="padding:0;overflow:hidden">{table(["Month", "Registered", "Verified (now)", "Bought ≤30d", "Via referral"], reg_rows, "t small")}</div>
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card text-card"><div class="k-lab">{REV} funnel</div><div class="k-val sm">{intc(reg[rev_ym]['registered'])} → {intc(reg[rev_ym]['verified_ever'])} → {intc(r2b[rev_ym]['bought_within_30d'])}</div><div class="tx sm">{pct(reg[rev_ym]['verified_ever'], reg[rev_ym]['registered'], 0)} verified, {pct(r2b[rev_ym]['bought_within_30d'], reg[rev_ym]['registered'], 0)} bought so far. *The 30-day window is still open for late-{REV} signups.</div></div>
    <div class="card text-card"><div class="k-lab">{PART} so far</div><div class="k-val sm" style="color:{GREEN}">{intc(reg[part_ym]['registered'])} in {part_days} days</div><div class="tx sm">Pace {intc(pace(reg[part_ym]['registered']))} for the month, the highest since April. {intc(refm[part_ym]['via_referral'])} came via referral.</div></div>
    <div class="card text-card" style="border-color:#f3c7d3"><div class="k-lab" style="color:{RED}">Channel, partly visible</div><div class="tx sm">Adjust shows install channels: {intc(org.get('installs', 0))} organic and {intc(mgm.get('installs', 0))} from the MGM program in {REV}. Still nothing on the user record, so registrations can't be split by campaign.</div></div>
  </div>
</div>
""")

# ---- 10 referral program -----------------------------------------------------------
via, orgn = rp.get(True, {}), rp.get(False, {})
act_via = num(via.get("activated", 0)) / max(num(via.get("registered", 1)), 1) * 100
act_org = num(orgn.get("activated", 0)) / max(num(orgn.get("registered", 1)), 1) * 100
slide(head("03 · Acquisition", "The referral program, five weeks in", color="#07724d", sub=f"Scoped to the program's launch, 31 Aug through {THROUGH}.") + f"""
<div class="card" style="padding:0;overflow:hidden">{table(["Since launch", "Registered", "Activated", "Rate", "Median invested"], [
    ("Via referral", intc(via.get('registered', 0)), intc(via.get('activated', 0)), f'<span style="color:{GREEN};font-weight:700">{act_via:.1f}%</span>', f"Rp {num(via.get('median_invested', 0))/1e6:.2f} M"),
    ("Organic", intc(orgn.get('registered', 0)), intc(orgn.get('activated', 0)), f"{act_org:.1f}%", f"Rp {num(orgn.get('median_invested', 0))/1e6:.2f} M")], "t big")}</div>
<div class="grid3">
  <div class="card kpi dark-card"><div class="k-val" style="color:#fff">{pct(refm[rev_ym]['via_referral'], reg[rev_ym]['registered'], 0)}</div><div class="k-sub" style="color:#b7bdd2">of {REV}'s registrations came via referral ({intc(refm[rev_ym]['via_referral'])} of {intc(reg[rev_ym]['registered'])}), up from {pct(refm[cmp_ym]['via_referral'], reg[cmp_ym]['registered'], 0)} in {CMP}</div></div>
  <div class="card kpi dark-card"><div class="k-val" style="color:#fff">{act_via/act_org:.1f}×</div><div class="k-sub" style="color:#b7bdd2">more likely to activate than an organic signup over the same weeks</div></div>
  <div class="card kpi dark-card"><div class="k-val" style="color:#fff">{num(via.get('median_invested', 0))/max(num(orgn.get('median_invested', 1)), 1):.1f}×</div><div class="k-sub" style="color:#b7bdd2">more invested at the median</div></div>
</div>
{callout(f"Still small: {intc(via.get('registered', 0))} referred signups in five weeks, {intc(via.get('activated', 0))} of them funded. Strong enough to keep, and the next slide shows it rests on a handful of referrers.", "#ffc531")}
""")

# ---- 11 referrer quality ----------------------------------------------------------
rq_rows = [(f"Referrer #{r['rnk']}", intc(r["referred"]), intc(r["bought"]), pct(r["bought"], r["referred"], 0)) for r in rq[:6]]
rest = rq[6:]
if rest:
    rq_rows.append((f"Everyone else · {len(rest)} referrers", intc(sum(r['referred'] for r in rest)), intc(sum(r['bought'] for r in rest)), pct(sum(r['bought'] for r in rest), sum(r['referred'] for r in rest), 0)))
internal = sum(1 for r in rq if r["internal_domain"])
slide(head("03 · Acquisition, the caution", "Who brings signups is not who brings investors", color="#c00d3f") + f"""
<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:20px">
  <div class="card" style="padding:0;overflow:hidden">{table(["Since launch", "Referred", "Bought", "Rate"], rq_rows, "t small")}</div>
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card kpi"><div class="k-lab">Referrers since launch</div><div class="k-val">{len(rq)}</div><div class="k-sub">{intc(rq_ref)} referred, {intc(rq_bought)} of them bought</div></div>
    <div class="card kpi dark-card"><div class="k-lab" style="color:#8a99e8">Three referrers</div><div class="k-val" style="color:#fff">{rq_top3_buyers} of {rq_bought}</div><div class="k-sub" style="color:#b7bdd2">investors came from three referrers. The busiest referrer brought {rq[0]['referred']} signups and {rq[0]['bought']} investors.</div></div>
  </div>
</div>
{callout(f"Last month's question about the #2 referrer being an internal account: <strong>{'none' if internal == 0 else internal} of the {len(rq)} referrers uses a sayakaya.id email</strong>, and the top six all hold verified accounts with their own buying history. The bonus only pays on a funded first purchase, so signups that never fund cost nothing; the gap between referrers is about who they reach, not fraud.", "#3a50ab", "Closed from last month")}
""")

# ---- 12 app behaviour --------------------------------------------------------------
seg_rows = []
for key, lab in (("holding", "Holding (owns units now)"), ("redeemed", "Redeemed (bought before, holds nothing)"), ("verified_no_buy", "Verified, never bought"), ("not_verified", "Not verified")):
    s, c = seg.get(key), seg_c.get(key)
    if not s:
        continue
    seg_rows.append((lab, intc(s["app_users"]), f"{num(s['avg_sessions']):.1f}", f"{num(s['median_engaged_min']):.1f}", intc(s["buyers"]),
                     f"{num(s['buyer_rate_pct']):.1f}%" + (f' <span class="mut">({num(c["buyer_rate_pct"]):.1f}%)</span>' if c else "")))
vnb = seg.get("verified_no_buy", {})
slide(head("04 · New: app behaviour", "We can now see what investors do in the app", color="#b07400",
           sub=f"Last month's blocker #3 was that Google Analytics did not join to investor records. It does: the app sets user_id to the investor's account at login, and {intc(gam['matched'])} of {intc(gam['ga_users'])} {REV} IDs match. RAIZ ({intc(gam['raiz'])} app users) excluded.") + f"""
<div class="grid3">
  {kpi("Logged-in app users", intc(app_users), f"{intc(sum(r['app_users'] for r in ab['comparisonSegments']))} in {CMP}")}
  {kpi(f"Bought in {REV}", f"{intc(app_buyers)} · {pct(app_buyers, app_users, 1)}", f"{pct(sum(r['buyers'] for r in ab['comparisonSegments']), sum(r['app_users'] for r in ab['comparisonSegments']), 1)} in {CMP}")}
  {kpi("Bought by app users", b(app_buy_amt), f"{b(sum(num(r['buy_amount']) for r in ab['comparisonSegments']))} in {CMP}")}
</div>
<div class="card" style="padding:0;overflow:hidden">{table(["Logged-in app users, " + REV, "People", "Sessions (avg)", "Minutes in app (median)", "Bought in month", f"Bought % ({mon(cmp_ym)})"], seg_rows, "t")}</div>
<div class="grid2">
  {callout(f"<strong>{intc(vnb.get('app_users', 0))} KYC-verified people</strong> spent a median <strong>{num(vnb.get('median_engaged_min', 0)):.1f} minutes</strong> in the app in {REV}, longer than investors ({num(seg['holding']['median_engaged_min']):.1f}), and none bought. The warmest audience we have, and nothing is aimed at them yet.", "#b07400", "The audience nobody is talking to")}
  {callout(f"Investors who sold everything but still open the app bought <strong>{num(seg['redeemed']['buyer_rate_pct']):.1f}%</strong> of the time in {REV}, down from {num(seg_c['redeemed']['buyer_rate_pct']):.1f}% in {CMP}. Holders bought {num(seg['holding']['buyer_rate_pct']):.1f}% ({num(seg_c['holding']['buyer_rate_pct']):.1f}%).", "#3a50ab", "Win-back is getting harder")}
</div>
""")

# ---- 13 feature lift ------------------------------------------------------------------
FEATURES = [("risk_profile_gate_completed", "Completed the risk profile"), ("price_chips", "Tapped an amount chip"), ("top_up_portfolio_click", "Opened top-up on a portfolio"),
            ("search_trigger", "Searched for a fund"), ("kyc_success", "Finished KYC"), ("product_in_portfolio_click", "Opened a fund they hold"),
            ("view_detail_product_click", "Opened a fund's details"), ("redeem_click", "Started a redemption"), ("notification_open", "Opened a push notification"),
            ("simulation_click", "Used the simulator"), ("referral_click", "Opened the referral page")]
fx = {f["event_name"]: f for f in ab["features"]}
frows = [(lab, fx[k]) for k, lab in FEATURES if k in fx]
W6, rowh, LX, BX0, BX1 = 1120, 30, 300, 310, 1000
H6 = rowh * len(frows) + 30
bx = lambda p: BX0 + (BX1 - BX0) * p / 100
fl = f'<line x1="{bx(baseline):.1f}" y1="4" x2="{bx(baseline):.1f}" y2="{H6-14}" stroke="#b07400" stroke-width="2" stroke-dasharray="5 4"/>'
for i, (lab, f) in enumerate(frows):
    y = 10 + i * rowh
    rate = num(f["buy_rate_pct"])
    col = "#3a50ab" if rate >= baseline else "#b9bfd0"
    fl += f'<text class="lab" x="{LX}" y="{y+16}" text-anchor="end">{lab}</text>'
    fl += f'<rect x="{BX0}" y="{y+3}" width="{bx(rate)-BX0:.1f}" height="{rowh-10}" rx="4" fill="{col}"/>'
    fl += f'<text class="vl2" x="{bx(rate)+8:.1f}" y="{y+17}">{rate:.1f}% · {intc(f["users"])} people · {num(f["lift"]):.1f}×</text>'
fl += f'<text class="ax" x="{bx(baseline)+6:.1f}" y="{H6-2}" style="fill:#b07400">every app user {baseline:.0f}%</text>'
slide(head("04 · New: app behaviour", "What buyers do before they buy", color="#b07400",
           sub=f"Share of people who completed a buy within 7 days of first doing each action in {REV}. Steps inside the buy flow itself are left out.") + f"""
<div class="card chart-card"><svg viewBox="0 0 {W6} {H6}" class="chart">{fl}</svg></div>
<div class="grid2">
  {callout(f"Completing the risk profile is the strongest signal outside the buy flow: <strong>{num(fx['risk_profile_gate_completed']['buy_rate_pct']):.1f}%</strong> went on to buy, {num(fx['risk_profile_gate_completed']['lift']):.1f}× the average. Opening a push notification sits <strong>below</strong> average ({num(fx['notification_open']['buy_rate_pct']):.1f}%).", "#3a50ab")}
  {callout("These are habits of people who buy, not proof of what makes them buy. They are useful for choosing who to talk to, not for claiming a feature drives sales.", "#8a90a3", "Read with care")}
</div>
""" if frows else head("04 · New: app behaviour", "What buyers do before they buy"))

# ---- 14 push ------------------------------------------------------------------------
top_push = sorted(push_named, key=lambda p: -p["opened_users"])[:6]
prows = [(esc(p["campaign"].replace("_", " ")), intc(p["received_users"]), intc(p["opened_users"]), intc(p["opened_then_bought"])) for p in top_push]
slide(head("04 · New: app behaviour", f"Campaign pushes reach about {round(push_recv_avg, -2):,.0f} people each; {push_bought} bought after opening one", color="#b07400",
           sub="Received counts Android only (iPhones don't report delivery to Google Analytics); opens count both. Logged-in people, excl. RAIZ.") + f"""
<div style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:20px">
  <div class="card" style="padding:0;overflow:hidden"><div class="c-lab" style="padding:18px 20px 6px">Most-opened campaigns, {REV} · bought = within 72 hours of opening</div>{table(["Campaign", "Received", "Opened", "Bought after"], prows, "t small")}</div>
  <div style="display:flex;flex-direction:column;gap:14px">
    {kpi(f"{len(push_named)} named campaigns", f"{push_opens} opens", f"{push_bought} people bought within 72 hours of opening, Rp {push_amt/1e6:.1f} M in total")}
    {kpi("Transactional pushes (receipts)", f"{pct(push_tx['opened_users'], push_tx['received_users'], 0) if push_tx else 'n/a'} opened", f"{intc(push_tx['opened_users']) if push_tx else 0} of {intc(push_tx['received_users']) if push_tx else 0}: people open messages about their own money")}
  </div>
</div>
{callout(f"Broadcast campaign pushes are not moving money. The data now shows who is warm: {intc(vnb.get('app_users', 0))} verified people browsing without buying, {intent['people']} who started a purchase and stopped. Sending to them instead of everyone is the cheapest test we can run next month.", "#b07400", "Next")}
""")

# ---- 15 fund pages -------------------------------------------------------------------
prow = [(esc(p["fund"]), esc(str(p["fund_type"]).replace("_", " ").title()), intc(p["viewers"]), intc(p["buyers_7d"]),
         f'<strong style="color:{GREEN if num(p["view_to_buy_pct"]) >= 20 else "#14161f"}">{num(p["view_to_buy_pct"]):.1f}%</strong>') for p in ab["products"][:9]]
best = max(ab["products"][:9], key=lambda p: num(p["view_to_buy_pct"]))
most = ab["products"][0]
slide(head("04 · New: app behaviour", "Money market converts; equity gets looked at", color="#b07400",
           sub=f"People who opened a fund's page in {REV}, and how many bought that same fund within 7 days of their first view.") + f"""
<div class="card" style="padding:0;overflow:hidden">{table(["Fund", "Type", "Viewers", "Bought it ≤7d", "Viewer → buyer"], prow, "t small")}</div>
{callout(f"<strong>{esc(best['fund'])}</strong> turned {num(best['view_to_buy_pct']):.1f}% of viewers into buyers. The most-viewed fund, <strong>{esc(most['fund'])}</strong>, converted {num(most['view_to_buy_pct']):.1f}% of {intc(most['viewers'])} viewers. Interest in equity is there; the step from looking to buying is where it stalls.", "#14c687")}
""")

# ---- 16 started buying -----------------------------------------------------------------
slide(head("04 · New: app behaviour", f"{intent['people']} people started buying in {REV} and never paid", color="#b07400") + f"""
<div class="grid3">
  <div class="card kpi dark-card"><div class="k-lab" style="color:#8a99e8">Left at the buy form</div><div class="k-val" style="color:#fff">{intent['byOutcome'].get('no_order', 0)}</div><div class="k-sub" style="color:#b7bdd2">opened the buy form, never created an order</div></div>
  <div class="card kpi dark-card"><div class="k-lab" style="color:#8a99e8">Order expired unpaid</div><div class="k-val" style="color:#fff">{intent['byOutcome'].get('expired', 0) + intent['byOutcome'].get('cancelled', 0)}</div><div class="k-sub" style="color:#b7bdd2">created an order, payment never arrived</div></div>
  {kpi("Already investors", intc(intent['withAum']), f"of the {intent['people']} hold investments today: existing customers, not strangers")}
</div>
<div class="card text-card"><div class="k-lab">How it's counted</div><div class="tx">Opened the buy form or created an order in the app during {REV}, with no paid buy (completed, payment received, or verified) from then until three days after their last try. App events are matched to transactions from ten minutes before the event, because the order row is written a few seconds before the app logs it.</div></div>
{callout("The named list, with contact details, the last fund they looked at and their AUM, is in the dashboard: <strong>User behavior → Started buying, never paid</strong>. It is the most direct follow-up list we have had.", "#14c687", "Use it this week")}
""")

# ---- 17 retention ------------------------------------------------------------------------
crow = []
for r in coh:
    n = r["cohort_size"]
    cells = []
    for kk, off in (("m1", 1), ("m2", 2), ("m3", 3), ("m6", 6)):
        elapsed = (int(rev_ym[:4]) - int(r["cohort_month"][:4])) * 12 + int(rev_ym[5:]) - int(r["cohort_month"][5:])
        cells.append(f"{r[kk]/n*100:.0f}%" if elapsed >= off and n else "-")
    crow.append((f"{mon(r['cohort_month'])} 2026", intc(n), *cells))
aug = next((r for r in coh if r["cohort_month"] == cmp_ym), None)
sepc = next((r for r in coh if r["cohort_month"] == rev_ym), None)
slide(head("05 · Retention", "Repeat buying held; dormancy crept up") + f"""
<div class="grid4">
  {kpi("Registered users", intc(rh['registered']), "excl. RAIZ")}
  {kpi("Ever transacted", intc(rh['ever_bought']), "")}
  {kpi("Bought in the last year", intc(rh['bought_last_365d']), "")}
  {kpi("Dormant over a year", f"{dormant:.1f}%", f"up from {LAST['dormant']}% last month", color=RED, sub_color=RED)}
</div>
<div style="display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:20px">
  <div class="card" style="padding:0;overflow:hidden">{table(["First-buy cohort", "Buyers", "M+1", "M+2", "M+3", "M+6"], crow, "t tiny")}</div>
  <div style="display:flex;flex-direction:column;gap:14px">
    {callout(f"{CMP}'s cohort repeat-bought <strong>{aug['m1']/aug['cohort_size']*100:.0f}%</strong> in its first month now that the month has closed. Last deck showed {LAST['aug_m1_shown']}% partway through.", "#14c687", "Better than it looked") if aug else ""}
    {callout(f"{REV} brought <strong>{intc(sepc['cohort_size'])} first-time buyers</strong>, the most since January, in step with registrations and the referral program.", "#3a50ab") if sepc else ""}
    {callout("A cohort's M+n is the share who bought again n months after their first purchase month. Small cohorts (16 to 40 people) move several points on one or two people.", "#8a90a3", "How to read it")}
  </div>
</div>
""")

# ---- 18 product mix -------------------------------------------------------------------------
MI_SHORT = {"Korea Investment Management Indonesia": "KIM", "Sucor Asset Management": "Sucor", "Pinnacle Persada Investama": "Pinnacle",
            "Trimegah Asset Management": "Trimegah", "Insight Investments Management": "Insight"}
pm_rows = [(esc(r["fund_name"]), esc(MI_SHORT.get(r["mi_name"], r["mi_name"])),
            b(r["comparison_avg_aum"]), b(r["review_avg_aum"]), f"{fund_rate[r['fund_name']]:.2f}%", m(r["review_aperd"])) for r in pm[:9]]
eq = [r for r in pm[:12] if fund_rate[r["fund_name"]] >= 1.5]
mm = pm[0]
mi = d["miConcentration"]
slide(head("05 · Product & revenue mix", "The money moved to the cheapest funds to hold") + f"""
<div class="card" style="padding:0;overflow:hidden">{table(["Fund", "MI", f"{mon(cmp_ym)} avg", f"{mon(rev_ym)} avg", "AperD rate / yr", f"{mon(rev_ym)} AperD"], pm_rows, "t small")}</div>
<div class="grid2">
  {callout(f"{len(eq)} higher-fee funds ({', '.join(esc(r['fund_name']) for r in eq)}) hold <strong>{b(sum(num(r['review_avg_aum']) for r in eq))}</strong> and earn <strong>{m(sum(num(r['review_aperd']) for r in eq))}</strong>; {esc(mm['fund_name'])} holds {b(mm['review_avg_aum'])} and earns {m(mm['review_aperd'])}. A rupiah in those funds is worth about {fund_rate[eq[0]['fund_name']]/fund_rate[mm['fund_name']]:.1f}× a rupiah in money market.", "#14c687") if eq else ""}
  {callout(f"{esc(mi[0]['mi_name'])} manages {mi[0]['n_funds_in_top12']} of our top 12 funds, same as last month.", "#c00d3f", "Concentration risk, still")}
</div>
""")

# ---- 19 new in the dashboard --------------------------------------------------------------
NEW = [
    ("8 Oct", "Email recap", f"Every email the dashboard sends: {intc(emails.get('totals', {}).get('sent', 0))} in {REV} ({intc(email_cats.get('statement', 0))} e-statements, {intc(email_cats.get('fund_performance', 0))} fund performance). Delivered, opened and clicked switch on once SES event publishing is set up."),
    ("8 Oct", "User behavior", "App activity next to transactions and holdings: the app behaviour section of this deck comes from it, plus a timeline for any single investor."),
    ("6 Oct", "Revenue trend", "Revenue by day, week or month, with the days, AUM and fee-mix split used in this deck, and a per-fund drill."),
    ("1 Oct", "Six new data sources", "Dormant win-back, Kalcer ambassadors, Push delivery, Marketing attribution (Adjust), App health (Crashlytics) and Product funnel."),
    ("27 Sep", "Top investors", "Ranking by buys, sells or net deposit, with each investor's share of the period."),
    ("22 to 28 Sep", "Investor tools", "Users transactions search, Event code tracking, and bulk export of many investors' portfolios at once."),
]
nrows = "".join(f'<div class="new-row"><div class="new-date">{dt}</div><div><div class="new-name">{nm_}</div><div class="new-tx">{tx_}</div></div></div>' for dt, nm_, tx_ in NEW)
slide(head("06 · New in the dashboard", "What the team can use from today") + f"""
<div class="card" style="padding:10px 28px">{nrows}</div>
""")

# ---- 20 kpi set ----------------------------------------------------------------------------
def kcard(no, status, title, body, warn=False):
    cls = "kcard warn" if warn else "kcard"
    stc = "#7a5b00" if warn else GREEN
    return f'<div class="{cls}"><div class="k-no" style="color:{stc}">{no:02d} · {status}</div><div class="k-title">{title}</div><div class="k-body">{body}</div></div>'


aug_m1 = f"{aug['m1']/aug['cohort_size']*100:.0f}%" if aug else "n/a"
jul = next((r for r in coh if r["cohort_month"] == "2026-07"), None)
slide(head("07 · Proposal", "The same eight numbers, one month later", sub=f"{REV}'s values, RAIZ excluded. One got clearer (flow, now shown without the largest account); two are still blocked.") + f"""
<div class="grid4" style="gap:16px">
  {kcard(1, "Available", "Net flow", f"{REV}: {b(net['review'], True)}. Without the largest account: {b(excl_rev, True)}.")}
  {kcard(2, "Available", "AperD fee revenue", f"{REV}: {m(revenue[rev_ym])}, {chg(revenue[rev_ym], revenue[cmp_ym])}.")}
  {kcard(3, "Available", "Active investors", f"Bought in {REV}: {intc(tx['review']['active_investors'])}, from {intc(tx['comparison']['active_investors'])}.")}
  {kcard(4, "Available", "Top-100 concentration", f"Today {t100:.1f}% (last month {LAST['top100']}%). Largest account alone {top1_share:.1f}%.")}
  {kcard(5, "Available", "Registration → first buy", f"Within 30 days. {CMP}: {pct(r2b[cmp_ym]['bought_within_30d'], r2b[cmp_ym]['registered'], 0)}; {REV} {pct(r2b[rev_ym]['bought_within_30d'], r2b[rev_ym]['registered'], 0)} so far.")}
  {kcard(6, "Available", "M+1 repeat-buy rate", f"{CMP} cohort, final: {aug_m1}" + (f", from {jul['m1']/jul['cohort_size']*100:.0f}% in July." if jul else "."))}
  {kcard(7, "Partly", "Registrations by channel", f"Adjust shows install channels; still nothing on the user record. Marketing OKR 2.1, fourth month.", True)}
  {kcard(8, "Still blocked", "Campaign net", f"used_quota reads 0 on all {len(camps)} campaigns live in {REV}; bonus_amount missing on {camps_no_bonus}.", True)}
</div>
""")

# ---- 21 summary ------------------------------------------------------------------------------
def srow(label, value, color="#14161f"):
    return f'<div class="srow"><span>{label}</span><span style="color:{color}">{value}</span></div>'


actions = [
    f"<strong>Rp 50 B account</strong>: ask whoever looks after it whether the month-end exits are planned. Three so far, all on the 29th to 31st; the next would land around 29 to 31 Oct.",
    f"<strong>Sharia Balanced → Money Market</strong>: {b(top_sw['amount'])} across {intc(top_sw['accounts'])} accounts cut the fee rate from {rc['annualYieldPct']['comparison']:.3f}% to {rc['annualYieldPct']['review']:.3f}%. Find out whether it was advised.",
    f"<strong>Use the app data</strong>: message the {intc(vnb.get('app_users', 0))} verified non-buyers and the {intent['people']} who started buying (lists in User behavior) instead of broadcast campaign pushes.",
    "<strong>Email tracking</strong>: switch on SES event publishing (about 10 minutes in the AWS console) so Email recap shows delivered, opened and clicked from November.",
    f"<strong>Campaign data</strong>: used_quota still 0 on every campaign, bonus_amount missing on {camps_no_bonus} of {len(camps)}. Second month.",
    "<strong>UTM / channel field</strong> on the user record: still missing; Adjust covers installs only. Fourth month.",
    "<strong>HNWI-support workflow</strong> for accounts over Rp 1 B: no change visible in the data; status needed.",
]
closed = ["Google Analytics now joins to investor records (was blocker #3).", f"Referrer check: none of the {len(rq)} referrers is an internal account."]
slide(head("08 · Summary", f"{REV} in one place, and what needs attention next") + f"""
<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;flex:1;min-height:0">
  <div class="card sum-card">
    <div class="k-lab">The month in numbers</div>
    <div class="s-h">Money</div>
    {srow("AUM, daily avg", f"{b(aum[rev_ym])} {chg(aum[rev_ym], aum[cmp_ym])}", GREEN)}
    {srow("AperD revenue", f"{m(revenue[rev_ym])} {chg(revenue[rev_ym], revenue[cmp_ym])}", RED)}
    {srow("Net flow · without largest account", f"{b(net['review'], True)} · {b(excl_rev, True)}", RED)}
    <div class="s-h">Concentration</div>
    {srow("Largest account · top 100", f"{top1_share:.1f}% · {t100:.1f}%", RED)}
    <div class="s-h">Acquisition</div>
    {srow("Registrations · via referral", f"{intc(reg[rev_ym]['registered'])} · {pct(refm[rev_ym]['via_referral'], reg[rev_ym]['registered'], 0)}", GREEN)}
    {srow("Referral vs organic activation", f"{act_via:.1f}% vs {act_org:.1f}%", GREEN)}
    <div class="s-h">App behaviour (new)</div>
    {srow("Logged-in app users · bought", f"{intc(app_users)} · {pct(app_buyers, app_users, 1)}")}
    {srow("Verified, browsing, not buying", intc(vnb.get('app_users', 0)), "#b07400")}
    {srow("Started buying, never paid", intc(intent['people']), "#b07400")}
    <div class="s-h">Retention</div>
    {srow(f"M+1 repeat-buy, {mon(cmp_ym)} cohort", aug_m1, GREEN)}
    {srow("Dormant over a year", f"{dormant:.1f}%", RED)}
  </div>
  <div class="card sum-card" style="border-left:4px solid #c00d3f">
    <div class="k-lab" style="color:#c00d3f">Action items</div>
    {''.join(f'<div class="act"><span class="act-n">{i+1}</span><span>{a}</span></div>' for i, a in enumerate(actions))}
    <div class="k-lab" style="color:{GREEN};margin-top:10px">Closed since last meeting</div>
    {''.join(f'<div class="act done"><span class="act-n">✓</span><span>{c}</span></div>' for c in closed)}
  </div>
</div>
""")

CSS = """
@page { size: 1280px 720px; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slide { width: 1280px; height: 720px; overflow: hidden; page-break-after: always; break-after: page; position: relative;
  font-family: "Inter", system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; gap: 20px; padding: 52px 64px; }
.slide:last-child { page-break-after: auto; break-after: auto; }
.slide.light { background: #f2f4f9; color: #14161f; }
.slide.dark { background: #2c3348; color: #ffffff; padding: 72px; }
.title-wrap { display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
.big { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 76px; font-weight: 700; line-height: 1.04; letter-spacing: -2px; }
.hd { display: flex; flex-direction: column; gap: 6px; }
.eb { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; }
.tt { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 40px; font-weight: 600; letter-spacing: -1.1px; line-height: 1.1; text-wrap: balance; }
.sub { font-size: 16px; color: #565b6b; line-height: 1.5; max-width: 1120px; }
.note { font-size: 14px; color: #565b6b; line-height: 1.5; }
.card { background: #ffffff; border: 1px solid #dfe3ee; border-radius: 12px; }
.chart-card { padding: 20px 26px 12px; display: flex; flex-direction: column; gap: 8px; }
.c-lab, .k-lab { font-size: 12px; text-transform: uppercase; letter-spacing: 1.2px; color: #565b6b; font-weight: 600; }
.chart { width: 100%; height: auto; display: block; }
.chart .ax { fill: #8a90a3; font-size: 13px; font-family: "JetBrains Mono", ui-monospace, monospace; }
.chart .vl { font-size: 15px; font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 700; fill: #14161f; }
.chart .vl2 { font-size: 13px; font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 600; fill: #2c3348; paint-order: stroke; stroke: #ffffff; stroke-width: 4px; stroke-linejoin: round; }
.chart .vl { paint-order: stroke; stroke: #ffffff; stroke-width: 4px; stroke-linejoin: round; }
.chart .lab { font-size: 14px; fill: #14161f; }
.chart .gl { stroke: #e6e9f2; stroke-width: 1; }
.legend { text-transform: none; letter-spacing: 0; font-weight: 500; color: #565b6b; display: inline-flex; align-items: center; gap: 6px; }
.sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
.dia { display: inline-block; width: 11px; height: 11px; background: #2c3348; transform: rotate(45deg); }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
.kpi { padding: 20px 24px; display: flex; flex-direction: column; gap: 6px; }
.k-val { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 44px; font-weight: 700; letter-spacing: -1.5px; line-height: 1.05; }
.k-val.sm { font-size: 30px; letter-spacing: -0.8px; }
.k-sub { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13.5px; font-weight: 600; line-height: 1.4; }
.dark-card { background: #2c3348; border-color: #2c3348; }
.text-card { padding: 18px 22px; display: flex; flex-direction: column; gap: 8px; }
.tx { font-size: 16.5px; line-height: 1.5; }
.tx.sm { font-size: 14px; color: #3d4252; }
.callout { display: flex; gap: 14px; align-items: stretch; background: #ffffff; border: 1px solid #dfe3ee; border-radius: 12px; padding: 16px 20px; }
.callout.dark { background: transparent; border: 0; padding: 0; }
.callout .bar { width: 4px; border-radius: 2px; flex: 0 0 4px; }
.cl-lab { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
.cl-tx { font-size: 15.5px; line-height: 1.5; }
.callout.dark .cl-tx { font-size: 17px; line-height: 1.6; color: #e8eaf2; max-width: 1060px; }
strong { font-weight: 650; }
table.t { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
table.t th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 1px; color: #565b6b; font-weight: 600; text-align: right; padding: 8px 16px; background: #eef0fc; }
table.t th:first-child, table.t td:first-child { text-align: left; }
table.t td { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 15px; text-align: right; padding: 6px 16px; border-bottom: 1px solid #dfe3ee; }
table.t td:first-child { font-family: "Inter", system-ui, sans-serif; font-weight: 500; }
table.t tr:last-child td { border-bottom: 0; }
table.t.small td { font-size: 13.5px; padding: 6px 14px; }
table.t.small td:nth-child(2), table.t.small td:nth-child(3) { font-family: "Inter", system-ui, sans-serif; }
table.t.tiny td { font-size: 13px; padding: 5px 14px; }
table.t.big td { font-size: 20px; padding: 14px 18px; }
table.t.traj td { padding: 5px 16px; font-size: 14.5px; }
table.t.moves td:first-child { white-space: nowrap; }
table.t.moves td:nth-child(3), table.t.moves th:nth-child(3), table.t.moves2 td:nth-child(2), table.t.moves2 th:nth-child(2) { text-align: left; }
.tight .cl-tx { font-size: 14px; line-height: 1.45; }
.tight .callout { padding: 12px 16px; }
.sbar { display: flex; height: 64px; border-radius: 8px; overflow: hidden; gap: 2px; background: #ffffff; }
.sbar > div { display: flex; flex-direction: column; justify-content: center; padding: 0 12px; min-width: 0; }
.sbar span { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 700; font-size: 16px; }
.sbar small { font-size: 12.5px; white-space: nowrap; }
.mut { color: #8a90a3; font-weight: 500; }
.new-row { display: grid; grid-template-columns: 110px 1fr; gap: 18px; padding: 13px 0; border-bottom: 1px solid #e6e9f2; }
.new-row:last-child { border-bottom: 0; }
.new-date { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; color: #3a50ab; font-weight: 600; padding-top: 3px; }
.new-name { font-size: 18px; font-weight: 650; }
.new-tx { font-size: 15px; color: #3d4252; line-height: 1.45; }
.kcard { background: #fff; border: 1px solid #dfe3ee; border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; min-height: 150px; }
.kcard.warn { background: #fff8e1; border-color: #f2dc9b; }
.k-no { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; }
.k-title { font-size: 18px; font-weight: 650; }
.k-body { font-size: 14px; color: #3d4252; line-height: 1.45; }
.sum-card { padding: 18px 22px; display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
.s-h { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; letter-spacing: 1.3px; text-transform: uppercase; color: #3a50ab; font-weight: 700; margin-top: 8px; }
.srow { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.srow span:last-child { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 700; text-align: right; }
.act { display: grid; grid-template-columns: 22px 1fr; gap: 8px; font-size: 13px; line-height: 1.4; padding: 5px 0; border-bottom: 1px solid #eef0f5; }
.act-n { font-family: "JetBrains Mono", ui-monospace, monospace; color: #c00d3f; font-weight: 700; }
.act.done .act-n { color: #07724d; }
"""

out = here / "deck-print.html"
out.write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SayaKaya {PART} Review</title>
<style>{CSS}</style></head>
<body>
{chr(10).join(slides)}
</body></html>
""")
print(f"wrote {out}: {len(slides)} slides")
