# PHASE 2 — Funnel, cohorts, churn, GA vs DB reconciliation

Inputs: `outputs/definitions.md`, `outputs/data_dictionary.md`, `outputs/data_quality.md`, `progress.md`.

Steps:
1. Funnel core (module 4.1): conversion and drop-off at every stage; median/P90 time between stages;
   weekly/monthly register cohorts with stage conversion and retention curves; churn profile
   (who, when, after what behavior, leading indicators, survival curve).
2. Segment cuts: acquisition source/medium/campaign, referrer_code (including NULL), device/OS/
   app version, region, demographic fields if available. Apply significance tests/CIs for comparisons;
   flag n < 30.
3. GA vs DB reconciliation (module 4.2): compare counts per funnel stage (DB = source of truth),
   timezone-normalized. Output a discrepancy table with likely causes (tracking gaps, missing events,
   user_id mapping, consent/ad-block, timezone, bot traffic) and a fix list.
4. Identify the biggest funnel leaks and quantify estimated recoverable users with the arithmetic shown.
5. Save results as aggregated CSV/MD in `outputs/` (e.g., `funnel_overview.md`, `cohorts.csv`,
   `churn_profile.md`, `segments.md`, `ga_vs_db.md`), scripts in `scripts/`, charts in `outputs/charts/`
   (only for key findings). Append every metric to `data_provenance_log.md`.

Done when: outputs above are saved, key numbers are cross-checked two ways, and `progress.md` is
updated with the biggest leaks and any new data requests. Do NOT start team analyses in this phase.
