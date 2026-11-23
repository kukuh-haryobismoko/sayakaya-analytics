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


# 1 cover
slides.append(f'''<div class="slide cover"><div class="cover-top"><img class="logo-mark" src="{logo}" alt="Sayakaya"></div>
<div class="cover-mid"><div class="eyebrow-dash">AI Taskforce</div><h1>AI Taskforce Update, November 2026</h1>
<p class="sub">Since September: lower cost, faster answers for leadership, and safer releases</p></div>
<div class="cover-bottom"><span>SAYAKAYA</span><span>Board of Directors &middot; 19 November 2026</span></div></div>''')
notes.append(("Title", "Short update, only what happened after the September report. Five themes, then three decisions. Every figure is tagged Measured, Estimate or Qualitative."))

slide(2, "EXECUTIVE SUMMARY", "More output, a clear cost saving, and tighter control since September",
 '<div class="card-grid" style="margin-top:34px">'
 + card("1. Analytics cost falls about 77%", "Monthly data-query bill: Rp1.25M in September, about Rp0.30M projected after optimisation (an estimate). A much bigger cloud saving (Rp21-24M a month, also an estimate) is identified but not yet acted on.", "teal")
 + card("2. Leaders get answers without waiting", "New AI Insights early-warning tab, a more reliable Ask tab, a daily download funnel, and analysis for the 2027 planning meeting.", "indigo")
 + card("3. Sales and marketing are measured", "Mall booths, promo codes and customer segments now have live numbers. 63,688 customers segmented; 1,807 lapsed investors listed for win-back.", "amber")
 + card("4. Releases are checked, risks stopped early", "20 automated checks must pass before every release. A change that would have loaded the live database was analysed and advised against.", "rose") + '</div>',
 "Four messages. One: cost, with the caveat that the after-figure is a projection. Two: decision support. Three: sales and marketing. Four: control. Detail follows on each theme slide.",
 "Cost: query-cost review (16 Oct 2026; projection from 16 Oct usage). Segments: customer segmentation file, 2 Nov 2026 (after excluding 256,700 mostly unverified accounts).")

slide(3, "RECAP", "September left us with a working, controlled platform",
 '<div class="stat-row" style="margin-top:30px">' + stat("10 \u2192 28", "working tabs, July to September") + stat("6", "major workstreams shipped by September") + stat("1 \u2192 2", "independent deployment targets") + '</div>'
 '<div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:28px">'
 + card("Access and audit", "Personal logins, section-level permissions, and an audit trail of exports.", "indigo")
 + card("Investor communication", "Statements and fund-performance emails sent in one click or on a schedule.", "teal")
 + card("Reports the business already trusts", "Reports mirror official formats; every query carries a cost cap.", "amber")
 + card("Where we stopped", "A platform ready for every division. Since then the work shifted to cost, decisions and reliability.", "rose") + '</div>',
 "One-minute reminder. In September we showed 10 to 28 tabs plus logins, permissions, audit and cost caps. Everything after this slide is new.",
 "Source: AI Taskforce deck, September 2026 (already reported).")

slide(4, "THEME 1 &middot; COST REDUCTION", "Analytics cost is down about 77%, and a far larger cloud saving is now visible",
 f'''<div style="display:flex;gap:48px;margin-top:22px">
<div style="width:420px"><div style="font-weight:700;margin-bottom:12px">Monthly analytics query bill, Rp thousand</div>
<div class="bars"><div class="bar"><div class="v">1,254</div><div class="b" style="height:100%;background:#9aa0b8"></div></div>
<div class="bar"><div class="v" style="color:#0d9467">295</div><div class="b" style="height:23.5%;background:var(--teal)"></div></div></div>
<div class="bar-lbl"><div>September<br>{M}</div><div>After optimisation<br>{E}</div></div>
<p style="margin:14px 0 0;font-size:14px;color:var(--muted);line-height:1.5">About Rp960K saved a month, about Rp11.5M a year. Projection from one day's usage (16 Oct); not yet re-measured on a full month.</p></div>
<div style="flex:1"><div style="font-weight:700">The whole cloud bill is about Rp52M a month (about $2,900) {E}</div>
<p style="margin:10px 0 0;font-size:14.5px;color:var(--muted);line-height:1.5">Analytics queries are only about 2% of it, so the bigger prize is in web hosting, databases and network.</p><div class="ask" style="margin-top:22px"><div class="n" style="font-size:24px">Rp21-24M</div><div><div class="h">More saving a month is identified (about 40-45% of the bill)</div><div class="d">The largest item, about Rp11.2M, is one old hosting version that ran around the clock but served no requests in 30 days. Not yet actioned, to be confirmed.</div></div></div></div></div>''',
 "The analytics queries we optimised are only about 2 percent of the cloud bill, so the bigger prize is elsewhere. The 77 percent is a projection, not a measured month. The Rp21-24M is an estimate: measured 30-day usage times list prices. It is not from invoices, because billing export is not switched on. Decision 1 on the last slide addresses this.",
 "Sources: query-cost review and cloud-cost review (16 Oct 2026). Query bill: logged usage x Jakarta list price ($7.50/TiB, 1 TiB free, Rp18,050/USD fixed at 16 Oct), before VAT and storage. Cloud bill: usage x list price, not invoices (billing export is off).")

slide(5, "THEME 2 &middot; DECISION SUPPORT", "Leadership gets answers and early warnings without waiting on an analyst",
 '<div class="card-grid" style="margin-top:30px">'
 + card("AI Insights tab (new)", "Daily digest, unusual-movement scan, a ranked list of investors whose money is leaving, and a watchdog for data problems. " + Q, "indigo")
 + card("Ask tab, more reliable", "Answers in plain sentences first, only approved actions allowed, out-of-scope questions refused. " + Q, "teal")
 + card("Daily download funnel", "Product funnel tab: daily app downloads by platform (Android, iOS) and how far new users get. " + Q, "amber")
 + card("2027 planning and partner analysis", "Funnel analysis and planning material for the Raker 2026 meeting, plus a revenue-sharing and fund-size forecast for one partner. " + Q, "rose") + '</div>',
 "Decision support means leaders no longer wait for someone to write a query. We have no usage statistics for these tabs, so impact is qualitative. Do not name the partner on screen. Results of the partner analysis and Raker material were not re-verified for this deck.",
 "Sources: AI Insights and Ask release notes (20-25 Oct 2026); Product funnel work (Oct 2026); Raker and partner-analysis work sessions (Oct 2026).")

slide(6, "THEME 3 &middot; SALES &amp; MARKETING", "Campaigns and sales channels are now measured, not guessed",
 f'''<table class="t" style="margin-top:20px"><tr><th>Project</th><th>Business question</th><th>Result so far</th></tr>
<tr><td>Booth events</td><td>Which mall booth brings customers?</td><td>19 Oct-11 Nov: 160 new investor IDs at three booths; 26 customers topped up, Rp148.9M in total (Rp20M from 4 existing customers). {M}</td></tr>
<tr><td>Promo recap</td><td>What did each promo code bring?</td><td>New tab shows purchases and amounts per promo code. {Q}</td></tr>
<tr><td>Customer segments</td><td>Who should we target?</td><td>63,688 customers segmented; 546 promo responders; 1,807 lapsed investors for win-back; 65 high-net-worth investors hold Rp157.7B. {M}</td></tr>
<tr><td>High-net-worth bonus</td><td>Who qualifies?</td><td>18 investors checked: 1 earning (Rp186K so far), 3 qualify but not yet one month in, 2 below the subscription threshold, 12 below the fund-size threshold. {M}</td></tr>
<tr><td>Lapsed-user test</td><td>Does a push message win investors back?</td><td>Report built: investors randomly split into messaged vs not messaged, then watched for 7 days. Uplift not recorded here. {Q}</td></tr>
<tr><td>Referral campaign</td><td>Who earns the Sep-Dec reward?</td><td>Rules checked against data; one display mismatch (23 vs 37 invited) unexplained. {Q}</td></tr></table>''',
 "This theme is about measuring campaigns. Booth numbers are as of 11 Nov. For the lapsed-user test say plainly that the report exists but the uplift was not confirmed in my records. The referral mismatch is unexplained: 23 invited matches the default 1 Sep-31 Dec period, 37 matches the 9 Nov 2025-9 Nov 2026 range on screen.",
 "Sources: booth sales sheet (11 Nov 2026); segmentation file (2 Nov; excludes about 256,700 mostly unverified accounts); bonus report (9 Nov); referral check (Nov). Booths: PIM 25 IDs/Rp6M, Gancit 42/Rp2.6M, Central Park 93/Rp120.3M, existing Rp20M.")

slide(7, "THEME 4 &middot; EFFICIENCY", "Routine reports now refresh themselves, with clear data labels",
 f'''<div class="stat-row" style="margin-top:26px">{stat("Rp273.6M", "October management fees, 11 managers and 87 funds")}{stat("Rp175.1M", "Sayakaya share of those fees")}{stat("05:30", "daily automatic refresh of the monthly review deck")}</div>
<div class="card-grid" style="margin-top:26px">
{card("Revenue by manager on request", "October revenue report produced from live data; inactive funds excluded and totals tie out. " + M, "indigo")}
{card("Management report tab", "Daily downloads, sales and AUM in one view, with manual override. A wrong data-as-of label was found and fixed. " + Q, "teal")}
{card("Email delivery tracking", "Email delivery results (sent, opened, bounced) collected into one tab. " + Q, "amber")}
{card("Clear data-freshness labels", "Tabs now say how fresh their data is, and the transaction view shows the currency. " + Q, "rose")}</div>''',
 "Efficiency theme. The Rp273.6M and Rp175.1M are the October report output, not savings. Hours saved were not recorded, so impact is described qualitatively: reports that were assembled by hand now refresh on their own. Be upfront that the daily deck refresh runs on one Mac (local fallback job), so it skips days when that Mac is off. That is on the risk slide.",
 "Sources: October revenue report (active funds only); scheduled job list; MIS data-as-of fix; email tracking tab. Hours saved were not recorded.")

slide(8, "THEME 5 &middot; RISK CONTROL", "Every release is checked, and risky changes get stopped early",
 f'''<div class="card-grid" style="margin-top:34px">
{card("Automated checks before every release", "20 automated checks run before anything goes live; the release script stops if one fails. " + M, "teal")}
{card("Full-project reviews and bug hunts", "Several whole-project reviews, bug inspections and a browser-driven test pass were run. Counts of issues were not recorded. " + Q, "indigo")}
{card("A costly change avoided", "Reading data live from the production database would have sent about 155,000 requests a month to it, instead of 4,671 scheduled jobs. We advised keeping the current approach. " + M, "amber")}
{card("Safer AI answers", "The Ask tab only performs approved actions and refuses out-of-scope questions. " + Q, "rose")}</div>''',
 "Risk-control theme. The point of the live-database item is that analysis stopped a change that would have put more load on the live database. We did not record the number of bugs found, so we say so rather than guess.",
 "Sources: test list in package.json (20 checks) and release script; live-database analysis (Oct 2026): 155,127 dashboard SELECT jobs vs 4,671 scheduled jobs in 30 days.")

slide(9, "BUSINESS IMPACT", "Hard savings so far are modest; the larger gains are decisions, visibility and control",
 f'''<table class="t" style="margin-top:20px"><tr><th>Measure</th><th>September</th><th>Now</th><th>Basis</th></tr>
<tr><td>Analytics query bill / month</td><td>Rp1.25M</td><td>about Rp0.30M</td><td>{E} projection from 16 Oct usage</td></tr>
<tr><td>Annual saving from that cut</td><td>-</td><td>about Rp11.5M</td><td>{E} 12 x monthly saving</td></tr>
<tr><td>Further cloud saving identified</td><td>not known</td><td>Rp21-24M / month</td><td>{E} usage x list price; not actioned</td></tr>
<tr><td>Dashboard sections</td><td>31</td><td>54</td><td>{M} same code count on 8 Sep and now</td></tr>
<tr><td>Work delivered since 8 Sep</td><td>-</td><td>207 updates on 45 days</td><td>{M} excludes auto-generated documentation</td></tr>
<tr><td>Time saved, revenue impact</td><td colspan="3">Not quantified. Hours were not recorded and no revenue is attributed to this work. Impact is qualitative.</td></tr></table>''',
 "Consolidated view. Green means counted from records; amber is an estimate with its basis. We deliberately do not claim revenue or hours saved. Do not add the two savings together: they come from different parts of the bill, and the second is not yet realised.",
 "Section count: unique sections in the code; it does not match the 28 tabs reported in September, so confirm wording. Updates: 207 code changes on 45 days since 8 Sep, excluding auto-generated documentation.")

slide(10, "RISKS &amp; MITIGATIONS", "The main risks are people and hosting, not the technology",
 '''<table class="t" style="margin-top:22px"><tr><th>Risk</th><th>Why it matters</th><th>Mitigation</th></tr>
<tr><td>Knowledge sits with one analyst</td><td>Absence would slow every update</td><td>Proposed: name a backup owner; documentation is regenerated on every release</td></tr>
<tr><td>Some automations run on one laptop</td><td>Daily jobs skip days when it is off</td><td>Move scheduled jobs to a server</td></tr>
<tr><td>Cost figures are estimates</td><td>No billing export, so invoices cannot be matched</td><td>Switch on billing export; re-measure a full month</td></tr>
<tr><td>AI answers can be wrong</td><td>A wrong number in a decision</td><td>Approved actions only, out-of-scope questions refused</td></tr></table>''',
 "Be direct about the first risk: the platform is largely maintained by one person. It is the reason for decision 2. The second is a fact about how the daily refresh is hosted today. Cost numbers stay estimates until billing export is on.",
 "Sources: scheduled job list; cloud-cost review (billing export not active); Ask tab release notes.")

slide(11, "NEXT STEPS", "Next 90 days: lock in the savings and prove the results",
 f'''<div class="tl" style="margin-top:40px"><div><div class="when">Now &middot; Nov 2026</div><ul><li>Switch on billing export</li><li>Act on the low-risk idle-hosting finding</li><li>Confirm the booth and referral figures</li></ul></div>
<div><div class="when">Dec 2026</div><ul><li>Re-measure analytics cost on a full month</li><li>Referral campaign (Sep-Dec) final check</li><li>Read out the lapsed-user test</li></ul></div>
<div><div class="when">Jan 2027</div><ul><li>Booth event closes; channel results</li><li>Set 2027 targets from the planning meeting</li><li>Move daily refresh off the laptop</li></ul></div></div>
<div class="ask" style="margin-top:46px"><div class="n" style="font-size:24px">-92%</div><div><div class="h">Query bill could reach about Rp100K a month with three optional steps</div><div class="d">Against Rp1.25M in September. {E} Projected 1.74 TiB a month after three further optional steps, on 16 Oct usage.</div></div></div>''',
 "Short horizon on purpose. The first column are actions needing little approval. The booth event and referral campaign have fixed end dates, so their results land in December and January.",
 "Sources: query-cost review (16 Oct 2026); booth and referral work sessions.")

slide(12, "DECISIONS REQUESTED", "Three decisions would turn estimated savings into real ones",
 '''<div style="margin-top:30px">
<div class="ask"><div class="n">1</div><div><div class="h">Authorise the cloud cost clean-up, starting with the unused hosting version</div><div class="d">About Rp11M a month, low risk. Needs engineering sign-off; the analytics team will not change production hosting alone.</div></div></div>
<div class="ask"><div class="n">2</div><div><div class="h">Name a backup owner for the platform</div><div class="d">Removes the single-person dependency on the risk slide.</div></div></div>
<div class="ask"><div class="n">3</div><div><div class="h">Approve cloud billing export</div><div class="d">Replaces estimates with invoice figures in the next report.</div></div></div></div>''',
 "Three decisions, none large. Number one has money attached and needs someone outside analytics to own it. These asks are proposals drafted from the findings; confirm the wording before presenting.")

(here / "ai-taskforce-november-2026.html").write_text(
    f'<!doctype html><html><head><meta charset="utf-8"><title>Sayakaya AI Taskforce - November 2026</title><style>{css}</style></head><body>\n'
    + "\n".join(slides) + "\n</body></html>")
(here / "ai-taskforce-november-2026-speaker-notes.md").write_text(
    "# AI Taskforce Update, November 2026: speaker notes\n\n"
    + "\n".join(f"## Slide {i+1}: {re.sub('<[^>]+>', '', t)}\n{n}\n" for i, (t, n) in enumerate(notes)))
assert len(slides) == 12
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless=new", "--no-pdf-header-footer",
                f"--print-to-pdf={here}/AI Taskforce Sayakaya - November.pdf",
                f"file://{here}/ai-taskforce-november-2026.html"], check=True, capture_output=True)
