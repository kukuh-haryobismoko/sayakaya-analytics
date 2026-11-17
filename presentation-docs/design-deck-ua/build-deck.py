#!/usr/bin/env python3
"""User Acquisition deck, November 2026. Static numbers, pulled from BigQuery on 17 Nov 2026
(queries: sayakaya.main.users / transactions, GA4 analytics_266759216). Styling is borrowed from the
Monthly Review generator so both decks look alike. Output: deck-print.html (gitignored), then print to PDF."""
import re
from pathlib import Path

here = Path(__file__).parent
src = (here.parent / "design-deck-october" / "build-deck.py").read_text()
CSS = src[src.index('CSS = """') + 9:]
CSS = CSS[:CSS.index('"""')]

GREEN, RED, MUTED, BLUE, ORG = "#07724d", "#c00d3f", "#565b6b", "#3a50ab", "#c9cfe0"
pct = lambda a, b: f"{a / b * 100:.1f}%"
pct0 = lambda a, b: f"{a / b * 100:.0f}%"

# ---- data (as of 17 Nov 2026, RAIZ excluded) --------------------------------
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov*"]
M_OTHER = [469, 237, 262, 217, 148, 138, 126, 98, 132, 321, 143]
M_BOOTH = [0] * 9 + [291, 405]
WEEKS = ["31 Aug", "7 Sep", "14 Sep", "21 Sep", "28 Sep", "5 Oct", "12 Oct", "19 Oct", "26 Oct", "2 Nov", "9 Nov", "16 Nov*"]
W_OTHER = [44, 25, 33, 23, 36, 50, 116, 100, 33, 43, 64, 33]
W_BOOTH = [0] * 7 + [167, 142, 157, 196, 34]
# since 19 Oct: regs, verified, funded
B = dict(regs=696, ver=508, fun=48, mat=509, mat_ver=363, mat_f7=35, mat_never=323)
O = dict(regs=273, ver=143, fun=32, mat=190, mat_ver=96, mat_f7=28, mat_never=66)
P = dict(regs=231, ver=171, fun=23, mat=231, mat_f7=11)  # organic 19 Sep - 18 Oct (previous 30 days)
assert sum(W_BOOTH) == B["regs"] and sum(W_OTHER[7:]) == O["regs"]

# ---- building blocks --------------------------------------------------------
def head(eb, title, sub=None):
    s = f'<div class="hd"><div class="eb" style="color:{BLUE}">{eb}</div><div class="tt">{title}</div>'
    return s + (f'<div class="sub">{sub}</div>' if sub else "") + "</div>"

def callout(text, bar=BLUE, label=None, dark=False):
    lab = f'<div class="cl-lab" style="color:{"#8a99e8" if dark else bar}">{label}</div>' if label else ""
    return f'<div class="callout{" dark" if dark else ""}"><div class="bar" style="background:{bar}"></div><div>{lab}<div class="cl-tx">{text}</div></div></div>'

def kpi(label, value, sub, color="#14161f", sub_color=MUTED):
    return (f'<div class="card kpi"><div class="k-lab">{label}</div><div class="k-val" style="color:{color}">{value}</div>'
            f'<div class="k-sub" style="color:{sub_color}">{sub}</div></div>')

def table(cols, rows, cls="t"):
    th = "".join(f"<th>{c}</th>" for c in cols)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>'

def stacked(labels, other, booth, note_idx=(), w=1100, h=290):
    """Stacked bars: organic (grey) under booth (blue). Totals above each bar."""
    top, bot, n = 24, 28, len(labels)
    mx = max(a + b for a, b in zip(other, booth))
    ph = h - top - bot
    slot = w / n
    bw = slot * 0.62
    out = [f'<svg class="chart" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">']
    for i, (lab, o, b) in enumerate(zip(labels, other, booth)):
        x = i * slot + (slot - bw) / 2
        ho, hb = o / mx * ph, b / mx * ph
        yo = h - bot - ho
        out.append(f'<rect x="{x:.1f}" y="{yo:.1f}" width="{bw:.1f}" height="{ho:.1f}" rx="3" fill="{ORG}"/>')
        if b:
            out.append(f'<rect x="{x:.1f}" y="{yo - hb:.1f}" width="{bw:.1f}" height="{hb:.1f}" rx="3" fill="{BLUE}"/>')
        out.append(f'<text class="vl" x="{x + bw / 2:.1f}" y="{yo - hb - 6:.1f}" text-anchor="middle">{o + b}</text>')
        out.append(f'<text class="ax" x="{x + bw / 2:.1f}" y="{h - 8}" text-anchor="middle">{lab}</text>')
    out.append(f'<line x1="0" x2="{w}" y1="{h - bot}" y2="{h - bot}" class="gl"/></svg>')
    return "".join(out)

LEG = (f'<span class="legend"><span class="sw" style="background:{BLUE}"></span>Booth</span> '
       f'<span class="legend" style="margin-left:14px"><span class="sw" style="background:{ORG}"></span>Not booth</span>')

slides = []
def slide(body, dark=False):
    slides.append(f'<div class="slide {"dark" if dark else "light"}">{body}</div>')

# ---- 01 cover ---------------------------------------------------------------
slide(f"""
<div class="title-wrap">
  <div style="display:flex;flex-direction:column;gap:20px">
    <div class="eb" style="color:#8a99e8;font-size:14px">Monthly meeting · November 2026</div>
    <div class="big">SayaKaya<br>User Acquisition</div>
    <div style="font-size:21px;color:#b7bdd2;line-height:1.5">How new users arrive, how booth users differ from everyone else, how they behave in the app, and how this month compares with October. Data through 17 November.</div>
  </div>
  {callout('<strong>Definitions.</strong> RAIZ / RAIZKAYA referrals are excluded everywhere. <strong>Booth user</strong> = registered on or after 19 Oct 2026 with a referrer or sales code from the 29-code booth roster (PIM, GC, CP). <strong>Not booth</strong> = every other registration. <strong>Funded</strong> = made a first purchase that was not a bonus. Figures can differ by a few users from the Booth event tab, which applies its own rules.', label='Read this first', dark=True)}
</div>""", dark=True)

# ---- 02 at a glance ---------------------------------------------------------
tot_regs, tot_fun = B["regs"] + O["regs"], B["fun"] + O["fun"]
wk_after = sum(b + o for b, o in zip(W_BOOTH[7:11], W_OTHER[7:11])) / 4
wk_before = sum(W_OTHER[:5]) / 5
slide(head("01 · Where we are", "User acquisition at a glance", "Booth launched on 19 October. Everything below compares the booth with the rest of the funnel since that day.") + f"""
<div class="grid3">
  {kpi("Registrations since 19 Oct", f"{tot_regs}", f"{B['regs']} booth · {O['regs']} not booth", sub_color=BLUE)}
  {kpi("Sign-ups per week", f"{wk_after:.0f}", f"vs {wk_before:.0f} per week in September · {wk_after / wk_before:.0f}x", sub_color=GREEN)}
  {kpi("Booth share of sign-ups", pct0(B['regs'], tot_regs), f"{B['regs']} of {tot_regs} registrations since 19 Oct")}
  {kpi("Funded since 19 Oct", f"{tot_fun}", f"{B['fun']} booth · {O['fun']} not booth")}
  {kpi("Registered → funded", pct(B['fun'], B['regs']), f"booth, vs {pct(O['fun'], O['regs'])} not booth", color=RED, sub_color=RED)}
  {kpi("First-time buyers, Nov to 17th", "64", "vs 41 in all of October, 29 in September", sub_color=GREEN)}
</div>
{callout("Sign-ups are about <strong>seven times</strong> the September weekly rate and most of them come from the booth. What has not moved with them is purchases: a booth sign-up is <strong>less likely to buy</strong> than anyone else. Reach is solved; conversion is the open question.", label="Headline")}
""")

# ---- 03 monthly trend -------------------------------------------------------
slide(head("02 · Registrations by month", "From about 120 sign-ups a month to 600+", "New registrations, Jan to Nov 2026. October includes 18 days before the booth started.") + f"""
<div class="card chart-card"><div class="c-lab">New registrations per month {LEG}</div>{stacked(MONTHS, M_OTHER, M_BOOTH)}</div>
<div class="grid2">
{callout(f"January was the previous high at <strong>469</strong> and the base slid to 98 by August. Without the booth, November would be {M_OTHER[-1]} so far.", label="Base")}
{callout(f"November is 17 days (*). At the same pace it ends near <strong>{round((M_OTHER[-1] + M_BOOTH[-1]) / 17 * 30, -1):.0f}</strong>, about {(M_OTHER[-1] + M_BOOTH[-1]) / 17 * 30 / M_OTHER[8]:.0f}x September.", bar=GREEN, label="Pace")}
</div>
""")

# ---- 04 weekly --------------------------------------------------------------
slide(head("03 · Week by week", "Booth sign-ups are steady, not a launch spike", "Registrations per week (weeks start Monday). The 16 Nov week is two days only.") + f"""
<div class="card chart-card"><div class="c-lab">Registrations per week {LEG}</div>{stacked(WEEKS, W_OTHER, W_BOOTH)}</div>
<div class="grid2">
{callout("Booth brings <strong>142 to 196 sign-ups a week</strong>, with the busiest week the latest full one (9 Nov, 196).", label="Booth")}
{callout("Not-booth was 23 to 50 a week in September. It jumped to 116 and 100 in the weeks of 12 and 19 Oct, then settled at 33 to 64. Cause of the jump not investigated.", bar=RED, label="Not booth")}
</div>
""")

# ---- 05 funnel --------------------------------------------------------------
def frow(label, a, b, base_a, base_b):
    pa, pb = a / base_a * 100, b / base_b * 100
    return (f'<tr><td>{label}</td><td>{a} <span class="mut">{pa:.0f}%</span></td><td>{b} <span class="mut">{pb:.0f}%</span></td></tr>')
funnel = (f'<table class="t big"><thead><tr><th>Since 19 Oct</th><th style="color:{BLUE}">Booth</th><th>Not booth</th></tr></thead><tbody>'
          + frow("Registered", B["regs"], O["regs"], B["regs"], O["regs"])
          + frow("Verified (KYC approved)", B["ver"], O["ver"], B["regs"], O["regs"])
          + frow("Funded (first purchase)", B["fun"], O["fun"], B["regs"], O["regs"]) + "</tbody></table>")
bm, om = B["mat_never"], O["mat_never"]
slide(head("04 · Booth vs not booth", "Booth users clear KYC more often, then stall before buying", "Share of registrations in each step, users registered on or after 19 Oct.") + f"""
<div class="card" style="padding:8px 12px">{funnel}</div>
<div class="grid2">
{callout(f"<strong>Verification is higher at the booth</strong> ({pct0(B['ver'], B['regs'])} vs {pct0(O['ver'], O['regs'])}).", bar=GREEN, label="Better")}
{callout(f"<strong>Few verified users buy.</strong> Of booth users registered more than 7 days ago and verified ({B['mat_ver']}), {bm} ({pct0(bm, B['mat_ver'])}) have not bought. Not booth: {om} of {O['mat_ver']} ({pct0(om, O['mat_ver'])}).", bar=RED, label="Gap")}
</div>
""")

# ---- 06 vs last month -------------------------------------------------------
pace = lambda x: f"~{round(x / 17 * 30)}"
rows = [
    ("Registrations", "132", "612", "548", pace(548)),
    ("&nbsp;&nbsp;of which booth", "-", "291", "405", pace(405)),
    ("Verified", "68", "427", "374", pace(374)),
    ("First-time buyers (by purchase month)", "29", "41", "64", pace(64)),
    ("&nbsp;&nbsp;of which booth users", "-", "18", "30", pace(30)),
    ("&nbsp;&nbsp;of which other users", "29", "23", "34", pace(34)),
    ("Sign-ups from that month that have bought", "26", "49", "49", "-"),
]
slide(head("05 · Versus last month", "November is already ahead of October on first-time buyers", "Month by month. November covers 1 to 17 Nov; the last column is a straight-line projection to 30 days.") + f"""
<div class="card" style="padding:6px 10px">{table(["", "Sep", "Oct", "Nov (to 17th)", "Nov pace"], rows, "t small")}</div>
{callout("<strong>First-time buyers: 64 in 17 days</strong> against 41 for all of October. Booth users are 30 of them. But non-booth buyers also rose (23 to 34), partly earlier sign-ups finally buying. Oct 'not booth' includes 1 to 18 Oct, before the booth.", label="Read")}
""")

# ---- 07 quality -------------------------------------------------------------
qrows = [
    ("Registrations", f"{B['regs']}", f"{O['regs']}", f"{P['regs']}"),
    ("Verified", pct0(B['ver'], B['regs']), pct0(O['ver'], O['regs']), pct0(P['ver'], P['regs'])),
    ("Bought within 7 days (users older than 7 days)", pct(B['mat_f7'], B['mat']), pct(O['mat_f7'], O['mat']), pct(P['mat_f7'], P['mat'])),
    ("Bought ever (to 17 Nov)", pct(B['fun'], B['regs']), pct(O['fun'], O['regs']), pct(P['fun'], P['regs'])),
    ("Median time from sign-up to first buy", "1 hour", "13 hours", "-"),
    ("Median first ticket (mean)", "Rp 1.0 M (1.4 M)", "Rp 5.0 M (66 M)", "Rp 0.2 M (1.0 M)"),
    ("Purchase attempts that failed", "18% of 71", "30% of 73", "-"),
]
slide(head("06 · Quality of the new users", "Booth buyers buy fast and small; fewer pay attempts fail", "Not booth is shown twice: since the booth began, and the 30 days before it (19 Sep to 18 Oct) as last month's baseline.") + f"""
<div class="card" style="padding:6px 10px">{table(["", f"Booth", "Not booth, since 19 Oct", "Not booth, 19 Sep to 18 Oct"], qrows, "t small")}</div>
{callout("Booth buyers mostly buy <strong>within an hour</strong> of signing up (81% inside 24 hours). The mean for not booth is pulled up by a few very large tickets; the median is the fairer comparison. Booth users get <strong>no sign-up bonus</strong>; 35 not-booth users did, and only 2 of them bought.", label="Read")}
""")

# ---- 08 locations -----------------------------------------------------------
locs = [("Central Park", 389, 283, 32, "1.7 M"), ("Gandaria City", 159, 116, 8, "0.5 M"), ("Pondok Indah Mall", 148, 109, 8, "1.4 M")]
lrows = [(n, r, f"{v} ({pct0(v, r)})", f"{f} ({pct(f, r)})", t) for n, r, v, f, t in locs]
lrows.append(("<strong>All booths</strong>", f"<strong>{B['regs']}</strong>", f"<strong>{B['ver']} ({pct0(B['ver'], B['regs'])})</strong>", f"<strong>{B['fun']} ({pct(B['fun'], B['regs'])})</strong>", "1.4 M"))
slide(head("07 · By booth", "Central Park carries the volume and the conversion", "Booth users since 19 Oct, by mall (from the suffix of the sales or referrer code).") + f"""
<div class="card" style="padding:6px 10px">{table(["Booth", "Registrations", "Verified", "Funded", "Avg first ticket (Rp)"], lrows, "t big")}</div>
{callout("Central Park has <strong>56% of booth sign-ups</strong> and 8.2% of them funded. Gandaria City and Pondok Indah Mall verify as well as Central Park but only 5 to 5.4% buy. Gandaria City tickets are the smallest.", label="Read")}
""")

# ---- 09 app behaviour -------------------------------------------------------
gb, go = 653, 244
arows = [
    ("Users with app events", f"{gb}", f"{go}"),
    ("Completed KYC in app", f"{pct0(533, gb)}", f"{pct0(144, go)}"),
    ("Median minutes from sign-up to KYC start", "9", "10"),
    ("Opened the buy sheet", pct0(60, gb), pct0(43, go)),
    ("Came back after sign-up day", pct0(229, gb), pct0(115, go)),
    ("Came back in the first week", pct0(211, gb), pct0(110, go)),
    ("Sessions per user (mean)", "1.3", "3.5"),
    ("Active days per user (mean)", "1.8", "2.7"),
    ("App removed (GA4 app_remove)", pct0(195, gb), pct0(68, go)),
]
slide(head("08 · In the app", "Booth users sign up, verify, and mostly do not come back", "Google Analytics 4 events of users registered on or after 19 Oct. Shares are of users with at least one event (94% of booth, 89% of not booth).") + f"""
<div class="card" style="padding:6px 10px">{table(["", "Booth", "Not booth"], arows, "t tiny")}</div>
{callout("Booth users finish KYC more often (82% vs 59%), then behave like one-visit users: <strong>1.3 sessions</strong> against 3.5. 35% return after sign-up day, 47% for not booth. The buy sheet is opened by 9% of booth users and 18% of others. Android is 67% of booth users, 63% of not booth.", label="Read")}
""")

# ---- 10 takeaways -----------------------------------------------------------
slide(head("09 · What to take away", "Reach works; the next job is getting verified users to buy") + f"""
<div class="grid2">
  <div class="card text-card"><div class="k-lab" style="color:{GREEN}">What is working</div>
    <div class="tx sm">&bull; Sign-ups up about 7x, steady every week.<br>&bull; Booth KYC completion is high: 73% verified.<br>&bull; Those who buy do it within the hour, with fewer failed payments (18% vs 30%).<br>&bull; November first-time buyers are ahead of all of October.</div></div>
  <div class="card text-card"><div class="k-lab" style="color:{RED}">What is not</div>
    <div class="tx sm">&bull; Only 6.9% of booth sign-ups have bought, vs 11.7% for the rest.<br>&bull; 89% of older verified booth users have not bought.<br>&bull; Low return rate (35%) and 1.3 sessions per user.<br>&bull; Smaller first tickets: median Rp 1.0 M.</div></div>
</div>
{callout(f"<strong>1.</strong> Follow up the {bm} verified booth users who have not bought (message or call-back with a first-purchase nudge).<br><strong>2.</strong> Set a funded target per sales person, not only a sign-up target.<br><strong>3.</strong> Add booth cost to the picture so we can see cost per funded user.<br><strong>4.</strong> Re-run this deck in two weeks: the cohorts of 9 Nov and later are too young to judge (4 funded of 196 so far).", label="Suggested next steps")}
""")

out = here / "deck-print.html"
out.write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SayaKaya User Acquisition, November 2026</title>
<style>{CSS}</style></head>
<body>
{chr(10).join(slides)}
</body></html>
""")
print(f"wrote {out}: {len(slides)} slides")
