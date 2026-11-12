# PHASE 4 — Final deliverables

Inputs: all files listed in `progress.md`, especially `outputs/findings_*.md`, `funnel_overview.md`,
`ga_vs_db.md`, `data_provenance_log.md`. Do not re-run analyses unless a number fails verification.

## 4A. Main analysis document → `outputs/SayaKaya_Funnel_Analysis.md` (+ DOCX or PDF export)
1. Executive summary: top 5 findings, biggest funnel leaks, estimated recoverable users.
2. Scope and definitions: exclusions, funnel and churn definitions, data sources, data quality notes, limitations.
3. Funnel overview and GA-vs-DB reconciliation.
4. Team sections (Marketing / Ops & KYC / Tech) using the finding format in `00_rules.md`.
5. Cross-team prioritized roadmap (now / next / later) with dependencies.
6. Appendix: data dictionary, queries/scripts list, skills used, data requests, provenance log.
Charts in `outputs/charts/` (key findings only).

## 4B. Raker preparation → `outputs/raker_preparation.md`
Audience: leadership and team leads; plain business language, aggregate data only. Planning period:
coming calendar year split into quarters (state the assumption). Structure:
1. Situation snapshot (1 page): funnel conversion per stage, churn rate, 3 biggest leaks, with numbers and windows; what worked / did not.
2. Company Objective: ONE ambitious, qualitative goal shared by Marketing, Ops & KYC, and Tech, derived
   from the biggest leaks; include "why this goal, why now" (data) and "what we are NOT prioritizing".
3. Key Results (3–5): outcome-based, spanning acquisition quality, KYC, activation, retention. For each:
   statement, metric definition, baseline (n + window), target in conservative/base/stretch scenarios,
   how the target was derived, source and query reference, owner team + supporting teams, review
   cadence, confidence, measurable today? (Yes/Partial/No). If a baseline is missing, mark
   "baseline to be established" and add to Data Requests. Never invent numbers.
4. Team contribution map: KR × team matrix with initiatives (referencing P0/P1 items in 4A), quantified
   contribution, effort, owner. Every KR must show cross-team dependency (or why none).
5. Quarterly roadmap (Q1–Q4) with milestones, dependencies, and quick wins for the first 30–60 days.
6. Risks, assumptions, dependencies (tracking gaps, resources, seasonality, regulatory constraints if evident).
7. Decisions needed from leadership at Raker (budget, headcount, SLA, tooling, tracking) with data rationale.
8. Proposed Raker agenda (~60–90 min) and 5–8 discussion questions per team.
9. One-page slide-ready summary: Objective + KRs + owners + baseline → target in one table.
Rules: every number matches 4A and cites its section; every baseline exists in `data_provenance_log.md`;
mark Facts vs Assumptions vs Proposals; if data cannot support a credible KR, propose "build the baseline first".

## 4C. Verification before finishing
Re-check every headline number in the executive summary and `raker_preparation.md` against the
provenance log. Remove or recompute any number without a log entry. Confirm no PII and min cell size ≥10.

Done when: both documents, charts, and the DOCX/PDF export are saved; `progress.md` marked DONE.
Finish with a brief summary: the 5 most important findings, P0 actions per team, and the proposed
Objective with its Key Results (baseline → target).
