# PHASE 3 — Team analyses (Marketing, Ops & KYC, Tech)

Inputs: `outputs/definitions.md`, `outputs/funnel_overview.md`, `outputs/segments.md`,
`outputs/ga_vs_db.md`, `progress.md` (biggest leaks). Prioritize modules by where the leaks are.

## 3.1 Marketing
- Channel/campaign quality: conversion to KYC/investor and retention, not just signups.
- Promo/voucher/referral: redemption vs conversion vs retention; exposed vs unexposed comparison.
- Push and email: sends, open, click, post-click conversion, send-time and frequency effects,
  fatigue/unsubscribe, lift vs control groups.
- Where retention/reactivation messaging is missing (KYC-stuck, never-invested, at-risk investors).

## 3.2 Operations & KYC
- KYC submit→decision time: distribution, median/P90, SLA breaches.
- Weekday vs weekend, hour-of-day, backlog/queue patterns, reviewer/manual vs auto.
- Rejection reasons, resubmission rate, drop-off after rejection.
- Impact of KYC wait time on KYC→investor conversion.

## 3.3 Tech / Product
- GA event funnel: step-level drop-off by screen/page, device/OS/app version.
- Errors, crashes, latency, form-field abandonment, KYC upload failures.
- Feature usage vs conversion/retention (features correlated with investors who stay).
- Release/version correlation with funnel changes.
- Friction between KYC approved and first investment.

For each module: write findings in the format from `00_rules.md`, save to `outputs/findings_marketing.md`,
`outputs/findings_ops_kyc.md`, `outputs/findings_tech.md`. Save scripts, aggregated results, and
append metrics to `data_provenance_log.md`. If a module cannot be supported by available data
(e.g., no push/email logs), write "Not available: <reason>" and add to the Data Requests list.

Done when: three findings files are saved with quantified impact, effort, and priority per finding,
and `progress.md` is updated (can be done as 3 sub-steps; mark IN_PROGRESS with finished sub-steps if interrupted).
