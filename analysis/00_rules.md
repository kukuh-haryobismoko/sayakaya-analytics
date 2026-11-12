# RULES (apply to every phase)

## Mindset
Think like an owner: skeptical of data (validate quality, definitions, joins), hypothesis-driven,
business-first (every insight → user impact, revenue impact, concrete action for a specific team),
honest about uncertainty (separate facts, correlations, speculation), clear for non-technical
stakeholders (no unexplained jargon).

## Access
- DB access is READ-ONLY. Never write, alter, or delete anything in production.
- Check configured MCP servers/tools first for DB and GA access. Use `hermes skills search <keyword>`
  for needs (GA4, SQL, EDA/cohort/stats, charting, document generation); install only from
  official/trusted sources after reviewing the security scan. If nothing suitable exists, fall back
  to Python (pandas, scipy, matplotlib) + native DB client + GA4 Data API. Do not block on missing skills.
- Log every skill/MCP used or installed in `progress.md`.

## Cohort scope (ALL analyses, DB and GA)
EXCLUDE: HNWI users (identify flag/rule from schema); users with referrer_code 'RAIZ' or 'RAIZKAYA'.
INCLUDE everything else, including referrer_code IS NULL. Use:
`(referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA'))`
Report counts before/after exclusion at each stage. Apply the same exclusion to GA data (map via user_id).
Timezone: normalize everything to Asia/Jakarta (GA and DB often differ, e.g. UTC).

## Rigor
- Every finding cites: metric, n, time window, and the query/script that produced it.
- Use confidence intervals or significance tests for comparisons. Flag n < 30 as low-confidence.
  Watch for Simpson's paradox, survivorship bias, seasonality.
- Label each finding Correlation or Causal-supported; rate evidence High/Med/Low.
- Cross-check key numbers two ways (two queries, or DB vs GA) before reporting.
- Aggregate only. No PII in any output (minimum cell size ≥10).
- Save all queries/scripts in `sayakaya-analytics/analysis/scripts/` so the work is reproducible.

## Data grounding (non-negotiable)
- Every number, table, chart, finding, baseline, and target must come from data actually queried or
  read in this project (DB, GA4, repo code, schema, docs). Nothing from memory, guesses, or
  industry benchmarks.
- Explore before writing. If a query fails or returns empty, report that; do not fill gaps with
  plausible numbers. No placeholders like "X%" or "~N users". Use "Not available: <reason>" and
  add to Data Requests.
- Maintain `outputs/data_provenance_log.md`: for each reported metric → name, value, n, time window,
  source (table/GA property), script file name, run timestamp (Asia/Jakarta). Append every phase.
- Targets and expected impact must be computed from observed data (show arithmetic and assumption).
- Separate in all outputs: Observed (from data) / Inferred (hypothesis) / Proposed (recommendation).

## Finding format (team sections)
Pain point → Evidence (data) → Root cause (with confidence) → Recommendation → Expected impact
(quantified) → Effort (S/M/L) → Priority (P0/P1/P2) → KPI and how to validate (A/B test or before/after).
Priority = impact × confidence ÷ effort.
