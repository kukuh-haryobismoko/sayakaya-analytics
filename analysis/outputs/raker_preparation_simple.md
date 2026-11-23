# Raker Prep — Short Version

One page. Full detail: `raker_preparation.md`. PDF numbers are **Targets**; data numbers are **Observed** (cutoff 2026-11-22). HNWI are in scope (RM target segment).

## 1. The 2027 target (PDF)

| | Value |
|---|---|
| AUM end 2027 | Rp700.9 billion (Mar 289 / Jun 352 / Sep 487 / Dec 701) |
| New funded customers | 10,982 (Mar 1,770 / Jun 4,464 / Sep 7,274 / Dec 10,982) |
| Net revenue | Rp3.53 billion |
| RM channel | 732 customers / Rp394.9 billion AUM (89% of new AUM) |
| Booth / B2B2C / Marketing / Ads | 7,938 / 2,031 / 163 / 118 customers |
| SBN to existing customers | Rp1.3 billion, from July |

Read: 93.3% of customers must come from non-RM channels, but RM brings 89% of the AUM. Two different jobs.

## 2. Where we are (Observed, cutoff 2026-11-22)

| Stage | Retail cohort | With HNWI |
|---|---|---|
| Registered | 64,274 | 64,393 |
| KYC submitted | 23,131 (36.0%) | 23,250 |
| KYC approved | 16,981 (73.4%) | 17,100 |
| First purchase | 3,617 (21.3% of approved) | 3,736 |

- Biggest leak is not KYC but after approval: 13,385 approved users never made a paid purchase (78.8% of retail approved).
- Oct–mid Nov 2026: only 10.5% of approved users bought within 7 days (vs 29.0% Jul–Sep).
- Mature repeat: 62.3%. Sales-code (booth) users 43.1% vs organic 61.2%.
- Android KYC start → submit 80.5% vs iOS 86.0%.
- HNWI (AUM ≥Rp500 million): 119 users ever, 65 accounts today. RM Target of 732 is about 6x the observed 12 crossings per month.

## 3. Three objectives → three KR slots each

"Mature" = first purchase at least 120 days before 2026-11-22 (so on or before 2026-07-25), so they had time to buy again. "Repeat" = bought on 2 or more different days (WIB).

**O1 — Offer more than mutual funds** (Product, Data)

| KR | What it measures | Baseline | Target |
|---|---|---|---|
| O1-a | Share of funded customers who hold a non-mutual-fund product | no data | set starting point |
| O1-b | SBN sold to existing customers | no data | Rp1.3 billion from July (PDF) |
| O1-c | Roadmap items shipped in their planned quarter (SBN primary, multi-asset, allocation Q1; DPLK Q3; equities Q4) | no data | 100% on quarter |

**O2 — Effortless to start and keep investing** (Product, Data; levers sit in Ops/Tech/Marketing)

| KR | What it measures | Baseline (window) | Target (cons. / base / stretch) |
|---|---|---|---|
| KR1 Approved → first buy in 7 days | Of users whose KYC was approved, % who made their first purchase within 7 days of approval | 10.6% (76/715). Approved 1 Oct–14 Nov 2026; Jul–Sep was 28.8% (42/146) | 17 / 20 / 25% |
| KR2 Android KYC start → submit | Of Android users who opened the KYC form, % who submitted it | 80.5% (600/745). GA 1 Oct–21 Nov 2026; iOS 86.0% | 83 / 85 / 86% |
| KR3 Mature repeat | Of mature investors (first buy 120+ days ago), % who bought on 2+ different days | 62.3% (2,220/3,565). All time to 22 Nov 2026 | +3 / +6 / +9 pp |
| Alt KR4 Bonus → payer | Of users who received a bonus purchase, % who later paid with their own money | 41.6% (2,582/6,214). All time to 22 Nov 2026 | 45 / 55 / 65% |
| Alt KR5 QRIS failure | % of QRIS buy orders that expired or were cancelled (guardrail: virtual account stays at 11.2%) | 22.0% (184/835). Orders 1 Jan–22 Nov 2026, bonus excluded | 16.6 / 13.9 / 11.2% |
| Alt KR6 Sales-code repeat | Same as KR3, only for users who registered with a sales code (booth/agent) | 43.1% (88/204). All time to 22 Nov 2026; organic is 61.2% | 47.6 / 52.2 / 61.2% |
| Alt KR7 RM/HNWI accounts | Accounts holding Rp500M+ AUM (HNWI) as a proxy for RM customers | 65 today, 119 ever. Daily AUM 14 Jan–22 Nov 2026 | 732 RM customers in 2027 (PDF) |

**O3 — Ship on time, on a platform that scales** (Engineering, QA)

| KR | What it measures | Baseline (window) | Target |
|---|---|---|---|
| KR8 Event coverage GA vs DB | Of buyers in the database, % that analytics also recorded as paid (the weakest user-based stage; register is 94.6%) | 87.4% (318/364). Users registered 1 Oct–21 Nov 2026 | 92.7 / 95.3 / 98.0% |
| KR9 Weekend KYC wait | Of KYC forms submitted on a weekend, % that waited more than 4 hours for a decision | 41.8% (100/239). Submitted 1 Oct–21 Nov 2026; weekdays 11.1% | 26.5 / 18.8 / 11.1% |
| KR10 Monitoring live | Crash/ANR reporting and an alert for app errors exist and work | none. 63 Google-login failures + 12 app exceptions in 52 days, no alert | milestone |

Notes: O2 = "start" (KR1, KR2) + "keep" (KR3). KR8–KR10 = platform reliability, not release punctuality (no data yet). KR1–KR6 baselines here include the 119 HNWI (RM scope); the retail-only versions are in `raker_preparation.md`. Windows are not uniform (6 weeks to all time); pick one baseline window per KR before the final OKR.

## 4. Decisions needed at the Raker

1. Confirm 3 KRs per objective (O2: KR1–KR3; O3: KR8–KR10; O1: owners supply) and who owns each.
2. Accept "approved → buy in 7 days" as the primary 2027 lever, not more registrations.
3. KYC: 24-hour ceiling per decision plus evening/weekend review slots (34 of 1,017 decisions took over 24 hours).
4. Booth: each sales code needs ~36,600 registrations to deliver 7,938 customers at current conversion.
5. Keep every KR baseline HNWI-inclusive, so the baseline matches RM scope.

## 5. What we do not have

- No data for O1 (product type), RM/B2B2C/SBN channel, revenue, release punctuality, or monthly "new funded customer" baseline.
- Whether RM customers are the same people as AUM ≥Rp500 million accounts: **Inferred, low confidence**.
