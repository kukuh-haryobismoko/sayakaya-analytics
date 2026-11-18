# AI at Sucor Group: the Sayakaya case. Speaker notes

## Slide 1: Cover
Framing: AI implementation inside Sucor Group, with Sayakaya as the case. All evidence is from Sayakaya only; nothing here claims results at other Group companies. Screens come from the live dashboard; revenue and AUM are shown only as percentages; money values and personal names/emails on the screens are blurred.

## Slide 2: AI made Sayakaya's data usable by the whole team
224 = commits in the project change history from 8 Sep to 18 Nov, excluding automatic documentation refreshes; fixes are included, so it measures activity, not features. Usage: dashboard activity log 7 Sep-15 Nov, excluding the analytics owner, test accounts, logins and admin/system actions: 535 actions, 8 users; weekly 52, 40, 42, 58, 60, 31, 42, 40, 77, 93 (first eight weeks average 45.6, last two 85). Cost: see slide 8 for the basis. 'No new headcount' is how the analytics function is set up (one person plus the AI assistant), not a measured saving. No hours-saved or revenue effect is claimed anywhere in this deck.

## Slide 3: Revenue is down 36% since January while sign-ups rise
Revenue = management-fee revenue (AperD share plus investment-manager share) from the Revenue screen, 1 Jan-31 Oct 2026, indexed to January = 100: revenue 100, 135, 151, 136, 125, 88, 68, 74, 68, 64; AUM 100, 91, 92, 79, 62, 43, 35, 43, 34, 35. Absolute Rupiah values are deliberately not shown. Sign-up counts from the live Ask answer on 18 Nov: Sep 130 registered / 67 KYC, Oct 612 / 427, Nov 578 / 396. Causes of the revenue and AUM move are not analysed. Do not present them as an AI result.

## Slide 4: Anyone with access can question the data in plain English
Question typed live on 18 Nov. Answer: 1,320 registered and 890 KYC verified since September (Sep 130/67, Oct 612/427, Nov 578/396); the tool also says it cannot show why the jump happened or whether the same users were verified. Logged Ask use 7 Sep-15 Nov, excluding the analytics owner: 6 questions by 1 user. Five logins have access. Say plainly that adoption is early and the opportunity is to train the other four.

## Slide 5: AI drafts the weekly digest and flags unusual days
Live dashboard, 18 Nov. Digest: new users 257 in the last 7 days, up slightly on the week before (238); net flow negative this week and positive the week before; buys fell and sells rose (money values blurred on the screen and not quoted). Anomaly scan: 2026-11-05 flagged for AUM and buy volume, z-score 3.47 on buy volume. The same page also has a churn action list and a data-quality check; not shown (contains names). Access: two logins; no usage is logged for this page.

## Slide 6: Marketing and product see exactly where new customers drop out
Live screens captured 18 Nov at their default date range. Booth: 429 registered with an event code, 313 KYC verified (73.0%, 36 failed, 80 not processed), 40 made a purchase (9.3% of registered; 34 new, 6 existing), 53 transactions by 40 customers. App funnel: 1,429 phones started sign-up (plus 233 that already had an account), 59.6% KYC verified (851), 8.7% paid a first buy (125, median 0.7 days after starting), biggest drop-off 83% at 'placed a first buy order'. The two funnels measure different things (event-code registrations vs. phones) over different date ranges; do not compare them. Purchase amounts are left out.

## Slide 7: Dashboard use nearly doubled in the last two weeks
Weekly actions, Monday weeks: 7 Sep 52, 14 Sep 40, 21 Sep 42, 28 Sep 58, 5 Oct 60, 12 Oct 31, 19 Oct 42, 26 Oct 40, 2 Nov 77, 9 Nov 93. Weekly distinct users 3 to 7. Per login, 7 Sep-15 Nov, same exclusions: audrey 331 actions on 50 days (148 exports, 182 investor lookups), robby 32 (24 lookups), tiur 46 exports on 12 days, hardy 33 (27 exports, 6 Ask), gilang 9 exports, cs 79 exports on 37 days, maureen 3, imel 2. The quoted lines are the analytics owner's summary of each team's feedback (that the dashboard is good and saves time), written as paraphrase: not verbatim and no hours-saved figure is claimed. Why the last two weeks rose is not analysed.

## Slide 8: The cloud data bill fell about 70% after one round of fixes
Source: BigQuery job log, billed bytes by source, 1-30 Sep (30 days), 16-31 Oct (16 days), 1-14 Nov (14 days), each scaled to 30 days. Reported: 10,372 GiB falling to 3,793 GiB (-63%); the bill about Rp 1.24 M to Rp 0.37 M (-70%). ESTIMATE basis: US$7.50 per TiB, first 1 TiB per month free, Rp 18,050 per US$, storage excluded; this is not a billing record. What changed: dashboard snapshot tables split by date and date filters rewritten (tested identical on 15 of 15 queries); Connected Sheets two files daily to weekly and six switched off; two unused scheduled queries switched off; Metabase and ad-hoc not changed by us. The Rp 84,000 is the analyst's estimate for three identified savings not yet done.

## Slide 9: Everyone sees only their own sections, and every action is logged
Access is a per-user list of allowed screens; a superuser login exists for the analytics owner. The activity log records logins, exports, Ask questions and sensitive views. Digest figures come from the database and the AI writes only the sentences. USD rate: between 2 and 12 Nov the platform moved USD funds onto one USD/IDR rate (portfolio uses the previous-day rate, revenue the period-end rate); alignment with Sinvest is per the analytics owner and was not independently checked. Open: CI/CD. The Cloud Run workflow's push trigger is off, so today a script on one machine releases; the stated target is to finish CI/CD on Google Cloud. Business benefit of that is expected, not measured.

## Slide 10: Proposal: make Sayakaya the reference case for AI in the Group
This slide is the taskforce's proposal for discussion, not a decision and not a plan with owners. The only evidence is Sayakaya. Do not claim results at other Group companies and do not quote a saving for a second company: nothing has been scoped. CI/CD is the target the analytics owner stated. The pilot company and any budget are the Board's call.
