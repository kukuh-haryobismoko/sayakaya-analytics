# PHASE 1 — Setup & project understanding

Goal: be able to query DB and GA reliably, understand the data, and lock the definitions.

Steps:
1. Discover tools/skills/MCP per `00_rules.md`. Verify DB (read-only) and GA4 connectivity with a
   trivial query each. Record access status and any blockers.
2. Read repo, schema/migrations, docs, and analytics/event-tracking code.
3. Write `outputs/data_dictionary.md`: user table, KYC table(s), investment/transaction table(s),
   referrer_code, HNWI flag, promo/voucher, notification/email logs, and GA events + params mapped
   to each funnel stage (register, KYC submitted/approved/rejected, first investment, activity).
4. Data quality checks → `outputs/data_quality.md`: duplicates, nulls, orphan records, impossible
   timestamps (e.g., KYC before register), test/internal accounts, inconsistent status values,
   timezone differences DB vs GA. Quantify each issue (counts) and state how it is handled.
5. Define and justify (with data) → `outputs/definitions.md` and the "Key definitions" block in
   `progress.md`: Register, KYC submitted/approved/rejected, Investor (first successful investment),
   Churned (derive the inactivity threshold from the distribution of gaps between investor
   activity; show the distribution and the reason for the chosen cutoff), HNWI rule.
6. Compute the cohort exclusion counts (before/after) at each stage and save them.
7. Start `outputs/data_provenance_log.md`.

Done when: DB/GA access confirmed (or blockers documented), dictionary, data quality report, and
definitions are saved, and `progress.md` is updated. Do NOT start funnel analysis in this phase.
