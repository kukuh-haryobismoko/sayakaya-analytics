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




d = here
EXTRA = '.card-title{font-size:21px!important}.card-body{font-size:17px!important;line-height:1.5!important}.card-grid{margin-top:44px!important;gap:26px!important}.tl{margin-top:60px!important}.tl ul{font-size:20px!important;line-height:1.7!important}.tl .when{font-size:15px!important}table.t{font-size:15.5px!important}table.t td{padding:11px 14px!important}'
import base64
IMG = here / "shots"
def img(name, cap):
    b = base64.b64encode((IMG / (name + ".jpg")).read_bytes()).decode()
    return ('<figure style="margin:0;flex:1"><img src="data:image/jpeg;base64,' + b + '" style="width:100%;height:370px;object-fit:cover;object-position:top left;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(30,40,90,.10);display:block">'
            '<figcaption style="font-size:15px;color:var(--muted);margin-top:10px;line-height:1.4">' + cap + '</figcaption></figure>')
def row(*figs, who=""):
    w = ('<div style="margin-top:16px;font-size:16px"><b style="color:var(--indigo)">Used by:</b> ' + who + '</div>') if who else ""
    return '<div style="display:flex;gap:28px;margin-top:18px">' + "".join(figs) + '</div>' + w

slides.append('<div class="slide cover"><div class="cover-top"><img class="logo-mark" src="' + logo + '" alt="Sayakaya"></div>'
 '<div class="cover-mid"><div class="eyebrow-dash">AI Taskforce &middot; Update</div><h1>How AI supports the Sayakaya business and its team</h1>'
 '<p class="sub">What we built with the AI assistant since September, shown in the live dashboard. Figures are hidden on purpose.</p></div>'
 '<div class="cover-bottom"><span>SAYAKAYA</span><span>Board of Directors &middot; 19 November 2026</span></div></div>')
notes.append(("Title", "Companion to the numbers deck. This one shows the working dashboard itself and the colleagues who use it. All values in the screenshots are blurred on purpose."))

slide(2, "SUMMARY", "AI turned the analytics team into a service the whole company can use every day",
 '<div class="card-grid" style="margin-top:30px">'
 + card("Everyone works from one place", "Sales, marketing, operations, customer service and management all use the same dashboard, each with their own login and only the sections they need.", "indigo")
 + card("Questions answered in minutes", "Campaign, booth, promo and funnel questions that needed a manual report now have a ready screen, refreshed from live data.", "teal")
 + card("Problems found earlier", "Early-warning checks flag unusual movements, lapsed investors and data issues before month end.", "amber")
 + card("Controlled and traceable", "Every login, export and report sent is recorded, and access is granted per section.", "rose") + '</div>',
 "Four messages. The rest of the deck proves each one with a real screen. Colleagues named later are login names; I inferred their function from the sections they can open, so confirm roles before presenting.")

slide(3, "WHO USES IT", "Eleven Sayakaya logins work in the dashboard, from operations to campaigns to management",
 '<table class="t" style="margin-top:22px"><tr><th>Team (inferred from access)</th><th>Logins</th><th>Sections they use</th></tr>'
 '<tr><td>Analytics owner</td><td>kukuh</td><td>Full access. Builds and reviews every feature, manages access, sends scheduled reports.</td></tr>'
 '<tr><td>Management</td><td>maureen</td><td>Full access incl. AI Insights, Ask, booth and promo views, monthly review, presentation.</td></tr>'
 '<tr><td>Operations and reconciliation</td><td>audrey, robby, tiur</td><td>Portfolio fix, reconciliation, revenue, partner revenue, booth and referral views.</td></tr>'
 '<tr><td>Marketing and sales campaigns</td><td>hardy, gilang</td><td>Booth events, promo recap, referral, push, bonus lists. Hardy also has Ask.</td></tr>'
 '<tr><td>Customer service</td><td>cs</td><td>Overview, growth, investor lists and explorer. Most frequent logins.</td></tr>'
 '<tr><td>Analysts, broad access</td><td>imel, ramano</td><td>Funnel, win-back, email tracking, engagement, Ask, monthly review.</td></tr>'
 '<tr><td>Viewer</td><td>guest</td><td>Presentation tab only, for decks like this one.</td></tr></table>'
 '<p style="margin:12px 0 0;font-size:12.5px;color:var(--muted)">Team labels are inferred from each login\'s access list; the system stores no job titles. No usage counts shown.</p>',
 "Source: dashboard user list (11 logins) and activity log since September. Team labels are my inference from which sections each login can open, not recorded roles. Confirm with each person or edit before the meeting. Activity since September: kukuh, audrey and cs are the heaviest; guest is lightest. Logins are personal data: consider showing team names only.")

slide(4, "ONE PLATFORM, SAFE ACCESS", "Each colleague gets only the sections they need, and every action leaves a trail",
 row(img("admin", "Manage users: each login has a per-section access list. Names and emails are blurred."),
     img("activity-log", "Activity log: who logged in, exported or opened a sensitive view. Rows are blurred."),
     who="kukuh administers access (administrators only). Everyone else works inside their own permissions."),
 "Why it matters: investor data is sensitive. Access is per section, takes effect immediately, and exports and sensitive views are recorded. This was already introduced in September; here it shows it is in daily use.")

slide(5, "GROWTH", "Marketing and sales can see what each booth and promo actually delivered",
 row(img("booth-event", "Booth event: sign-ups to first top-up by booth and sales person, with the top funds bought."),
     img("promo-recap", "Promo recap: who bought with a promo code, who qualifies, bonus owed vs sent, fees earned."),
     who="Booth: audrey, hardy, ramano, maureen. Promo recap: hardy, gilang, ramano, maureen (access list)."),
 "Business problem: booths and promo codes cost money and effort, and results were tracked by hand. Now the funnel from registration to first purchase and the promo bonus status are on one screen. Values are blurred. Use the numbers deck if the Board asks for results.")

slide(6, "RETENTION", "The team can see where new users drop out and which lapsed investors to win back",
 row(img("product-funnel", "Sign-up funnel: from sign-up to first paid purchase, by phone platform, with the biggest drop-off highlighted."),
     img("dormant", "Dormant win-back: how long investors were inactive and how many came back."),
     who="Funnel and win-back: imel, ramano, maureen (access list)."),
 "Business problem: growth stalls when new users stop before the first purchase and when existing ones go quiet. These two screens point the team to the step to fix and to the group of people to contact.")

slide(7, "DECISION SUPPORT", "Anyone can ask a business question in plain words and get an early warning without waiting for an analyst",
 row(img("ai-insights", "AI Insights: weekly digest, unusual-movement scan, churn action list and data-quality checks, one click each."),
     img("ask", "Ask: type a question in everyday language, get a table and the source. Restricted columns stay hidden by default."),
     who="AI Insights: maureen, kukuh. Ask: hardy, imel, ramano, maureen, kukuh (access list)."),
 "This is the clearest example of the AI assistant being used by non-analysts. Be honest: Ask is open to five logins and AI Insights to two; actual use is not measured here. Adoption is something to grow, not a finished result.")

slide(8, "REPORTING", "Monthly management reporting and email delivery tracking run from live data",
 row(img("mis-report", "Management report: monthly summary and daily table, exportable to PDF."),
     img("email-recap", "Email recap: sent, delivered, opened and bounced for reports and statements sent to investors."),
     who="Management report: kukuh, maureen. Email recap: imel, ramano, maureen (access list)."),
 "Business problem: month-end reports were assembled manually and nobody knew whether a statement email actually arrived. These screens refresh themselves and show delivery status.")

slide(9, "BEHIND THE SCENES", "Cost and quality controls keep the platform affordable and dependable",
 '<div class="card-grid" style="margin-top:30px">'
 + card("Lower running cost", "Heavy data queries were reorganised so each screen reads far less data. Further cloud savings are identified and waiting for a decision.", "teal")
 + card("Checked before release", "Automated tests run before every update, and risky changes were analysed and stopped early.", "indigo")
 + card("Freshness you can see", "Each report shows its data date, so nobody mistakes yesterday's numbers for live ones.", "amber")
 + card("Known limits", "Daily refresh runs on one Mac, so a day is skipped if it is off. Time saved was not tracked, so impact is described, not counted.", "rose") + '</div>',
 "No figures on this slide by request. The cloud saving beyond the query work is an estimate awaiting approval. The Mac limit is a real risk and is raised again on the next slide.")

slide(10, "NEXT", "Next: make adoption deeper, the refresh more reliable, and the results measurable",
 '<div class="tl" style="margin-top:40px"><div><div class="when">Now</div><ul><li>Confirm roles with each user</li><li>Train the team on Ask and AI Insights</li></ul></div>'
 '<div><div class="when">Next</div><ul><li>Move the daily refresh off a personal Mac</li><li>Record time saved per team</li></ul></div>'
 '<div><div class="when">Decision (proposal)</div><ul><li>Approve cloud savings</li><li>Name a backup owner for the dashboard</li></ul></div></div>',
 "Everything on this slide is a proposal from me, not an agreed plan. The two asks are the ones with a real business reason: cost and key-person risk.")

(d/"ai-taskforce-business-support-2026-11.html").write_text('<!doctype html><html><head><meta charset="utf-8"><title>AI at Sayakaya</title><style>' + css + EXTRA + '</style></head><body>\n' + "\n".join(slides) + "\n</body></html>")
(d/"ai-taskforce-business-support-2026-11-speaker-notes.md").write_text("# AI at Sayakaya: speaker notes\n\n" + "\n".join("## Slide %d: %s\n%s\n" % (i + 1, re.sub("<[^>]+>", "", t), n) for i, (t, n) in enumerate(notes)))
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless=new", "--no-pdf-header-footer", "--print-to-pdf=" + str(d / "AI Taskforce Sayakaya - Business Support.pdf"), "file://" + str(d / "ai-taskforce-business-support-2026-11.html")], check=True, capture_output=True)
