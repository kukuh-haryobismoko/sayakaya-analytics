# AI at Sayakaya: speaker notes

## Slide 1: Title
Companion to the numbers deck. Screens come from the live dashboard. Only AUM values are blurred; names, emails and phone numbers are blurred as a safety measure.

## Slide 2: AI turned the analytics work into a dashboard the whole company uses every day
Four messages, each proven on a later slide with a real screen. Cost figures are an estimate from job logs, basis on the cost slide. Time saved and revenue effect were not measured, so impact is described, not counted.

## Slide 3: Eleven Sayakaya logins use the dashboard: management, finance, operations, marketing and product
Source: dashboard user list (11 logins). Roles of maureen and ramano (CEO and CPO), imel (product manager) and tiur (finance) confirmed by Kukuh; other labels are inference from access lists. Confirm before the meeting.

## Slide 4: Each colleague sees only the sections they need, and every action leaves a trail
Investor data is sensitive. Access is per section and applies immediately. The activity log records logins, exports, Ask questions and sensitive views.

## Slide 5: Marketing and sales see what each booth delivered, from sign-up to first purchase
Live screen, Nov 1-15 range. 331 registered with an event code, 235 passed KYC, 29 bought, Rp 156.66 M bought. Booth period 19 Oct 2026 to 10 Jan 2027, 29 codes. Fund and person names replaced or blurred.

## Slide 6: Finance and marketing see what a promo costs next to the fee it earns
Live screen, 1 Jan to 15 Nov 2026: 691 promo buys by 375 customers; fee earned Rp 66.02 M of Rp 113.76 M management fee. Bonus owed Rp 8.4 M, sent Rp 339.35 M, plus 248 set by hand.

## Slide 7: The product team can see where new sign-ups drop out
Live screen, 17 Aug to 15 Nov 2026. 1,227 phones started sign-up, 57.3% passed KYC, 9.5% paid a first buy. Biggest drop-off 82% before placing a first buy order. Counts are of phones, not people.

## Slide 8: Anyone with access can ask a business question in plain words and get the answer in seconds
Question typed live: How many users registered and completed KYC each month since September? Answer from the live data: 1,176 registered and 782 completed KYC since September (130/67 Sep, 612/426 Oct, 434/289 Nov). The tool also noted its own caveat. Ask is open to five logins; the activity log shows hardy asked 6 questions since September, so adoption can grow.

## Slide 9: AI writes the weekly digest for management, so nobody has to draft it
Digest produced live on the dashboard. AUM figures blurred. Open to two logins; actual use is not measured.

## Slide 10: AI flags unusual days, so problems are seen in the same week
Anomaly scan run live on the dashboard. Row shown: 2026-11-05 buy volume Rp 35,105,490,000, z-score 3.47. The same page also has a churn action list (names blurred) and a data-quality check.

## Slide 11: Finance sees management-fee revenue by fund and month from one screen
Range 1 Jan to 31 Oct 2026. The AUM series and axis are hidden for the deck. Headline on screen: management fee revenue down 35.9% over the range, Rp 434.6 M (Jan) to Rp 278.7 M (Oct).

## Slide 12: Operations, finance and marketing already use the dashboard for routine work
These are measured usage facts from the dashboard activity log, 8 Sep to 15 Nov 2026 (days = days with any logged event, including logins). They are not quotes. The dashed boxes are placeholders: collect one sentence from each team before the meeting, or delete the boxes. I did not find any written feedback in the project history and did not invent any.

## Slide 13: The monthly BigQuery bill fell by about 70% after we changed how the dashboard reads data
BigQuery bills per amount of data read. Source: BigQuery job log (billed bytes), Sep 1-30, Oct 16-31 (16 days) and Nov 1-14 (14 days), each scaled to 30 days. Late Oct is the first stretch after the 15 Oct changes. Dashboard screens: the snapshot tables (portfolios and similar) were split by date and the date filters rewritten; tested identical on 15 of 15 queries; the Largest funds query went from 5.2 GiB to 30 MB. Connected Sheets: two files from daily to weekly, six switched off. Scheduled queries: kalcer and kalcer_fix switched off. Metabase and ad-hoc were not changed. ESTIMATE basis: US$7.50 per TiB, 1 TiB free per month, Rp 18,050 per US$, storage excluded. These are list-price assumptions, not billing records, so check against the Google Cloud invoice. The earlier figure Rp 1,045,000 to about Rp 246,000 used a 14-day baseline; this slide uses calendar periods, so the numbers differ slightly.

## Slide 14: Next target: finish CI/CD and run releases on Google Cloud instead of one person's computer
User-stated target: complete CI/CD development and move it to Google Cloud from GitHub. Current state from the repo: the Cloud Run deploy workflow exists but its push trigger is commented out until the keyless Google Cloud login (workload identity federation) is set up; its last runs on 17 Sep were skipped. Today the release is done by a script run on one machine. Some scheduled jobs (monthly review deck, e-statement schedule backup tick, GitHub Pages) also still run on GitHub. Business results are expected benefits, not measured.
