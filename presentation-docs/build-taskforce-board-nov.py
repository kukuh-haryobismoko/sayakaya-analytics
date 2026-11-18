#!/usr/bin/env python3
"""AI Taskforce, November 2026 (Board, Sayakaya case). Run from presentation-docs/.
Writes ai-taskforce-business-support-2026-11.html + speaker notes, prints the PDF.
Revenue and AUM appear only as indexes/percentages. Usage = activity log 7 Sep-15 Nov, excluding the analytics
owner, test accounts, logins and admin/system actions (all numbers spelled out in the speaker notes)."""
import re, pathlib, subprocess, base64, json

here = pathlib.Path(__file__).parent
sep = (here / "ai-taskforce-september-2026.html").read_text()
css = re.search(r"<style>(.*?)</style>", sep, re.S).group(1)
logo = re.search(r'class="logo-mark" src="([^"]+)"', sep).group(1)
css += """
.slide{padding:44px 72px}.slide h1.title{font-size:34px;margin-top:10px;line-height:1.15}.slide .kicker{font-size:15.5px;margin-top:6px}
.src{position:absolute;bottom:20px;left:72px;right:130px;font-size:11px;color:#8a90a6;line-height:1.4}
.tag{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;border-radius:20px;padding:1px 7px;vertical-align:1px}
.tag.m{background:var(--teal-tint);color:#0a8f61;border:1px solid #b7ecd9}.tag.e{background:var(--amber-tint);color:#9a6f00;border:1px solid #f1dc9a}
.tag.p{background:var(--indigo-tint);color:var(--indigo);border:1px solid #cfd6f7}
.hero{display:flex;gap:28px;margin-top:40px}.hero>div{flex:1;border-top:4px solid var(--indigo);padding-top:14px}
.hero .n{font-size:80px;font-weight:800;letter-spacing:-3px;line-height:1;color:var(--indigo)}.hero .n.g{color:#0a8f61}
.hero .l{font-size:19px;font-weight:700;margin-top:12px;line-height:1.25}.hero .s{font-size:14px;color:var(--muted);margin-top:7px;line-height:1.45}
.frame{border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:0 4px 16px rgba(30,40,90,.12);flex:none}.frame img{display:block;width:100%}
.row{display:flex;gap:18px;align-items:flex-start}.col{flex:1;min-width:0}
.fi{display:flex;gap:26px;margin-top:12px;font-size:14.5px;line-height:1.4}.fi>div{flex:1}.fi .f{color:var(--indigo)}.fi .i{color:#0a8f61}.fi .u{color:var(--muted)}
.mini{background:#f7f8fc;border:1px solid var(--line);border-left:4px solid var(--indigo);border-radius:9px;padding:10px 14px;margin-bottom:6px}
.mini.g{border-left-color:var(--teal)}.mini.a{border-left-color:var(--amber)}.mini.r{border-left-color:var(--rose)}
.mini .h{font-weight:800;font-size:15.5px;line-height:1.25}.mini .b{font-size:13.5px;color:var(--muted);line-height:1.4;margin-top:2px}.big .mini{padding:18px 20px;margin-bottom:14px}.big .mini .h{font-size:20px}.big .mini .b{font-size:16px;line-height:1.45;margin-top:5px}.mini .q{font-size:13px;font-style:italic;margin-top:4px}
table.t{width:100%;border-collapse:collapse;font-size:13.5px}
table.t th{text-align:left;padding:7px 9px;font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;background:var(--indigo-tint);color:var(--indigo)}
table.t td{padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.3}table.t td:first-child{font-weight:700;white-space:nowrap}
.cover h1{font-size:56px;max-width:none}.cover .cover-bottom{margin-top:26px}
.cover .cover-mid{margin-top:-14px}.cover .logo-mark{box-shadow:0 6px 18px rgba(10,20,70,.28)}
"""
M = '<span class="tag m">Measured</span>'
E = '<span class="tag e">Estimate</span>'
P = '<span class="tag p">Proposal</span>'
slides, notes = [], []


def slide(eyebrow, title, kicker, body, note, src=""):
    n = len(slides) + 1
    slides.append('<div class="slide"><div class="eyebrow eyebrow-dash">%s</div><h1 class="title">%s</h1>%s%s%s<div class="page-num">%02d</div></div>'
                  % (eyebrow, title, '<p class="kicker">%s</p>' % kicker if kicker else "", body, '<div class="src">%s</div>' % src if src else "", n))
    notes.append((re.sub("<[^>]+>", "", title), note))


def frame(name, w):
    b = base64.b64encode((here / "shots" / ("n-%s.jpg" % name)).read_bytes()).decode()
    return '<div class="frame" style="width:%dpx"><img src="data:image/jpeg;base64,%s"></div>' % (w, b)


def mini(h, b, c="", q=""):
    return '<div class="mini %s"><div class="h">%s</div><div class="b">%s</div>%s</div>' % (c, h, b, '<div class="q">%s</div>' % q if q else "")


def fi(f, i, u):
    return '<div class="fi"><div><b class="f">Feature</b><br>%s</div><div><b class="i">Business impact</b><br>%s</div><div class="u"><b>Used by</b><br>%s</div></div>' % (f, i, u)


def hbars(rows, w):
    out = ""
    for k, (lab, val, pct) in enumerate(rows):
        c = "#3a50ab" if k == 0 else ("#6f7fd0" if k == 1 else "#14c687")
        out += ('<div style="margin-bottom:9px"><div style="font-size:13px;color:var(--muted)">%s</div>'
                '<div style="display:flex;align-items:center;gap:10px"><div style="height:24px;border-radius:6px;background:%s;width:%.0fpx"></div>'
                '<div style="font-weight:800;font-size:16.5px;white-space:nowrap">%s</div></div></div>') % (lab, c, max(pct, 2) / 100 * (w - 150), val)
    return '<div style="width:%dpx">%s</div>' % (w, out)


def line_chart(w, h):
    labs = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct".split()
    rev = [100, 135, 151, 136, 125, 88, 68, 74, 68, 64]   # management-fee revenue index, Jan = 100
    aum = [100, 91, 92, 79, 62, 43, 35, 43, 34, 35]       # total AUM index, Jan = 100
    l_, r, t, b = 34, 60, 10, 24
    X = lambda i: l_ + i * (w - l_ - r) / 9.0
    Y = lambda v: t + (h - t - b) * (1 - v / 160.0)
    s = '<svg width="%d" height="%d" font-family="inherit">' % (w, h)
    for g in (0, 50, 100, 150):
        s += ('<line x1="%d" x2="%d" y1="%.0f" y2="%.0f" stroke="%s" stroke-width="1"%s/>'
              '<text x="%d" y="%.0f" font-size="12.5" fill="#6b7186" text-anchor="end">%d</text>') % (
            l_, w - r, Y(g), Y(g), "#b9bfd2" if g == 100 else "#e6e8f0", "", l_ - 7, Y(g) + 4, g)
    for i, m in enumerate(labs):
        s += '<text x="%.0f" y="%d" font-size="12.5" fill="#565b6b" text-anchor="middle">%s</text>' % (X(i), h - 4, m)
    for ser, col, dash in ((aum, "#9aa0b8", "6 4"), (rev, "#3a50ab", "")):
        pts = " ".join("%.0f,%.0f" % (X(i), Y(v)) for i, v in enumerate(ser))
        s += '<polyline points="%s" fill="none" stroke="%s" stroke-width="3.5" stroke-linejoin="round"%s/>' % (pts, col, ' stroke-dasharray="%s"' % dash if dash else "")
        s += ('<circle cx="%.0f" cy="%.0f" r="5.5" fill="%s"/><text x="%.0f" y="%.0f" font-size="14" font-weight="800" fill="%s">%d</text>') % (
            X(9), Y(ser[-1]), col, X(9) + 11, Y(ser[-1]) + 5, col if col != "#9aa0b8" else "#565b6b", ser[-1])
    return s + '</svg>'


def week_chart(w, h):
    vals = [52, 40, 42, 58, 60, 31, 42, 40, 77, 93]
    labs = ["7 Sep", "14 Sep", "21 Sep", "28 Sep", "5 Oct", "12 Oct", "19 Oct", "26 Oct", "2 Nov", "9 Nov"]
    bw = (w - 16) / 10.0
    s = '<svg width="%d" height="%d" font-family="inherit">' % (w, h)
    for i, (v, lb) in enumerate(zip(vals, labs)):
        bh = (h - 46) * v / 100.0
        x = 8 + i * bw
        hi = i >= 8
        s += ('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" rx="5" fill="%s"/>'
              '<text x="%.0f" y="%.0f" font-size="13" font-weight="800" text-anchor="middle" fill="%s">%d</text>'
              '<text x="%.0f" y="%d" font-size="10.5" text-anchor="middle" fill="#565b6b">%s</text>') % (
            x + 5, h - 24 - bh, bw - 10, bh, "#3a50ab" if hi else "#c9cfe8",
            x + bw / 2, h - 29 - bh, "#3a50ab" if hi else "#565b6b", v, x + bw / 2, h - 7, lb)
    return s + '</svg>'


# 1 cover
slides.append('<div class="slide cover"><div class="cover-top"><img class="logo-mark" src="%s" alt="Sayakaya"></div>'
              '<div class="cover-mid"><div class="eyebrow-dash">AI Taskforce &middot; Update</div><h1>AI at Sucor Group: the Sayakaya case</h1>'
              '<p class="sub">What the AI assistant built for Sayakaya, a Sucor Group company, has done for the business since September, and what could carry across the Group.</p></div>'
              '<div class="cover-bottom"><span>SUCOR GROUP &middot; SAYAKAYA</span><span>Board of Directors &middot; 19 November 2026</span></div></div>' % logo)
notes.append(("Cover", "Framing: AI implementation inside Sucor Group, with Sayakaya as the case. All evidence is from Sayakaya only; nothing here claims results at other Group companies. Screens come from the live dashboard; revenue and AUM are shown only as percentages; money values and personal names/emails on the screens are blurred."))

# 2 summary
slide("SUMMARY", "AI made Sayakaya's data usable by the whole team",
      "Four numbers from ten weeks of work, 8 September to 18 November 2026.",
      '<div class="hero">'
      '<div><div class="n">224</div><div class="l">changes shipped to the platform in 10 weeks</div><div class="s">New screens, fixes and cost savings, built with the AI assistant.</div><div class="s">' + M + '</div></div>'
      '<div><div class="n">1.9&times;</div><div class="l">weekly dashboard use, last two weeks vs. the eight before</div><div class="s">46 actions a week on average, then 77 and 93. Admin and system actions excluded.</div><div class="s">' + M + '</div></div>'
      '<div><div class="n g">&minus;70%</div><div class="l">monthly cloud data bill after one round of fixes</div><div class="s">Data read fell 63%. The bill is a calculation from usage logs, not an invoice.</div><div class="s">' + E + '</div></div>'
      '<div><div class="n">8 of 11</div><div class="l">colleagues used it, across six teams</div><div class="s">11 logins exist; 8 did real work in the period: operations, finance, marketing, support, product, management.</div><div class="s">' + M + '</div></div></div>' 
      '<div style="margin-top:40px;font-size:18px;line-height:1.45"><b>Why it matters for the Group:</b> one small team, one AI assistant and no new headcount gave a Group company the analytics a larger team would build. Sayakaya is the evidence; other companies are not measured.</div>',
      "224 = commits in the project change history from 8 Sep to 18 Nov, excluding automatic documentation refreshes; fixes are included, so it measures activity, not features. Usage: dashboard activity log 7 Sep-15 Nov, excluding the analytics owner, test accounts, logins and admin/system actions: 535 actions, 8 users; weekly 52, 40, 42, 58, 60, 31, 42, 40, 77, 93 (first eight weeks average 45.6, last two 85). Cost: see slide 8 for the basis. 'No new headcount' is how the analytics function is set up (one person plus the AI assistant), not a measured saving. No hours-saved or revenue effect is claimed anywhere in this deck.",
      "Sources: project change history; dashboard activity log; BigQuery job log (cost estimate, see slide 8).")

# 3 what we built
slide("WHAT WE BUILT", "Six pieces of work, one AI-assisted data platform",
      "What the AI taskforce delivered at Sayakaya since September. Each piece is shown on the next slides.",
      '<div class="big" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px 22px;margin-top:30px">'
      + mini("Ask", "Anyone with access types a question in plain English and gets an answer from live data. Slide 4.")
      + mini("Weekly digest and anomaly scan", "A written management summary, and a flag on days that look unusual. Slide 5.", "g")
      + mini("Growth views", "Sign-up funnel, event booth and promo views for marketing and product. Slide 6.", "a")
      + mini("Access and audit", "Each person sees only their own sections; the company can see who opened or exported what. Slide 9.")
      + mini("One USD rate", "One exchange rate across the platform, shown with its date on every report. Slide 9.", "g")
      + mini("Cloud cost", "The data bill was checked line by line and reduced. Slide 8.", "a")
      + '</div><div style="margin-top:34px;font-size:20px;line-height:1.45"><b>How it was built:</b> by the analytics owner working with an AI assistant. Adoption by colleagues is on slide 7.</div>',
      "Overview of the workstreams; no performance metrics on this slide on purpose. Each item is demonstrated with a live screen or a table on the slides referenced. The Ask, digest and anomaly scan are AI features; access, audit, the USD rate and the cost work were done with the AI assistant's help in building. Keep the focus on the taskforce's work, not on business results.",
      "Source: project change history and dashboard screens shown on slides 4-9.")

# 4 Ask
slide("ASK", "Anyone with access can question the data in plain English",
      "Typed live on the dashboard: users registered and KYC-verified each month since September.",
      '<div style="margin-top:12px">' + frame("ask", 1136) + '</div>'
      + fi("The answer is written from live data. The SQL and the table behind it are one click away, and the tool states what the data does not show.",
           "A manager gets a number without filing a request with the analyst. Adoption is still early: 6 logged questions, all by one person.",
           "maureen, hardy, imel, ramano and the analytics owner"),
      "Question typed live on 18 Nov. Answer: 1,320 registered and 890 KYC verified since September (Sep 130/67, Oct 612/427, Nov 578/396); the tool also says it cannot show why the jump happened or whether the same users were verified. Logged Ask use 7 Sep-15 Nov, excluding the analytics owner: 6 questions by 1 user. Five logins have access. Say plainly that adoption is early and the opportunity is to train the other four.",
      M + " Dashboard Ask, live 18 Nov 2026. Usage: activity log 7 Sep-15 Nov 2026.")

# 5 AI insights
slide("AI INSIGHTS", "AI drafts the weekly digest and flags unusual days",
      "The figures come from the database; the AI only writes the sentences around them.",
      '<div class="row" style="margin-top:12px"><div class="col" style="flex:none;width:560px">' + frame("digest", 560) + '</div>'
      '<div class="col">' + mini("Weekly digest", "One click writes a management summary: AUM, net flow, buys, sells and new users against the week before. Money values blurred here.")
      + mini("Anomaly scan", "Flags days where AUM or buy volume moved outside the normal range (z-score = how many standard deviations from normal).", "g")
      + mini("Business impact", "Problems surface in the same week, not at month end. On 5 Nov the scan flagged AUM and buy volume.", "a")
      + mini("Used by maureen and the analytics owner", "Actual use of this page is not logged, so it is not counted as adoption.", "r") + '</div></div>'
      '<div style="margin-top:10px">' + frame("anomaly", 1136) + '</div>',
      "Live dashboard, 18 Nov. Digest: new users 257 in the last 7 days, up slightly on the week before (238); net flow negative this week and positive the week before; buys fell and sells rose (money values blurred on the screen and not quoted). Anomaly scan: 2026-11-05 flagged for AUM and buy volume, z-score 3.47 on buy volume. The same page also has a churn action list and a data-quality check; not shown (contains names). Access: two logins; no usage is logged for this page.",
      M + " Dashboard AI Insights, live 18 Nov 2026. Money values blurred.")

# 6 growth
slide("GROWTH", "Marketing and product see exactly where new customers drop out",
      "Two views of the same journey: booth events for the sales team, app sign-up for the product team.",
      '<div class="row" style="margin-top:14px;gap:36px"><div class="col"><div style="font-weight:800;font-size:17px;margin-bottom:8px">Booth events: registration to purchase</div>'
      + hbars([("Registered with an event code", "429", 100), ("KYC verified", "313 &middot; 73.0%", 73.0), ("Made a purchase", "40 &middot; 9.3%", 9.3)], 545)
      + '<div style="margin-top:2px">' + frame("booth", 545) + '</div></div>'
      '<div class="col"><div style="font-weight:800;font-size:17px;margin-bottom:8px">App sign-up: start to first buy</div>'
      + hbars([("Started sign-up (phones)", "1,429", 100), ("KYC verified", "59.6%", 59.6), ("Paid a first buy", "8.7%", 8.7)], 545)
      + '<div style="margin-top:2px">' + frame("funnel", 545) + '</div></div></div>'
      '<div style="margin-top:10px;font-size:16px;line-height:1.45"><b style="color:#0a8f61">Business impact:</b> the biggest app drop-off is 83% of verified users who never placed a first buy, so product knows which step to fix first; marketing knows which event codes and sales people convert. <span style="color:var(--muted)">Used by: hardy, gilang, audrey, imel, ramano, maureen.</span></div>',
      "Live screens captured 18 Nov at their default date range. Booth: 429 registered with an event code, 313 KYC verified (73.0%, 36 failed, 80 not processed), 40 made a purchase (9.3% of registered; 34 new, 6 existing), 53 transactions by 40 customers. App funnel: 1,429 phones started sign-up (plus 233 that already had an account), 59.6% KYC verified (851), 8.7% paid a first buy (125, median 0.7 days after starting), biggest drop-off 83% at 'placed a first buy order'. The two funnels measure different things (event-code registrations vs. phones) over different date ranges; do not compare them. Purchase amounts are left out.",
      M + " Dashboard booth-event and product-funnel screens, live 18 Nov 2026, default date range. Counts of registrations/phones, not people.")

# 7 adoption
slide("ADOPTION", "Dashboard use nearly doubled in the last two weeks",
      "Actions a week by real users. Operations, finance, marketing and support use it every week.",
      '<div class="row" style="margin-top:14px;gap:30px"><div style="flex:none;width:600px"><div style="font-weight:800;font-size:15px;margin-bottom:2px">Actions per week</div>' + week_chart(600, 290)
      + '<div style="font-size:12.5px;color:var(--muted);line-height:1.4;margin-top:4px">Excludes the analytics owner, test accounts, logins and admin/system actions. 535 actions, 318 of them exports, by 8 colleagues.</div></div>'
      '<div class="col">'
      + mini("Operations &middot; 331 actions on 50 days", "audrey and robby. 206 investor lookups and 148 exports: corrections and reconciliation in a few clicks.", "", "Paraphrased: &ldquo;It saves us time every day.&rdquo;")
      + mini("Finance &middot; 46 exports, all revenue detail", "tiur, active on 12 days.", "g", "Paraphrased: &ldquo;Month-end checks are faster.&rdquo;")
      + mini("Marketing &middot; 42 actions, incl. 6 Ask", "hardy and gilang: booth, promo and referral results.", "a", "Paraphrased: &ldquo;Results in minutes, not a data request.&rdquo;")
      + mini("Support &middot; 79 exports on 37 days", "cs, pulling investor lists for customer service.", "") + '</div></div>',
      "Weekly actions, Monday weeks: 7 Sep 52, 14 Sep 40, 21 Sep 42, 28 Sep 58, 5 Oct 60, 12 Oct 31, 19 Oct 42, 26 Oct 40, 2 Nov 77, 9 Nov 93. Weekly distinct users 3 to 7. Per login, 7 Sep-15 Nov, same exclusions: audrey 331 actions on 50 days (148 exports, 182 investor lookups), robby 32 (24 lookups), tiur 46 exports on 12 days, hardy 33 (27 exports, 6 Ask), gilang 9 exports, cs 79 exports on 37 days, maureen 3, imel 2. The quoted lines are the analytics owner's summary of each team's feedback (that the dashboard is good and saves time), written as paraphrase: not verbatim and no hours-saved figure is claimed. Why the last two weeks rose is not analysed.",
      M + " Dashboard activity log, 7 Sep-15 Nov 2026. Quotes are a paraphrased summary of team feedback, not verbatim.")

# 8 cost
Rq = {}
for r in json.loads((here / "bq-cost-q5.json").read_text()):
    Rq.setdefault(r["src"], {})[r["per"]] = r["gib"]
DAYS = {"A": 30, "B": 16, "C": 14}
n30 = lambda s, p: Rq[s][p] * 30 / DAYS[p]
SRC = [("dashboard_app", "Dashboard screens", "Snapshot tables split by date; date filters rewritten (15 Oct)"),
       ("connected_sheets", "Connected Sheets", "2 files daily to weekly, 6 switched off"),
       ("scheduled_query", "Scheduled queries", "2 unused queries switched off"),
       ("metabase", "Metabase", "No change by us"), ("adhoc", "Ad-hoc queries", "No change by us")]
tot = {p: sum(n30(s, p) for s, _, _ in SRC) for p in DAYS}
bill = lambda p: max(tot[p] / 1024.0 - 1, 0) * 7.5 * 18050
rows = ""
for s, lbl, why in SRC:
    a, b, c = (n30(s, p) for p in "ABC")
    rows += '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td><b>%+.0f%%</b></td><td style="font-size:11.5px;color:var(--muted)">%s</td></tr>' % (
        lbl, format(a, ",.0f"), format(b, ",.0f"), format(c, ",.0f"), (c / a - 1) * 100, why)
rows += '<tr style="background:var(--indigo-tint)"><td>Total</td><td>%s</td><td>%s</td><td>%s</td><td><b>%+.0f%%</b></td><td></td></tr>' % (
    format(tot["A"], ",.0f"), format(tot["B"], ",.0f"), format(tot["C"], ",.0f"), (tot["C"] / tot["A"] - 1) * 100)
hero = ('<div style="margin-top:2px"><div style="font-size:96px;font-weight:800;letter-spacing:-4px;line-height:1;color:#0a8f61">&minus;70%</div>'
        '<div style="font-size:17px;font-weight:700;margin-top:8px">estimated monthly bill</div>'
        '<div style="font-size:15px;color:var(--muted);margin-top:4px">Rp 1.24M in September<br>Rp 0.37M in the first half of November</div>'
        '<div style="border-top:1px solid var(--line);margin:16px 0 12px"></div>'
        '<div style="font-size:30px;font-weight:800;letter-spacing:-1.5px;color:var(--indigo)">&minus;63%</div>'
        '<div style="font-size:14.5px;font-weight:700;margin-top:4px">data read</div>'
        '<div style="font-size:14px;color:var(--muted);margin-top:2px">10,372 &rarr; 3,793 GiB<br>per 30 days</div>'
        '<div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>'
        '<div style="font-size:13.5px;line-height:1.45"><b>Three more savings identified:</b> about Rp 84,000 a month in total (' + E + ')</div></div>')
slide("COST", "The cloud data bill fell about 70% after one round of fixes",
      "BigQuery (Google's data warehouse) charges by the amount of data a query reads. We changed how the dashboard reads it.",
      '<div class="row" style="margin-top:16px;gap:34px"><div style="flex:none;width:270px">' + hero + '</div>'
      '<div class="col"><div style="font-weight:800;font-size:15px;margin-bottom:7px">Where the data read went, GiB per 30 days</div><table class="t"><tr><th>GiB per 30 days</th><th>Sep</th><th>Late Oct</th><th>1-14 Nov</th><th>Change</th><th>What changed</th></tr>' + rows + '</table>'
      '<div style="font-size:12.5px;color:var(--muted);line-height:1.45;margin-top:8px">The bill falls faster than the data read (&minus;70% vs. &minus;63%) because the first 1 TiB each month is free. November is above late October only because dashboard use rose. Dashboard and Metabase run about 110,000 small queries a month, each reading very little.</div></div></div>',
      "Source: BigQuery job log, billed bytes by source, 1-30 Sep (30 days), 16-31 Oct (16 days), 1-14 Nov (14 days), each scaled to 30 days. Reported: 10,372 GiB falling to 3,793 GiB (-63%); the bill about Rp 1.24 M to Rp 0.37 M (-70%). ESTIMATE basis: US$7.50 per TiB, first 1 TiB per month free, Rp 18,050 per US$, storage excluded; this is not a billing record. What changed: dashboard snapshot tables split by date and date filters rewritten (tested identical on 15 of 15 queries); Connected Sheets two files daily to weekly and six switched off; two unused scheduled queries switched off; Metabase and ad-hoc not changed by us. The Rp 84,000 is the analyst's estimate for three identified savings not yet done.",
      E + " BigQuery job log. Basis: US$7.50/TiB, 1 TiB free per month, Rp 18,050 per US$, storage excluded. Not invoice figures.")

# 9 control
slide("CONTROL", "Everyone sees only their own sections, and every action is logged",
      "AI on company data needs guardrails. Here is what is in place today, and what is still open.",
      '<div class="row" style="margin-top:12px;gap:26px"><div style="flex:none;width:600px">' + frame("admin", 520)
      + '<div style="font-size:12px;color:var(--muted);margin-top:5px">User list: one login per person with an access list per section (the blue chips). Emails blurred.</div></div>'
      '<div class="col">'
      + mini("Access per section", "Each login opens only its own screens; changes apply immediately.", "g")
      + mini("Activity log", "Logins, exports, Ask questions and sensitive views are recorded, so the company can answer who opened or exported what.", "g")
      + mini("AI stays inside the data", "Digest figures come from the database; Ask shows its SQL and states what the data does not show.", "g")
      + mini("One USD rate across the platform", "Per the analytics owner, aligned with Sinvest. Every report and export shows the rate and its date.", "g") + '</div></div>'
      '<div class="row" style="margin-top:2px;gap:22px"><div class="col">' + mini("Open: releases still run by hand", "Versions are released by one person's script. The automatic Google Cloud release exists but stays switched off until its secure login is finished.", "r")
      + '</div><div class="col">' + mini("Open: AI use is still narrow", "Ask: 6 logged questions by one person. Digest and anomaly scan: use not measured.", "r") + '</div></div>',
      "Access is a per-user list of allowed screens; a superuser login exists for the analytics owner. The activity log records logins, exports, Ask questions and sensitive views. Digest figures come from the database and the AI writes only the sentences. USD rate: between 2 and 12 Nov the platform moved USD funds onto one USD/IDR rate (portfolio uses the previous-day rate, revenue the period-end rate); alignment with Sinvest is per the analytics owner and was not independently checked. Open: CI/CD. The Cloud Run workflow's push trigger is off, so today a script on one machine releases; the stated target is to finish CI/CD on Google Cloud. Business benefit of that is expected, not measured.",
      "Sources: dashboard user list and activity log; project change history 2-12 Nov 2026. USD/Sinvest alignment as stated by the analytics owner.")

# 10 next
slide("NEXT", "Where this goes next",
      "What has worked at Sayakaya, and what the taskforce is looking at.",
      '<div class="row big" style="margin-top:24px;gap:40px"><div class="col"><div style="font-weight:800;font-size:14px;color:var(--muted);letter-spacing:1px;margin-bottom:12px">WHAT WORKED AT SAYAKAYA</div>'
      + mini("1. One trusted data layer", "Every team reads the same numbers.") + mini("2. AI on top for the routine work", "Plain-English questions, a written weekly digest, an unusual-day scan.", "g")
      + mini("3. Access and audit from day one", "Per-section access and an activity log.", "a") + mini("4. Cost watched like any other line", "Cloud data bill down about 70% (estimate).", "") + '</div>'
      '<div class="col"><div style="font-weight:800;font-size:14px;color:var(--muted);letter-spacing:1px;margin-bottom:10px">WHAT COMES NEXT</div>'
      '<div style="font-size:21px;line-height:1.5"><p style="margin:0 0 20px"><b>1.</b> Finish CI/CD at Sayakaya, so releases run on Google Cloud, not one person&rsquo;s computer.</p>'
      '<p style="margin:0 0 20px"><b>2.</b> Three more cloud-cost savings, about Rp 84,000 a month in total (estimate).</p>'
      '<p style="margin:0 0 20px"><b>3.</b> Happy to share the approach with other Group companies that are interested. Nothing is scoped yet.</p></div></div></div>',
      "Direction for discussion, not a plan with owners or dates. The only evidence is Sayakaya; do not claim results at other Group companies and do not quote a saving for a second company. CI/CD is the target the analytics owner stated. Sharing the approach is an offer, not a commitment.",
      "Direction for discussion. Evidence: Sayakaya only.")

(here / "ai-taskforce-business-support-2026-11.html").write_text(
    '<!doctype html><html><head><meta charset="utf-8"><title>AI at Sucor Group: the Sayakaya case</title><style>' + css + '</style></head><body>\n'
    + "\n".join(slides) + "\n</body></html>")
(here / "ai-taskforce-business-support-2026-11-speaker-notes.md").write_text(
    "# AI at Sucor Group: the Sayakaya case. Speaker notes\n\n"
    + "\n".join("## Slide %d: %s\n%s\n" % (i + 1, t, n_) for i, (t, n_) in enumerate(notes)))
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
out = here / "AI Taskforce Sayakaya - Business Support.pdf"
subprocess.run([chrome, "--headless=new", "--no-pdf-header-footer", "--print-to-pdf=" + str(out),
                "file://" + str(here / "ai-taskforce-business-support-2026-11.html")], check=True, capture_output=True)
print("slides", len(slides), {p: round(tot[p]) for p in tot}, {p: round(bill(p), -3) for p in tot}, out.stat().st_size)
