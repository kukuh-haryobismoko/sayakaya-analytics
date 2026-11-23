# Raker Preparation — Funnel from Acquisition to First Investment

> **Terms used in this document.**
> **Repeat** = the user bought on 2 or more different days (WIB), counting valid non-bonus purchases only.
> **Mature** = first purchase at least 120 days before the data pull (2026-11-22), so every user had the same time to buy again. Mature repeat = % of mature investors who are repeat. Rates on non-mature users are not comparable.
> **Data window** = all registrations and transactions up to 2026-11-22 unless a section states another window (GA4 events: 2026-10-01 to 2026-11-21, 52 days).

Prepared 2026-11-22 20:20 WIB (Asia/Jakarta), for leadership and team leads; aligned to the 2027 PDF (versions -2 and -3 have identical text). Business language, aggregate data. All numbers come from the same 2026-11-22 outputs as the parent document `SayaKaya_Funnel_Analysis.md` (section references given); no PII. Planning period: calendar year **2027**, split by quarter (Assumption: the Raker sets 2027 targets; if the period differs, target scale follows, not metric definitions).

This document separates **Fact** (Observed, in the data), **Assumption** (untested), and **Proposal** (targets, decisions requested). Numbers from *Product & Tech 2027 — Targets, Direction, Objectives* (PDF) are labeled **Target** and never used as Fact; section 0 maps the PDF to this analysis, including items with no data support. **HNWI users are in scope for this document** (they are the RM target segment, section 0.2). Every KR baseline in this document is recomputed with them included (section 0.2).

## 0. 2027 plan and where this analysis fits

Source: *Product & Tech 2027 — Targets, Direction, Objectives* (draft; CEO-approved business plan Scenario 3 plus existing business). **All numbers in this section that come from the PDF are Targets or Direction, not Fact.** Fact is only numbers that come from the analysis data (referenced to the parent document). This section only aligns; all figures come from the 2026-11-22 refresh of the analysis outputs.

### 0.1 What the plan asks for (Target, from PDF)

| Item | 2027 Target |
|---|---|
| Total AUM at end of December | Rp700.9 billion (Rp258 billion existing, held flat, + Rp442.9 billion new) |
| New funded customers | 10,982; cumulative 1,770 (Mar), 4,464 (Jun), 7,274 (Sep) |
| Full-year net revenue | Rp3.53 billion (Rp144 million/month in January to Rp571 million/month in December) |
| Product & Tech Objectives (draft) | O1 Offer more than mutual funds (Product, Data); O2 Make it easy to start and keep investing, new and existing customers (Product, Data); O3 Ship on time without breaking production, a platform that scales (Engineering, QA) |
| Total AUM by quarter end | Mar Rp289 billion, Jun Rp352 billion, Sep Rp487 billion, Dec Rp701 billion |
| KR | No numbers yet. PDF: 3 KR slots per objective, written by each objective's team with starting point and target. Section 3.1 maps the KRs proposed here to the three objectives |

Implied pace (arithmetic from cumulative targets): Q1 1,770 (590/month), Q2 2,694 (898/month), Q3 2,810 (937/month), Q4 3,708 (1,236/month).

### 0.2 Scope: retail funnel plus HNWI as the RM-target segment

| Channel (Target, PDF) | New funded customers | New AUM | Average AUM/customer |
|---|---|---|---|
| RM & Advisory | 732 | Rp394.9 billion (89%) | about Rp540 million |
| Sales Booth (3 malls) | 7,938 (72%) | Rp26.9 billion | about Rp3.4 million |
| B2B2C | 2,031 | Rp18.7 billion | about Rp9.2 million |
| Marketing & Community | 163 | Rp1.0 billion | about Rp6.3 million |
| Digital Ads | 118 | Rp0.1 billion | about Rp0.7 million |
| SBN to existing customers | existing customers | Rp1.3 billion | – |

Arithmetic from the table: non-RM channels = 10,250 of 10,982 customers (93.3%) but only Rp46.7 billion of Rp442.9 billion new AUM (10.5%). The funnel analysis (registration, KYC, first purchase, retention) speaks to the first part. RM customers average about Rp540 million, close to the Rp500 million HNWI line used in `definitions.md`, so HNWI users are **included** here as the RM-target segment, not excluded.

**HNWI, what the data says (Observed, refreshed 2026-11-22).**

| Item | Value |
|---|---|
| HNWI definition | SID with AUM ≥Rp500 million on any daily snapshot since 2026-01-14 (same line as `public/hnwi-bonus-config.js`) |
| HNWI users ever | 119 (all verified, all investors, none RAIZ/RAIZKAYA) |
| SIDs ≥Rp500 million on 2026-11-22 | 65 (7 institutions): 32 at Rp500 million to Rp1 billion, 33 at Rp1 billion or more |
| HNWI among GA users, 2026-10-01 to 2026-11-21 | 78 of 2,767 (2.8%) |

**Funnel with HNWI included (Observed, Phase 2 snapshot 2026-11-22; RAIZ/RAIZKAYA still excluded).**

| Stage | Retail cohort (HNWI excluded) | HNWI included | Change |
|---|---|---|---|
| Registered | 64,274 | 64,393 | +119 |
| KYC submitted (verified + failed) | 23,131 | 23,250 | +119 |
| KYC approved | 16,981 | 17,100 | +119 |
| First investor | 3,617 | 3,736 | +119 (+3.3%) |
| Registered to investor | 5.6% | 5.8% | +0.2 pp |
| Approved to investor | 21.3% | 21.8% | +0.5 pp |

(The main document uses 64,274 for the retail cohort: HNWI excluded. Phase 2 numbers are used here so both columns come from the same snapshot.)

- **Fact:** the 119 HNWI users are 3.2% of all 3,736 investors. They are 100% verified and 100% investors **by construction** (HNWI is defined by holding AUM), so their conversion cannot be compared with retail conversion. The +0.5 pp is not a better funnel.
- **Derived, not measured:** the RM Target is 732 new funded customers in 2027 (about 61 per month). At most 119 accounts have crossed the Rp500 million line since 2026-01-14 (about 11.6 per month; an upper bound for new crossings because some were already above the line on that date). The RM Target is about 5.3 times that rate. Whether RM customers equal "AUM ≥Rp500 million" accounts is **Inferred, low confidence**.
- **Effect on KR baselines (bounded arithmetic):** KR3 mature repeat with HNWI included is 62.3% (2,220/3,565); the retail-only figure is 61.0% (2,104/3,448), so the 119 HNWI raise it by 1.3 pp. KR1, KR2 and KR5 are dominated by users who were not yet investors, so HNWI (already verified investors) move them little; KR1 and KR2 are recomputed on the HNWI-inclusive GA cohort, KR5 on the HNWI-inclusive order cohort.
- **All KR baselines in this document now include HNWI** (recomputed with the HNWI filter removed, so the retail-only numbers in earlier drafts no longer apply). The previous gap (decision 9) is closed.
- **Gap:** no RM, B2B2C, or SBN data in this analysis; no revenue data.

### 0.3 Objective alignment

| P&T 2027 Objective | Analysis section that supports it | Data support | Notes |
|---|---|---|---|
| **O2** Make it easy to start and keep investing | All Objectives and KR1-KR7 of this document (activation, Android KYC, repeat, payment, booth retention, RM/HNWI). Findings V1, V2, T1, T2, T3, O1-O3, M1, M6 | **Strong** (Observed baseline exists) | "Start" = KR1, KR2. "Keep" = KR3. The pool of approved users who have not purchased, 13,385 users (78.3%), is the largest measurable lever |
| O3 Ship on time, platform that scales | T5 (client errors without crash/ANR/alert), data quality (GA vs DB), O2 (one review account carries 67.4% of 1,339 decisions, relevant to the direction "automated KYC, no added ops headcount") | **Partial.** Instrumentation and review-load baselines exist; no data on release timeliness, production incidents, or bugs | Recommendation: instrumentation KRs (Crashlytics/ANR, GA `user_id`, server-side events); proposed O3 KRs are KR8-KR10 in section 3.1. Release-timeliness starting point must come from the Engineering/QA team |
| O1 Offer more than mutual funds | None | **No data** | SBN, equities, multi-asset, DPLK, recommended allocation: not analyzed. No baseline and none filled in here |

This document's Objective (*every user who passes KYC buys within 30 days, and every first-time buyer buys again within 90 days*) is a **derivative of O2**, not a replacement for the P&T objectives. The KRs in section 3 are a **draft proposal**. Section 3.1 maps each to one of the three PDF objectives and picks three per objective (the PDF gives three slots each). The PDF has not set KRs, so no KR numbers come from the PDF, except the RM customer Target quoted in KR7.

### 0.4 Business target alignment with data (Fact vs Target)

| Question | Fact (this analysis) | Target (PDF) | Conclusion |
|---|---|---|---|
| Booth: how many registrations for 7,938 funded customers? | Sales code registrations 2026-10-01..2026-11-22: 363, investors 29 = 8.0% (young cohort). Sales code full history: 18.6% (268/1,441 registrations) | 7,938 booth customers | Arithmetic: at 8.0% needs 99,225 registrations; at 18.6% needs 42,677. Actual conversion between those two numbers is not yet known (§3.2, §4.2 M1) |
| Booth: do customers stay? | Sales code: mature repeat 43.1% vs 61.2% organic; mature churn >90 days 84.8% (inactive, not fund withdrawal) | Booth AUM Rp26.9 billion, average about Rp3.4 million | Sales code median first ticket Rp200,000 (ticket, not AUM). Booth retention is an Observed risk to the booth AUM target |
| Monthly pace | October 2026 registration cohort: 49 investors as of 2026-11-22. Jan-Sep 2026 cohort: 233 investors from 1,800 registrations (26 per registration month) | Q1 590/month | **Not comparable**: registration cohort (not first-purchase month), immature, excludes RAIZ (HNWI funnel: section 0.2). No monthly funded-customer baseline per the plan's definition yet |
| Definition of "funded" | Investor = first successful non-bonus purchase | "New funded customers" (definition not in the PDF) | **Assumption:** the two are the same. Needs confirmation (minimum funding threshold? bonus counted?) |
| Existing AUM flat | Not measured. Churn 81.7% is inactivity >90 days (transactions), not AUM outflow | Rp258 billion held flat | Gap: AUM retention per cohort not yet calculated |

### 0.5 P&T 2027 roadmap alignment with findings

| Roadmap item (draft, PDF) | Objective | Related finding | Observed baseline that can be used |
|---|---|---|---|
| Payment gateway (VA) migration, Q1 | O2 | T2 | VA fail rate 11.2% (477/4,276), QRIS 22.0% (184/835), bank transfer 10.1% (335/3,311); orders 2026-01-01..2026-11-22, bonus excluded. Migration success metric: VA fail rate vs 11.2% |
| Auto debit Mandiri and BNI (live Jan, 2026 roadmap), BCA (Q2) | O2 | None yet | Auto debit does not appear as a method in the T2 table (VA, bank transfer, QRIS, instant payment). Whether it is recorded as a separate method has not been checked; data request |
| Website redesign (Q2), app redesign (Q3) | O2 | T1, T3, T4 | KYC start to submit Android 80.5% vs iOS 86.0% (KR2); approved users who open the buy sheet 56 of 317 (T3); risk profile gate abandoned 36 of 130 (T4). Use as pre-redesign baseline |
| Support for B2B2C and RM (Q2) | O2 | HNWI as RM proxy (section 0.2) | No B2B2C/RM data; HNWI counts only: 65 SIDs ≥Rp500 million on 2026-11-22, 119 ever. See KR7 |
| S-Invest Host-to-Host with maker-checker approval (Q2) | O3 | None yet | No S-Invest data |
| Sales dashboard for RMs (Direction; not on the roadmap) | O2 | None yet | No RM data |
| Recommended allocation, SBN primary, multi-asset (Q1), DPLK (Q3), equities (Q4) | O1 | None yet | No baseline |
| Direction: automated KYC without added ops headcount | O3 | O1, O2, O3 (Ops & KYC) | 1 account = 67.4% of 1,339 decisions; 28.8% of decisions at 10:00 WIB; P90 15.4 hours. Share automated vs manual not yet known (data request) |
| Direction: faster onboarding at booths and corporate events | O2 | M1, T1, T3, V1 | Sales code registration to approved 71.1% (1,024/1,441); to investor 18.6% (268/1,441) full history; booth-era 8.0% (young) |

Note: the PDF is inconsistent on SBN timing (Direction page: SBN in H2; roadmap: SBN primary market in Q1; channel table: SBN to existing customers from July). The analysis has no SBN data either way.

The quarterly roadmap in section 5 remains the analysis work sequence. P&T items already on the roadmap (VA gateway, web/app redesign) become the vehicle for the T1, T2, T3 fixes: do not add new projects if they fit into those items.

## 1. Current situation

**Fact — funnel (HNWI-inclusive cohort 64,393, excludes RAIZ/RAIZKAYA; pulled 2026-11-22, §3 parent document; Data window: all registrations and transactions up to 2026-11-22).**

| Stage | Users | Stage conversion |
|---|---|---|
| Registered | 64,393 | — |
| KYC submitted | 23,250 | 36.1% of registered |
| KYC approved | 17,100 | 73.5% of submitted |
| First investor | 3,736 | 21.8% of approved, 5.8% of registered |
| Repeat (2+ days) | 2,259 | 60.5% of investors |
| Still active | 683 | 18.3% of investors |
| Churn >90 days | 3,053 | 81.7% of investors |

**Three biggest leaks.**

1. **Approved users who never buy: 13,385 users (78.3% of approved).** This is the largest pool and the cheapest to reach: they have already passed KYC. Among those still visible in the app (317 users in 52 days), only 56 opened the buy screen and 14 created an order (§4.4 T3).
2. **Post-approval conversion dropped in October: 10.6% bought within 7 days vs 28.8% in July-September.** Not due to the KYC queue: the drop is equally large for same-day approvals (10.8% vs 29.5%). At the old rate, October lost about 130 buyers (§4.5 V1). Cause not yet identified.
3. **Incentives do not produce payers: 3,632 of 6,214 bonus recipients (58.4%) never made a paid purchase; Rp469.2 million in credit ended up with non-payers.** Only 414 recipients (6.7%) received credit before their first paid purchase (§4.2 M2).

**What works.** Sign-ups via sales code and referral both convert well to investor (18.6% and 21.2% per registration vs 3.8% organic, §4.2 M1): people-powered channels are effective at bringing users to purchase. KYC is not slow at the median: 50% of decisions finish within 10 minutes (§4.3 O1).

**What does not work.** Retention: mature sales code repeat 43.1% vs 61.2% organic, and investor churn 81.7%. Bonus as an acquisition incentive. Lifecycle email: only performance report batches, no click tracking, no email for approved-not-yet-purchased or failed KYC (§4.2 M4, M6).

## 2. Company Objective (one, cross-team)

**Proposed 2027 Objective:** *Every user who passes KYC buys within 30 days, and every first-time buyer buys again within 90 days.*

**Position relative to P&T 2027.** This Objective is a derivative of O2 (*Make it easy to start and keep investing*, section 0.3). O1 and part of O3 have no data in this analysis.

**Why this, why now.** Almost all controllable loss happens after KYC, not before: 13,385 approved users have not bought, and 81.7% of investors stop. Acquisition is not the main bottleneck — the pre-approval funnel already filters, and the two paid people-driven channels (sales code, referral) convert 21% per registration. This means the fastest growth comes not from adding users, but from monetizing users who have already passed KYC and retaining those who have already bought.

**What is NOT prioritized in 2027 (proposal, deliberate and written down).**

- Adding paid registration volume: the organic channel converts 3.8%, and the cause of the October drop is unknown; adding volume on top of a leaking funnel enlarges the leak.
- Large-scale redesign of the KYC flow: median 10 minutes and 73.5% approval; what needs fixing is the in-app drop-off points (T1), not the process.
- New promo programs: no evidence yet that promos raise retention; the existing evidence is in fact a negative correlation (M3).

## 3. Key Results

Ten candidate KRs (KR1-KR10) with a baseline from the current data, plus three O1 candidates with no data. Targets are derived from baselines; no numbers are invented. The targets are analysis proposals, not PDF numbers (the PDF has not set KRs). Baselines include the 119 HNWI (section 0.2); the GA4 baselines (KR1, KR2, KR8, KR9) and the payment-order baselines (KR5) are on the HNWI-inclusive cohort where the query allows.

### 3.1 KR to objective map (3 KR slots per objective)

| P&T 2027 objective | Recommended 3 slots | Alternates | Data support |
|---|---|---|---|
| **O1** Offer more than mutual funds (Product, Data) | O1-a, O1-b, O1-c | None | **No baseline.** Candidates only; Product and Data supply starting points |
| **O2** Effortless to start and keep investing (Product, Data) | **KR1** approved to first buy in 7 days (start), **KR2** Android KYC start to submit (start), **KR3** mature repeat (keep) | KR5 QRIS failure, KR6 booth (sales code) repeat, KR7 RM/HNWI accounts, KR4 bonus to payer (weak fit: marketing efficiency) | **Strong** |
| **O3** Ship on time, without breaking production, platform that scales (Engineering, QA) | **KR8** event coverage GA vs DB, **KR9** weekend KYC wait, **KR10** crash/ANR monitoring live | Release punctuality (no data) | **Partial**: instrumentation and review-load baselines only |

| KR | Objective | Theme | Baseline (Observed) | Proposed target (conservative / base / stretch) | Owner |
|---|---|---|---|---|---|
| KR1 | O2 | Start | 10.6% (76/715, approvals 2026-10-01..2026-11-14); Jul-Sep 28.8% (42/146) | 17% / 20% / 25% | Ops + Tech, Marketing supports |
| KR2 | O2 | Start | 80.5% (600/745) Android; iOS 86.0% (355/413) | 83% / 85% / 86% | Tech, Ops supports |
| KR3 | O2 | Keep | 62.3% (2,220/3,565) mature repeat | +3 / +6 / +9 pp | Marketing + Tech |
| KR4 | O2 (weak) | Start | 41.6% (2,582/6,214; 58.4% never paid) | 45% / 55% / 65% | Marketing + Finance |
| KR5 | O2 | Start | QRIS failure 22.0% (184/835); VA 11.2% (477/4,276) | 16.6% / 13.9% / 11.2% | Tech (gateway), Product |
| KR6 | O2 | Keep | Sales code mature repeat 43.1% (88/204) | 47.6% / 52.2% / 61.2% | Marketing (booth, agents) |
| KR7 | O2 | Start | HNWI-level accounts: 65 SIDs ≥Rp500 million on 2026-11-22; 119 ever | 732 RM customers in 2027 (Target, PDF) | Product, Data with RM |
| KR8 | O3 | Platform | Lowest user-based stage: payment complete 87.4% (318/364); register 94.6% (1,228/1,298), order 93.5% (372/398) | 92.7% / 95.3% / 98.0% | Tech, Data |
| KR9 | O3 | Platform | Weekend submits waiting over 4 hours: 41.8% (100/239); weekdays 11.1% (79/712) | 26.5% / 18.8% / 11.1% | Ops + Tech |
| KR10 | O3 | Platform | No crash/ANR data; 75 client-error events in 52 days (63 `continue_with_google_failed`, 12 `app_exception`), no alert | Crash/ANR export and alert live (milestone) | Tech, QA |
| O1-a | O1 | Breadth | **No data** | Share of funded customers holding a non-mutual-fund product: baseline to be set | Product, Data |
| O1-b | O1 | Breadth | **No data** | SBN to existing customers: PDF Target Rp1.3 billion from July; no baseline here | Product |
| O1-c | O1 | Delivery | **No data** | Roadmap items shipped on their quarter (Q1 SBN primary, multi-asset, recommended allocation; Q3 DPLK; Q4 equities) | Product |

Owner mismatch to settle at the Raker: the PDF puts O2 with Product and Data; the owners above follow where the levers sit (Ops, Tech, Marketing).

### KR1 — Activation: approved to first purchase within 7 days

| Item | Content |
|---|---|
| Metric definition | % of users with a verified KYC decision who make a successful non-bonus purchase within 7 days of the decision |
| Data window | Approved KYC decisions 2026-10-01..2026-11-14 (7 full days before the cutoff); comparison period July-September 2026 |
| Baseline | 10.6% (76/715 October 2026 decisions; §4.5 V1). July-September 2026: 28.8% (42/146) |
| Target conservative / base / stretch | 17% / 20% / 25% |
| How target is derived | Base = halfway from 10.6% to the July-September rate of 28.8% (10.6 + 9.1 = 19.7 → 20%). Conservative = one third of the way (10.6 + 6.1 = 16.7 → 17%). Stretch = 25%, below the July-September level |
| Source | `84_oct_lag.sql`, `86_oct_week.sql`; provenance log |
| Owner | Ops & KYC (decisions + queue) and Tech (post-approval surface); supported by Marketing (CRM trigger) |
| Review cadence | Monthly, per acquisition channel within the month |
| Confidence | Medium — baseline strong, cause of October drop unknown |
| Measurable today? | Partial — KYC submit is linked to GA only for some users; needs server-side event |

### KR2 — KYC: start to submit on Android

| Item | Content |
|---|---|
| Metric definition | % of Android users who `kyc_start` and reach `kyc_success` (submit) within 30 days |
| Data window | GA4 2026-10-01..2026-11-21 (52 days) |
| Baseline | 80.5% (600/745, GA 2026-10-01..2026-11-21; §4.4 T1). iOS 86.0% (355/413) as comparison |
| Target conservative / base / stretch | 83% / 85% / 86% |
| How target is derived | Conservative = half the 5.5 pp gap to iOS (83%), base = three quarters (85%), stretch = iOS parity (86%) |
| Source | `73_more.sql` (kyc_platform), `79_kyc_screens.sql`; provenance log |
| Owner | Tech (instrumentation + selfie screen fix); supported by Ops (help messages) |
| Review cadence | Monthly, per screen |
| Confidence | Medium — drop-off point localized, technical cause not |
| Measurable today? | Yes (screen level), Partial (cause) |

### KR3 — Retention: mature repeat across all investors

| Item | Content |
|---|---|
| Metric definition | % of investors who buy on 2+ different days, measured only on mature investors (first purchase ≥120 days ago) |
| Data window | All time up to 2026-11-22; mature = first purchase on or before about 2026-07-25 (Inferred from 120 days before 2026-11-22) |
| Baseline | 62.3% (2,220/3,565; §4.2 M1). Sales code 43.1% (88/204) vs organic 61.2% (1,293/2,114) |
| Target conservative / base / stretch | +3 pp / +6 pp / +9 pp from baseline |
| How target is derived | Three pp is about a sixth of the 18.1 pp sales-code–organic gap; nine pp closes half of it. The lift is on all mature investors, not the sales-code group alone |
| Source | `75_mature_repeat.sql`; provenance log |
| Owner | Marketing (agent follow-up, lifecycle) and Tech (repeat surface); supported by Ops |
| Review cadence | Monthly, per acquisition channel |
| Confidence | Medium — baseline strong, improvement levers untested |
| Measurable today? | Yes |

### KR4 — Incentive quality: bonus recipients who become paying customers

| Item | Content |
|---|---|
| Metric definition | % of bonus credit recipients with at least one paid purchase (excluding the bonus method) |
| Data window | All bonus credit recipients and their purchases up to 2026-11-22 (bonus method excluded) |
| Baseline | 41.6% (2,582/6,214; 58.4% never paid; §4.2 M2) |
| Target conservative / base / stretch | 45% / 55% / 65% |
| How target is derived | Baseline holds even if policy is unchanged; conservative = credit only after first paid purchase for new cohorts (removes 58.4% non-payers from the program), base = plus 30-day nudge, stretch = plus conversion from email/push |
| Source | `76_bonus_chk.sql` (bonus_before_paid, bonus_exposure); provenance log |
| Owner | Marketing (policy) and Finance (budget); supported by Tech (credit flag) |
| Review cadence | Quarterly |
| Confidence | High for baseline, low for projection |
| Measurable today? | Yes |

### KR5 to KR10: added from the 2027 plan and current data

| KR | Metric definition | How the target is derived | Data window | Source | Confidence |
|---|---|---|---|---|---|
| KR5 QRIS failure (O2) | % of QRIS orders failed or expired. Guardrail: VA failure must stay at or below 11.2% through the Q1 gateway migration | Closes half / three quarters / all of the 10.8 pp gap to VA. Base avoids about 68 of the 184 failed QRIS orders in the sample (upper bound: users may retry another way) | Orders 2026-01-01..2026-11-22, bonus excluded | `78_gate_pay.sql`; HNWI-inclusive cohort | Medium baseline, low cause (no provider error code) |
| KR6 Sales code retention (O2) | Mature repeat (2+ buy days, first buy ≥120 days) for users registered via sales code | Closes a quarter / half / all of the 18.1 pp gap to organic 61.2%. n=204 mature: wide interval | All time to 2026-11-22; mature = first buy on or before 2026-07-25 | `75_mature_repeat.sql`; HNWI-inclusive cohort | Medium |
| KR7 RM / HNWI accounts (O2) | New accounts crossing AUM ≥Rp500 million, per quarter | Target is the PDF RM Target (732, about 61 per month), not derived. Observed ceiling since 2026-01-14: 119 accounts (about 11.6 per month over 10.3 months) | Daily AUM snapshots 2026-01-14..2026-11-22 | `16_hnwi_ever.sql`, `definitions.md`; HNWI included | **Low**: RM equals HNWI is Inferred; no first-crossing date or RM marker computed |
| KR8 Event coverage (O3) | Lowest user-based stage ratio across register, order, payment complete (GA users vs DB users, registration window) | Closes half / three quarters / all of the gap from 87.4% (payment complete) to 98% (a 2% tolerance, my assumption) | GA4 2026-10-01..2026-11-21 | `45_ga_db.sql`; `ga_vs_db.md` | Medium |
| KR9 Weekend KYC wait (O3) | % of weekend submits waiting over 4 hours for a decision | Closes half / three quarters / all of the 30.7 pp gap to the weekday rate of 11.1%. Serves the Direction "automated KYC, no added ops headcount" | KYC submissions and decisions up to 2026-11-22 | `71_ops_kyc.sql` weekend vs weekday | Medium |
| KR10 Monitoring (O3) | Crash/ANR export and a client-error alert are live; then crash-free users becomes the KR | Milestone; no numeric baseline exists (75 client-error events in 52 days as context) | GA4 2026-10-01..2026-11-21 | `72_tech_mkt_ga.sql`; `findings_product.md` T5 | Low |

O1 has no analyzable data: no product-type baseline, no SBN or equities data. Do not fill the O1 slots with numbers from this analysis.

Note: if leadership wants a churn KR (81.7% baseline), that metric moves slowly and overlaps with KR3; proposal: use KR3 as the leading retention indicator and report churn as a monitoring metric, not a KR.

## 4. Team contribution map

| KR | Marketing | Ops & KYC | Tech | Measurable contribution | Effort |
|---|---|---|---|---|---|
| KR1 approved→buy 7 days | Post-approval CRM trigger, first-investment message (M6) | Decision queue with due dates, evening/weekend slots (O1, O2) | Post-approval buy sheet surface (T3) | +9.4 pp base; 477 approvals/month become the direct target | M |
| KR2 Android KYC | Capture help messages, selfie guide | Support for users who fail capture | Per-screen outcome instrumentation + permission/capture fix (T1) | +20 submits/52 days if half the gap is closed | M |
| KR3 mature repeat | Agent follow-up day 7 and 30, lifecycle email (M1, M6) | — (indirect dependency: reply speed) | In-app repeat surface | 204 mature sales code investors x 18.1 pp gap = 37 additional if gap fully closed | M |
| KR4 bonus→payer | Credit policy + 30-day nudge (M2) | — | Credit flag, conversion event | Rp469.2 million exposure moved to a paid-purchase condition | S |
| KR5 QRIS failure | Expiry reminder message | — | Provider error code, VA migration guardrail (T2) | About 68 fewer failed QRIS orders at base (sample window) | S |
| KR6 sales code retention | Agent follow-up day 7 and 30 at booths | — | In-app repeat surface | Same 37 as KR3 if the gap closes fully | M |
| KR8 event coverage | — | — | Server-side register/approve/order/pay events | 70 register, 26 order and 46 paid-buyer users unmatched in 52 days | M |
| KR9 weekend KYC wait | — | Evening/weekend review slots | Review queue visibility, later automation | Weekend waits over 4 hours 41.8% toward 11.1% | S |

Every KR has cross-team dependencies. No KR can be achieved by one team alone: KR1 needs decisions (Ops), triggers (Marketing), and a surface (Tech) on the same user.

## 5. 2027 quarterly roadmap

| Quarter | Milestone | Dependencies |
|---|---|---|
| Q1 | Quick wins 30-60 days: new bonus policy (KR4), post-approval CRM trigger, evening/weekend review slots, `user_id` in email logs | bonus program decision, Ops roster, Supabase schema |
| Q1 | VA gateway migration with fail-rate baseline (KR5); event coverage instrumentation (KR8); crash/ANR export and alert (KR10) | Payment gateway vendor, data pipeline |
| Q1-Q2 | Post-approval surface in app (KR1), KYC screen instrumentation + Android selfie fix (KR2) | design, app release |
| Q2 | Agent follow-up day 7/30 for sales code cohort (KR3); 10% promo holdout | agent data, CRM |
| Q3 | Full lifecycle email (onboarding, approved, reactivation); push holdout with `campaign_id` | click tracking, event schema |
| Q3-Q4 | Server-side register/approve/order/pay events; October drop diagnosis completed | data pipeline |
| Q4 | Review KRs vs baseline, reset 2028 targets | all 2027 data |

**Quick wins 30-60 days (Q1):** bonus policy (S, no code), post-approval CRM trigger (no app release), evening review slots, and a KYC rejection reason column. All four can run before the first 2027 app release.

## 6. Risks and assumptions

| Risk / assumption | Impact | Mitigation |
|---|---|---|
| Cause of October drop unknown | KR1 may target the wrong lever | Channel-mix diagnosis in Q1; if the cause is external, lower the KR1 target rather than raise the effort |
| KYC submit not recorded in DB (GA only, partial user_id) | KR1 hard to measure | Server-side event; until then, measure at decision level + DB orders |
| No email click tracking | KR4 and lifecycle cannot be attributed | Add click event in Q1 |
| KYC rejection reason not stored | Targeted fixes are blind | Reason column in Q1 |
| Seasonality: October dropped sharply vs July-September | Quarterly targets can mislead | Compare YoY and per channel, not month to month |
| KYC/e-KYC regulation unchanged during 13 months of data | Recommendations remain valid | Confirm with compliance before release |
| Retention basis from mature investors (≥120 days) | Improvements only visible 4 months later | KR3 reviewed monthly but assessed quarterly |

## 7. Decisions requested from leadership

1. **Bonus policy:** approve credit only after the first paid purchase. Basis: Rp469.2 million in credit ended up with 3,632 non-payers (58.4%); only 6.7% of recipients received credit before buying (§4.2 M2).
2. **KYC SLA:** approve a 24-hour ceiling for every decision plus evening/weekend review slots. Basis: overall P90 is already 15.4 hours, so a P90 target would change nothing; the problem is the tail: 34 of 1,017 decisions (3.3% -- 30 of 858 verified, 4 of 159 failed) took over 24 hours up to 2026-11-22, piled up outside the 10:00 batch window (§4.3 O1). Tracked by KR9.
3. **Headcount/reviewer:** approve a second reviewer or documented delegation. Basis: one account carries 67.4% of 1,339 decisions (§4.3 O2).
4. **Instrumentation:** approve tracking work (GA user_id, email click, campaign_id, rejection reason, crash). Basis: the KRs above (especially KR1, KR8, KR10) can only be partly assessed without it; without it 2027 will repeat the 2026 debate.
5. **Target period:** confirm calendar year 2027 and the quarter definition used.
6. **Definition of "new funded customer":** decide whether it equals investor in this document (first successful non-bonus purchase) and whether there is a minimum funding threshold. Without this the monthly baseline for the 10,982 target cannot be calculated (section 0.4).
7. **Data ownership for O1 and O3:** name baseline owners for O1 (SBN, equities, multi-asset) and O3 (release timeliness, production incidents). This analysis does not have the data.
8. **KR slots:** confirm the three KRs per objective in section 3.1 (O2: KR1-KR3; O3: KR8-KR10; O1: owners supply) and who owns each.
9. **HNWI baselines:** closed. The KR1-KR6 baselines are recomputed with HNWI included (section 0.2), so every baseline matches the RM-inclusive scope.

## 8. Raker agenda (75 minutes) and discussion questions

| Time | Session |
|---|---|
| 0-10 | 2027 plan, data scope, situation: funnel, three leaks (sections 0-1) |
| 10-25 | Objective and what is not prioritized (section 2) |
| 25-45 | Key Results: baseline, target, how derived (section 3) |
| 45-60 | Contribution map and dependencies (section 4) |
| 60-70 | Roadmap and Q1 quick wins (section 5) |
| 70-75 | Decisions requested (section 7) |

**Marketing.** (1) Which channels are ready to take extra volume after October? (2) Who owns agent follow-up day 7 and 30? (3) Can the bonus program be changed this quarter? (4) Which channels must not be increased until the October cause is clear? (5) When can monthly channel-mix data be prepared?

**Ops & KYC.** (1) How many reviewers are available for evening/weekend slots? (2) Who decides review account delegation? (3) Can rejection reasons be recorded starting Q1? (4) How long is a realistic resubmission process? (5) Is there a regulatory limit on decision speed?

**Tech.** (1) How long for KYC screen instrumentation and the Android selfie fix? (2) Capacity for server-side events this quarter? (3) Who owns the post-approval surface? (4) Can email click tracking and `user_id` land in Q1? (5) Can Crashlytics be exported?

## 9. One-page summary

| P&T 2027 objective | Key Result | Baseline | Target (conservative / base / stretch) | Owner |
|---|---|---|---|---|
| O1 Offer more than mutual funds | O1-a, O1-b, O1-c | No data | Set by Product and Data | Product, Data |
| O2 Effortless to start and keep investing | KR1 Approved→buy 7 days | 10.6% (Oct 2026, n=715) | 17% / 20% / 25% | Ops + Tech |
| | KR2 KYC start→submit Android | 80.5% (n=745) | 83% / 85% / 86% | Tech |
| | KR3 Mature repeat | 62.3% (n=3,565) | +3 / +6 / +9 pp | Marketing + Tech |
| | Alternates: KR4 bonus→payer 41.6%; KR5 QRIS failure 22.0%; KR6 sales code repeat 43.1%; KR7 RM/HNWI accounts (Target 732) | section 3.1 | section 3.1 | |
| O3 Ship on time, platform that scales | KR8 Event coverage GA vs DB | 87.4% (lowest user-based stage) | 92.7% / 95.3% / 98.0% | Tech, Data |
| | KR9 Weekend KYC wait over 4 hours | 41.8% (n=239) | 26.5% / 18.8% / 11.1% | Ops + Tech |
| | KR10 Crash/ANR monitoring live | No baseline | Milestone | Tech, QA |

*Note: the company Objective in section 2 (every user who passes KYC buys within 30 days, and every first-time buyer buys again within 90 days) is a derivative of O2. PDF numbers: section 0. HNWI scope and baseline gaps: section 0.2.*
