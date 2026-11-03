# Autodebet: Measurement Plan and Success Criteria (Raker December 2026, 2027 planning)

Prepared 2026-10-28. Read-only analysis: BigQuery project `sayakaya` (dataset `main`, GA4 export `analytics_266759216`) and this repository. No application code, no BigQuery write/DDL/DML. User and plan IDs are never printed; internal staff accounts are excluded with `main.internal_syky` (matched by email inside the query, email never output).

## 0. Assumptions and reading guide

Labels used below: **[measured]** = result of a query run for this document; **[repo]** = read from a file; **[assumption]** = my choice or a benchmark, not measured.

| # | Assumption |
|---|---|
| A1 | Autodebet launches on BNI and Mandiri in Q1 2027; BCA in Q3 2027. Launch date is not in the repo. [assumption] |
| A2 | Autodebet debits are attached to an existing Nabung Rutin plan, so a debit still creates a `transactions` row with `investment_plan_id` set. [assumption] |
| A3 | The first transaction (the one created together with the plan) is paid manually (VA/QRIS) or by the first debit; this must be decided (open question Q1 in section 4.5). [assumption] |
| A4 | "Live plan" = `investment_plans.deleted_at IS NULL`. `investment_plans.status` is `ACTIVE` on every row and carries no information. [measured] |
| A5 | Time zone for all business dates is Asia/Jakarta (`DATE(ts,'Asia/Jakarta')`), the convention already used in `server/queries.js`. [repo] |
| A6 | Statistical settings: two-sided alpha 0.05, power 0.80. [assumption] |
| A7 | Support-ticket data and bank dispute data are not in BigQuery `main` as far as I checked; metrics O3 and O4 need a new source. [assumption] |

Important limit: Nabung Rutin is tiny today. All baselines below rest on 44 external plans and 15 external users. Treat every rate as indicative, and read the confidence intervals.

---

## 1. Phase 1: Discovery

### 1.1 Repository

- No Autodebet code exists. A repo-wide search for `autodebet`, `auto debit`, `direct debit`, `mandate` (excluding `node_modules`, `.git`) hits only unrelated prose in `1on1-review-prep.md:137` and `presentation-docs/ai-taskforce-september-2026.html:126`. [repo]
- No schema or migration for `transactions` or `investment_plans` is in the repo: `supabase/migrations/` has 17 files and none mention `investment_plan`. The tables are mirrored into BigQuery from the app database; the sync mechanism is not in the repo. [repo, assumption on mechanism]
- Nabung Rutin is read in `server/queries.js`: constants `INVESTMENT_PLANS` and `INVESTMENT_PLAN_FUNDS` (lines 5687-5688), `t.investment_plan_id AS plan_id` (line 5738), booth sales-code query (line 5796). A mirror lives in `supabase/functions/api/queries.ts`. [repo]
- Paid statuses in code: `SUB_PAID_STATUSES = 'completed', 'completed_payment', 'verified'` (`server/queries.js:2543`). Data also holds `verified_by_operational` (31 buys, see 1.2). That value is not in the constant; check whether those 31 rows should count as paid. [repo + measured]
- No dbt, Dataform or Airflow in the repo. Scheduling today: the server exposes `POST /api/cron/run-due-schedules` (`server/schedules.js:11-12`), triggered by GitHub Actions (`cron-run-schedules.yml`; other workflows: `deploy-cloud-run.yml`, `gh-pages.yml`, `monthly-review-refresh.yml`) or by `pg_cron` (migration `20261013130000`, `server/schedules.js:70`). The dashboard app reads BigQuery directly (`DEVELOPER_GUIDE.md:15`). [repo]

### 1.2 BigQuery: relevant tables and columns

Tables confirmed in `sayakaya.main` (row counts at query time, 2026-10-27) [measured]:

| Table | Rows | Last modified (UTC) |
|---|---|---|
| `transactions` | 386,609 | 2026-10-27 15:27 |
| `users` | 320,254 | 2026-10-27 15:26 |
| `investment_plans` | 63 | 2026-10-27 13:36 |
| `investment_plan_funds` | 63 | 2026-10-27 13:37 |
| `internal_syky` | internal-staff email list, used to exclude staff accounts | n/a |

`transactions` has 50 columns. Relevant: `id`, `user_id`, `type`, `status`, `amount`, `payment_method`, `virtual_account_bank`, `virtual_account_number`, `payment_gateway`, `payment_fee`, `user_fee`, `app_covered_fee`, `amount_fee`, `promo_code`, `fund_id`, `goal_id`, `merchant_reference`, `order_id`, `investment_plan_id`, `created_at`, `updated_at`, `expires_at`, `paid_at`, `completed_at`.

`investment_plans` has 14 columns: `id`, `user_id`, `type`, `frequency`, `interval`, `start_date`, `ends_on`, `total_amount`, `payment_method`, `virtual_account_bank`, `created_at`, `updated_at`, `deleted_at`, `status`. `investment_plan_funds`: `id`, `investment_plan_id`, `fund_id`, `goal_id`, `amount`, `created_at`. `users` has 20 columns incl. `id`, `email`, `created_at`, `verification_status`, `has_completed_first_subscription`.

Payment methods, gateways and statuses found in `transactions` [measured]:

| `payment_method` | `virtual_account_bank` | `payment_gateway` | Completed buys since 2026-01-01 (non-plan) | Avg amount IDR | Avg `payment_fee` | Avg `user_fee` |
|---|---|---|---|---|---|---|
| bank_transfer | BCA | midtrans | 2,324 | 28,393,644 | 0 | 0 |
| virtual_account | BCA | xendit | 1,944 | 7,007,747 | 120 | 0 |
| virtual_account | MANDIRI | xendit | 592 | 7,059,601 | 260 | 0 |
| QRIS | QRIS | xendit | 551 | 1,890,668 | 0 | 13,235 |
| virtual_account | BNI | xendit | 546 | 2,138,577 | 55 | 0 |
| virtual_account | BRI | xendit | 430 | 9,063,716 | 42 | 0 |
| manual_bonus / bonus | n/a | none | 859 / 322 | 755,246 / 91,925 | 0 | 0 |

Query: `m1` (section 7). Groups with fewer than 300 rows are hidden.

Transaction type by status (top rows) [measured, query `r1`]: buy/completed 315,364; sell/completed 25,852; liquidation/completed 25,022; SWITCH_OUT and SWITCH_IN/completed 6,531 each; buy/expired 2,755; buy/cancelled 2,296; reinvestment/completed 1,807; buy/`verified_by_operational` 31; buy/`completed_payment` 26.

Monthly completed buys (query `k1`, Asia/Jakarta) [measured]: 2026-07 697 buys / 313 buyers; 2026-08 746 / 304; 2026-09 640 / 266; 2026-10 899 / 430. Mean buyers per month for Apr-Sep 2026 (6 full months): 288; Oct 2026 (partial, data to 2026-10-27): 430.

### 1.3 Nabung Rutin definition checked against data

Rule from the brief: Nabung Rutin tx = `transactions.investment_plan_id` not null and joined to `investment_plans.id`; the first tx has no `investment_plan_id`.

| Check | Result | Query |
|---|---|---|
| Rows in `transactions` | 386,609 | `a2` |
| Rows with `investment_plan_id` not null | 61; null rate 0.9998 | `a2` |
| Orphans (plan id without a plan row) | 0 | `c1` |
| Plan tx whose `user_id` differs from the plan's `user_id` | 0 | `c1` |
| Plan tx created before the plan | 0 | `c1` |
| Plan tx by `type` | all 61 are `buy` | `c1` |
| Plan tx by status | completed 15, expired 42, pending_payment 4, cancelled 0 | `c1`, `d1` |
| Plans | 63 rows, 63 distinct ids, 20 users, created 2026-07-31 to 2026-10-22 | `b1` |
| Plans with deleted_at set | 33 of 63 | `b1` |
| Plans with no plan tx at all | 27 of 63 | `c2` |
| Plan tx sitting on deleted plans | 28 of 61 | `c1` |
| Internal vs external | internal: 19 plans / 5 users; external: 44 plans / 15 users (18 live) | `f1` |
| Users with more than one plan (external) | 4 of 15, max 23 plans for one user | `t2` |
| Users with more than one live plan | 4 (all users) | `c2` |

First-transaction rule: **confirmed**. 62 of 63 plans have a `buy` without `investment_plan_id` created 0-10 minutes after `investment_plans.created_at`, always after the plan (0 before), and its `amount` equals the plan `total_amount` in all 62 (query `j1`). So the plan row is created at checkout, at the same moment as the first order. There is no stored link between the plan and its first tx, so I identify it with that 10-minute window (heuristic; section 2 adds `activation_transaction_id` to remove it).

What happens to the activation tx (external users, 44 plans) [measured, `n3`/`v1`/`x1`]:

| Activation tx status | Plans | Of which plan later deleted |
|---|---|---|
| completed | 14 | 3 |
| cancelled | 24 | 19 |
| expired | 5 | 4 |
| none found | 1 | 0 |

Consequence: only 14 of 44 external plans (32%) have a paid first transaction. A plan is created before the user pays, and most abandoned checkouts delete the plan. Any "plan count" metric must be restricted to plans with a paid activation tx.

Recurring cycles (external, query `v1`): cycle 1: 5 paid, 16 expired, 2 pending; cycle 2: 1 paid, 5 expired; cycle 3 and later: 1 paid, 2 expired.

Funnel per plan (external, query `x1`): 44 plans created, 14 with paid activation, 5 of those with at least one paid recurring invoice, 1 with at least two, 26 plans deleted.

Recurring invoice behaviour (the key finding for Autodebet) [measured]:
- All 61 plan invoices are created at 00:00 UTC (07:00 Asia/Jakarta) with `expires_at` a median 71 hours later (`p1`, `p2`); 46 use Midtrans bank_transfer and 15 use Xendit QRIS (`p1`). Inference: the user has to open the invoice and pay it, so Nabung Rutin today is a reminder invoice, not a debit.
- Plan invoices carry no `virtual_account_number` (`p1`: `has_va = 0` on all 61).
- External recurring invoices: 32 created, 7 paid, 23 expired, 2 pending. Paid rate among settled = 7/30 = 23.3% (Wilson 95% CI 11.8% to 40.9%) (`j2`, `calc`).
- The same period (since 2026-08-01, external users, completed / (completed + expired + cancelled)): non-plan virtual_account 88.6% (n = 910), bank_transfer 90.7% (n = 635), QRIS 76.4% (n = 315), plan invoices bank_transfer 28.0% (7 of 25 settled, n = 26) (`n1`).
- Time to pay for paid external invoices: median 649 minutes (about 11 hours), p75 3,036 minutes (about 2.1 days) (`j2`).
- Monthly external recurring invoices (`s1`): Aug 10 created / 1 paid / 3 invoiced users / 1 paying; Sep 6 / 3 / 3 / 1; Oct 16 / 3 / 10 / 3 (2 pending).
- Paid external recurring volume: IDR 10,795,000 from 7 invoices, 4 paying users (`j2`). One IDR 10,000,000 invoice dominates; paid amounts (min, tertiles, max) are 20,000 / 20,000 / 200,000 / 10,000,000.
- Share of all completed buys Aug-Oct 2026: 15 plan buys of 2,285 (0.66% by count); IDR 11,595,000 of 141,214,589,227 (0.008% by value) (`k1`, `calc`).
- Month-1 payers by month: Aug 1, Sep 1, Oct 3 distinct external users with a paid recurring invoice (`s1`).

Edge cases to handle in every formula:
1. Plan with no paid activation tx (abandoned checkout) is not a Nabung Rutin user yet.
2. Several plans per user (up to 23): count users and plans separately; one plan per user per cohort for retention.
3. Deleted plan with later invoices: 28 plan tx sit on deleted plans; check `deleted_at` against `created_at` of each invoice before counting a cycle as due.
4. `completed_payment` and `verified_by_operational` buys exist; align the "paid" definition with `SUB_PAID_STATUSES` before launch.
5. Internal staff: 5 of the 20 plan users are internal and generate 29 of 61 plan tx. Exclude via `internal_syky`.

### 1.4 Google Analytics export

Dataset `analytics_266759216`, sharded `events_YYYYMMDD`, platforms ANDROID and IOS (query `r2`, devices 2026-10-20 to 2026-10-26, top rows: ANDROID mobile organic 1,174, ANDROID `(none)` 488, IOS `(none)` 432, ANDROID cpc 113).

Top events, 2026-09-27 to 2026-10-26, distinct `user_id` [measured, `g2`]: `screen_view` 94,368 events / 1,459 users; `notification_receive` 73,654 / 1,222; `user_engagement` 53,457 / 1,383; `pin_on_submit` 11,676 / 1,230; `session_start` 10,568 / 1,278; `buy_bottom_sheet` 952 / 294; `kyc_start` 908 / 462; `order_created` 798 / 247; `order_button` 725 / 252; `otp_on_submit` 1,333 / 27.

Findings for Nabung Rutin and payments:
- No event name contains `plan`, `rutin`, `nabung`, `routine`, `recurr`, `autodebit`, `auto_debit`, `schedule`, `mandate` or `subscri` (query `h2` returned no rows, 2026-07-01 to 2026-10-26). The plan flow is visible only through `screen_view` with param `firebase_screen`.
- Screens (2026-07-01 to 2026-10-26, `i4`): `SubscriptionFormBottomSheet` 4,468 views / 683 users; `SubscriptionPaymentMethodBottomSheet` 3,903 / 573; `SubscriptionCheckoutScreen` 3,632 / 591; `PaymentScreen` 3,315 / 498; `MultipleSubscriptionFormBottomSheet` 476 / 169. Between 2026-09-01 and 2026-10-26 (`h3`): `InvestmentPlanListScreen` 121, `InvestmentPlanSuccessScreen` 28, `InvestmentPlanUpdateScreen` 17.
- Funnel by distinct users, 30 days (`k3`): form 346, checkout 311, payment method sheet 300, `order_button` 252, `order_created` 247, `PaymentScreen` 250, `payment_complete` 188, `InvestmentPlanListScreen` 43, `InvestmentPlanSuccessScreen` 8.
- Event parameters of the payment and order events inspected (`h4`) are only Firebase defaults (`firebase_screen`, `firebase_screen_class`, `firebase_screen_id`, `ga_session_id`, `ga_session_number`, `engaged_session_event`, `firebase_event_origin`), plus `firebase_conversion` on `order_button` and `nominal` on `price_chips`. No event carries payment method, bank or plan id. GA cannot tell a Nabung Rutin checkout from a one-off buy today.
- User properties (`u1`, `events_20261026`): `first_open_time`, `user_id`, `ga_session_number`, `ga_session_id`, `firebase_exp_rollout_6/7`, `firebase_last_notification`, `last_gclid`, `_ltv_IDR`, `last_advertising_id_reset`. Nothing about plans or payment.

Join GA to main [measured, `i1`, `i2`]:
- Key: GA `user_id` equals `main.users.id`. 2,489 distinct GA `user_id` since 2026-08-01; 2,487 found in `users` (99.9%).
- All 20 plan users appear in GA (20/20). 657 of 685 buyers since 2026-08-01 appear (95.9%).
- Quality: 21.8% of events have a null `user_id` (pre-login, and `first_open`); 1,970 of 2,882 devices (68.4%) ever carry a `user_id`; 81 users appear on more than one device; 21 devices serve more than one user (2026-09-27 to 2026-10-26). Join on `user_id`, not `user_pseudo_id`; do not use `user_pseudo_id` for attribution of funnel steps that happen before login.

---

## 2. Phase 2: Data model for Autodebet

Proposal only. Nothing was created. The source app database is assumed to be Postgres (Supabase); column types below are Postgres, and the BigQuery mirror follows the existing naming. [assumption]

### 2.1 Extend or create

- **Create new tables** for mandates, mandate-to-plan links, debit attempts, bank events, bank response codes and settlement lines. A mandate has its own lifecycle (author, bank, limits, expiry) and one mandate can serve several plans; it does not fit a column on `investment_plans`.
- **Extend `transactions`** with one nullable FK and a new `payment_method` value: a debit that succeeds produces a normal `buy` row, so all existing queries (`SUB_PAID_STATUSES`, fee logic, dashboards) keep working.
- **Extend `investment_plans`** with `activation_transaction_id` to replace the 10-minute heuristic in 1.3.

### 2.2 Concrete schema

Types: new ids are `uuid`; FK columns to existing tables are written as `text` because those ids are STRING in BigQuery. Match the Postgres types of `users.id`, `investment_plans.id`, `transactions.id` (not in the repo) before creating the tables.

```sql
-- Reference: one row per bank. Adding BCA in 2027 = INSERT, no schema change.
CREATE TABLE autodebet_banks (
  bank_code            text PRIMARY KEY,               -- 'BNI','MANDIRI','BCA'
  display_name         text NOT NULL,
  enabled              boolean NOT NULL DEFAULT false,
  max_amount_per_debit numeric(18,0),
  max_amount_per_period numeric(18,0),
  mandate_ttl_days     integer,                        -- bank-side validity
  auth_timeout_minutes integer NOT NULL DEFAULT 30,
  launched_at          timestamptz
);

CREATE TABLE autodebet_mandates (
  id                   uuid PRIMARY KEY,
  user_id              text NOT NULL REFERENCES users(id),   -- same type as users.id
  bank_code            text NOT NULL REFERENCES autodebet_banks(bank_code),
  payment_gateway      text NOT NULL,                         -- gateway or direct bank API
  gateway_mandate_ref  text,                                  -- bank/gateway reference
  status               text NOT NULL CHECK (status IN
    ('PENDING_AUTH','ACTIVE','PAUSED','SUSPENDED','REJECTED','EXPIRED','REVOKED')),
  status_reason_code   text,
  revoked_by           text CHECK (revoked_by IN ('USER','BANK','SYSTEM')),
  account_token        text,                                  -- gateway token, never an account number
  account_mask         text,                                  -- last 4 digits only
  limit_per_debit      numeric(18,0),
  limit_per_period     numeric(18,0),
  limit_period         text,                                  -- 'DAY','WEEK','MONTH'
  auth_started_at      timestamptz NOT NULL,
  approved_at          timestamptz,
  rejected_at          timestamptz,
  revoked_at           timestamptz,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_gateway, gateway_mandate_ref)
);
CREATE INDEX ON autodebet_mandates (user_id, status);
CREATE INDEX ON autodebet_mandates (bank_code, status, created_at);

-- Which plan is paid by which mandate; history kept so "change bank" is visible.
CREATE TABLE autodebet_mandate_plans (
  mandate_id           uuid NOT NULL REFERENCES autodebet_mandates(id),
  investment_plan_id   text NOT NULL REFERENCES investment_plans(id),
  linked_at            timestamptz NOT NULL DEFAULT now(),
  unlinked_at          timestamptz,
  PRIMARY KEY (mandate_id, investment_plan_id, linked_at)
);
CREATE UNIQUE INDEX ON autodebet_mandate_plans (investment_plan_id) WHERE unlinked_at IS NULL;

CREATE TABLE autodebet_debit_attempts (
  id                   uuid PRIMARY KEY,
  mandate_id           uuid NOT NULL REFERENCES autodebet_mandates(id),
  investment_plan_id   text NOT NULL REFERENCES investment_plans(id),
  cycle_no             integer NOT NULL,                      -- 1 = first recurring cycle (activation is cycle 0, not an attempt)
  cycle_due_date       date NOT NULL,                         -- Asia/Jakarta business date
  attempt_no           integer NOT NULL DEFAULT 1,            -- retry count = attempt_no - 1
  retry_of_attempt_id  uuid REFERENCES autodebet_debit_attempts(id),
  amount               numeric(18,0) NOT NULL,
  status               text NOT NULL CHECK (status IN
    ('SCHEDULED','SUBMITTED','PENDING_BANK','SUCCESS','FAILED','RETRY_SCHEDULED','EXHAUSTED','CANCELLED')),
  scheduled_at         timestamptz NOT NULL,
  submitted_at         timestamptz,
  executed_at          timestamptz,                           -- bank confirmation time
  next_retry_at        timestamptz,
  failure_reason_code  text,                                  -- internal category
  bank_response_code   text,                                  -- raw bank code
  gateway_ref          text,
  transaction_id       text REFERENCES transactions(id),      -- set on SUCCESS
  idempotency_key      text NOT NULL UNIQUE,                  -- mandate_id|plan_id|cycle_due_date|attempt_no
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investment_plan_id, cycle_due_date, attempt_no)
);
CREATE INDEX ON autodebet_debit_attempts (mandate_id, cycle_due_date);
CREATE INDEX ON autodebet_debit_attempts (status, next_retry_at);

-- Append-only raw log of requests, callbacks and status polls. Source for audit and replay.
CREATE TABLE autodebet_bank_events (
  id                   uuid PRIMARY KEY,
  bank_code            text NOT NULL,
  mandate_id           uuid,
  debit_attempt_id     uuid,
  direction            text NOT NULL CHECK (direction IN ('REQUEST','CALLBACK','POLL')),
  event_type           text NOT NULL,
  bank_response_code   text,
  http_status          integer,
  payload              jsonb NOT NULL,                        -- PII fields masked before insert
  payload_hash         text NOT NULL UNIQUE,                  -- dedupe replayed callbacks
  received_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autodebet_response_codes (
  bank_code            text NOT NULL,
  response_code        text NOT NULL,
  category             text NOT NULL CHECK (category IN
    ('SUCCESS','INSUFFICIENT_BALANCE','LIMIT_EXCEEDED','ACCOUNT_BLOCKED','MANDATE_INVALID','BANK_DOWN','TIMEOUT','USER_CANCELLED','OTHER')),
  retryable            boolean NOT NULL,
  description          text,
  PRIMARY KEY (bank_code, response_code)
);

CREATE TABLE autodebet_settlement_lines (
  id                   uuid PRIMARY KEY,
  settlement_file_id   text NOT NULL,
  bank_code            text NOT NULL,
  bank_reference       text NOT NULL,
  amount               numeric(18,0) NOT NULL,
  settled_at           timestamptz NOT NULL,
  matched_attempt_id   uuid REFERENCES autodebet_debit_attempts(id),
  match_status         text NOT NULL CHECK (match_status IN ('MATCHED','AMOUNT_MISMATCH','UNMATCHED','DUPLICATE')),
  UNIQUE (bank_code, bank_reference)
);

-- Existing tables
ALTER TABLE transactions
  ADD COLUMN autodebet_debit_attempt_id uuid REFERENCES autodebet_debit_attempts(id);
ALTER TABLE investment_plans
  ADD COLUMN activation_transaction_id text REFERENCES transactions(id);
```

### 2.3 State machines

Mandate:
`PENDING_AUTH` to `ACTIVE` (bank approves) or `REJECTED` (bank/user rejects) or `EXPIRED` (no return within `auth_timeout_minutes`).
`ACTIVE` to `PAUSED` (user pauses) and back to `ACTIVE` (resume); `ACTIVE` to `SUSPENDED` (system, after repeated failures with a non-retryable code) and back to `ACTIVE` after user re-confirmation; `ACTIVE` or `PAUSED` to `REVOKED` (user, bank or system) or `EXPIRED` (bank validity ended).
Terminal: `REJECTED`, `REVOKED`, `EXPIRED`. A new mandate is a new row; reactivation is measured as a new `ACTIVE` mandate for the same `user_id`.

Debit attempt:
`SCHEDULED` to `SUBMITTED` to `SUCCESS`; `SUBMITTED` to `PENDING_BANK` (timeout, bank unclear) then reconcile to `SUCCESS` or `FAILED`; `SUBMITTED` to `FAILED`; `FAILED` with a retryable code to `RETRY_SCHEDULED`, which creates a new row with `attempt_no + 1` and `retry_of_attempt_id`; no more retries to `EXHAUSTED`; `SCHEDULED` to `CANCELLED` (plan deleted or mandate no longer active).
The cycle outcome is the last attempt of the cycle. First-attempt success and final success are both reported.

### 2.4 Bank identification

`autodebet_banks.bank_code` plus FKs. `BCA` is inserted as a row with `enabled = false` until launch. Dashboards filter by `bank_code`; no query hard-codes bank names. On `transactions`, a successful Autodebet buy sets `payment_method = 'autodebet'` and `virtual_account_bank = bank_code`, so existing group-by-bank patterns (query `m1`) work unchanged.

### 2.5 Telling Autodebet and manual Nabung Rutin apart

| Population | Rule |
|---|---|
| Activation tx (both) | `type='buy' AND investment_plan_id IS NULL`, referenced by `investment_plans.activation_transaction_id`; never counted as recurring |
| Manual Nabung Rutin recurring | `investment_plan_id IS NOT NULL AND autodebet_debit_attempt_id IS NULL` |
| Autodebet recurring | `investment_plan_id IS NOT NULL AND autodebet_debit_attempt_id IS NOT NULL` (and `payment_method='autodebet'`) |
| Plan on Autodebet | row in `autodebet_mandate_plans` with `unlinked_at IS NULL` and mandate `ACTIVE` |

Until the schema ships, the manual population is `investment_plan_id IS NOT NULL` (queries in section 7 use this).

### 2.6 Data quality and audit

- Idempotency: `autodebet_debit_attempts.idempotency_key` UNIQUE and `UNIQUE (investment_plan_id, cycle_due_date, attempt_no)`; callbacks deduped by `autodebet_bank_events.payload_hash`. One cycle must not produce two `SUCCESS` rows; the pipeline test in 6.4 checks this.
- Timestamps: store `timestamptz` in UTC; business date `cycle_due_date` in Asia/Jakarta. Current plan invoices are created at 00:00 UTC, which is 07:00 Asia/Jakarta (`p2`): decide whether `cycle_due_date` follows UTC or Jakarta, and keep one rule.
- PII: no account numbers, no raw bank payloads with names. `account_token` and `account_mask` only. Analytics layers hash `user_id` with `SUBSTR(TO_HEX(MD5(user_id)),1,6)` for samples; dashboards show aggregates.
- Reconciliation: load each bank settlement file into `autodebet_settlement_lines`; match on `(bank_code, bank_reference)` and amount; report `match_status` daily.
- Audit trail: status changes on mandate and attempt are append-only in `autodebet_bank_events` plus a status-history view; no in-place overwrites of `approved_at`, `revoked_at`.
- Backfill: set `activation_transaction_id` for the 63 existing plans with the 10-minute rule (62 match), review the remaining 1 by hand.

---

## 3. Phase 3: Metrics framework

Conventions: "due cycle" = recurring cycle with `cycle_due_date` in the period; "paid" = status in `SUB_PAID_STATUSES` (plus `verified_by_operational` if confirmed); the activation tx is never a recurring cycle; internal accounts excluded. Slices for every metric: bank (`bank_code`), plan cohort month (activation month), plan amount band, frequency (`investment_plans.frequency`, `interval`), acquisition channel (GA `traffic_source.medium`, joined on `user_id`), device (GA `platform`). Baseline column shows the manual Nabung Rutin number measured today.

### 3.1 Adoption and activation

| ID | Metric | Formula | Source | Freq | Why | Baseline |
|---|---|---|---|---|---|---|
| A1 | Registration start rate | users with `autodebet_method_select` / users who viewed `SubscriptionPaymentMethodBottomSheet` | GA events (5.2), `user_id` | weekly | Is the option visible and attractive | none (no event) |
| A2 | Registration completion rate | mandates with `auth_return` / mandates with `auth_redirect_out` | `autodebet_mandates`, GA | weekly | Bank authorization friction | none |
| A3 | Mandate approval rate | mandates with `approved_at` / mandates created (exclude `PENDING_AUTH` younger than `auth_timeout_minutes`) | `autodebet_mandates` | weekly | Bank and UX quality | none |
| A4 | Time to approval | median and p90 of `approved_at - auth_started_at` | `autodebet_mandates` | weekly | Drop-off driver | none |
| A5 | Autodebet adoption among Nabung Rutin users | users with a linked ACTIVE mandate / users with at least one live plan and a paid activation tx | `autodebet_mandate_plans`, `investment_plans`, `transactions` | monthly | Penetration of the base | 0% (15 external users with a plan; 4 with a paid recurring invoice) |
| A6 | Share of new plans choosing Autodebet at creation | plans with a mandate linked within 24 h of `created_at` / plans created in the period with paid activation | same | monthly | Choice at the moment of decision | 0% (14 plans with paid activation since 2026-07-31) |

### 3.2 Funnel conversion

| ID | Step (ordered) | Rate | Source |
|---|---|---|---|
| F1 | Entry view to method sheet | users `autodebet_entry_view` to `SubscriptionPaymentMethodBottomSheet` | GA |
| F2 | Method sheet to Autodebet selected | `autodebet_method_select` / sheet users | GA |
| F3 | Selected to bank selected | `autodebet_bank_select` / `autodebet_method_select` | GA |
| F4 | Bank selected to authorization completed | `autodebet_auth_return(result=success)` / `autodebet_auth_redirect` | GA |
| F5 | Authorization to mandate ACTIVE | mandates `ACTIVE` / authorizations returned | `autodebet_mandates` |
| F6 | Mandate ACTIVE to first successful debit | users with a `SUCCESS` attempt within 35 days / mandates ACTIVE | `autodebet_debit_attempts` |

Reference funnel today for the one-off subscription flow (30 days, distinct users, `k3`): form 346, checkout 311, method sheet 300, order button 252, order created 247, payment screen 250, payment complete 188 (54% form to payment complete). Use it as the shape of F1 to F3.

### 3.3 Debit performance

| ID | Metric | Formula | Source | Freq | Baseline (manual invoices) |
|---|---|---|---|---|---|
| D1 | Debit success rate (cycle) | cycles whose last attempt is `SUCCESS` / due cycles with a final outcome | `autodebet_debit_attempts` | daily, reported weekly | 23.3% paid of settled invoices (7/30, CI 11.8-40.9%) |
| D1b | First-attempt success rate | cycles with attempt 1 `SUCCESS` / due cycles | same | weekly | n/a |
| D2 | Failure rate by reason code | failed attempts by `autodebet_response_codes.category` / all attempts | attempts, response codes | weekly | n/a (expiry only: 23 of 32 invoices expired) |
| D3 | Retry recovery rate | cycles with attempt 1 failed and later `SUCCESS` / cycles with attempt 1 failed | attempts | weekly | n/a |
| D4 | Insufficient balance rate | attempts with category `INSUFFICIENT_BALANCE` / attempts | attempts | weekly | n/a |
| D5 | On-time debit rate | cycles succeeded by end of `cycle_due_date` (Asia/Jakarta) / due cycles | attempts | weekly | median time to pay 649 min, p75 3,036 min (paid invoices) |
| D6 | Average days to successful debit | mean of `DATE_DIFF(DATE(executed_at,'Asia/Jakarta'), cycle_due_date, DAY)` over successful cycles | attempts | weekly | about 0.45 days median (649 min) |

### 3.4 Retention and recurring behaviour

| ID | Metric | Formula | Source | Freq |
|---|---|---|---|---|
| R1 | Nabung Rutin retention Mk (k = 1, 3, 6, 12) | cohort = plans with paid activation tx, cohort month = activation month; retained = plan has a paid recurring tx (`investment_plan_id` not null, `status` paid) in calendar month cohort + k; denominator = plans whose cohort + k month has ended | `transactions`, `investment_plans` | monthly |
| R2 | Plan survival rate | plans with `deleted_at IS NULL` at cohort + k / plans with paid activation | `investment_plans` | monthly |
| R3 | Consecutive successful periods | longest run of paid cycles starting at cycle 1, per plan; report distribution | `transactions` | monthly |
| R4 | Churn and mandate revocation rate | plans deleted in month / live plans at start; mandates `REVOKED` in month / ACTIVE mandates at start | `investment_plans`, `autodebet_mandates` | monthly |
| R5 | Reactivation rate | users with a `REVOKED`/`EXPIRED` mandate who get a new ACTIVE mandate within 90 days / users with a `REVOKED`/`EXPIRED` mandate | `autodebet_mandates` | monthly |

Baselines [measured]: R1 for manual plans cannot be computed yet: only 1 plan has a matured month-1 window (retained 1, `w1`). Proxies: 5 of 14 external plans with a paid activation have at least one paid recurring invoice (36%), 1 of 14 has two or more (`x1`). R2 proxy: 18 of 44 external plans live (41%), 26 deleted (59%), and 19 of the 24 plans whose first order was cancelled were deleted (`n3`). For general repeat-buy behaviour (all users, any completed buy, not Nabung Rutin): M1 35.8% and M3 10.7% pooled (cohorts 2026-01 to 2026-08 with n = 251 for M1, 2026-01 to 2026-06 with n = 214 for M3, `k2`).

### 3.5 Value and business impact

| ID | Metric | Formula | Source | Freq | Baseline |
|---|---|---|---|---|---|
| V1 | Average transaction value | mean and median of `amount` for paid recurring tx | `transactions` | monthly | IDR 10,795,000 over 7 paid external invoices (mean about 1.54M, median at most about 200,000; one 10M invoice) |
| V2 | Savings volume per user | sum of paid `amount` per active user per month (recurring and non-plan) | `transactions` | monthly | all buyers: Oct 2026 899 buys, 430 buyers |
| V3 | Lifetime savings value per user | cumulative paid `amount` in the 12 months after activation | `transactions` | quarterly | not measurable yet (plans created from 2026-07-31) |
| V4 | Incremental volume from Autodebet | (volume per user in Autodebet arm) minus (volume per user in control arm), from the experiment in 3.7 | experiment table | per experiment | n/a |
| V5 | Share of total volume from Autodebet | paid Autodebet `amount` / paid `buy` amount, same period | `transactions` | monthly | 0% (all plan buys Aug-Oct: 0.66% of buys by count, 0.008% by IDR) |
| V6 | Fee impact per paid tx | `payment_fee`, `app_covered_fee`, `user_fee` of Autodebet tx vs. other methods | `transactions` | monthly | see 1.2: BNI VA 55, MANDIRI VA 260, BCA VA 120, BCA bank_transfer 0, QRIS user fee 13,235 (averages, IDR) |

The Autodebet fee per debit is not known (depends on the bank/gateway contract). [assumption] Revenue effect on SayaKaya is not measurable from `main`; fee data above covers payment cost only.

### 3.6 Operational and risk

| ID | Metric | Formula | Source | Freq |
|---|---|---|---|---|
| O1 | Bank error rate and uptime | attempts with category `BANK_DOWN`/`TIMEOUT` / attempts, per `bank_code` per day | attempts, response codes | daily |
| O2 | Reconciliation mismatch rate | settlement lines `AMOUNT_MISMATCH`+`UNMATCHED`+`DUPLICATE` / lines | `autodebet_settlement_lines` | daily |
| O3 | Support ticket rate | tickets tagged Autodebet / 1,000 debit attempts | ticket tool export [source not found in repo or `main`; assumption] | weekly |
| O4 | Fraud or dispute rate | disputed debits / successful debits | bank dispute file [assumption] | monthly |

### 3.7 Comparison design: Autodebet vs manual Nabung Rutin

Selection bias is the main threat: users who accept a bank mandate are likelier to be disciplined savers anyway.

1. **Preferred: staged rollout with a holdout.** For users creating a new plan, expose the Autodebet option to a random 50% (hash of `user_id`) for the first 8 weeks; the other 50% see the existing flow. Compare intention-to-treat (offered vs not offered), then adoption-adjusted. Randomisation removes selection bias.
2. **Fallback: matched comparison.** If rollout cannot be randomised, match Autodebet users to manual users on pre-period behaviour: completed buy count and total IDR in the 90 days before activation, tenure, platform, channel, plan amount band; use propensity score matching (nearest neighbour, caliper) and report difference-in-differences against the matched group.
3. Always compare from cycle 1 onward and exclude the activation tx on both sides.

Minimum sample (per arm, alpha 0.05, power 0.80, two-sided; baselines measured above; computed from the standard two-proportion formula) [measured baseline + assumption on settings]:

| Metric | Baseline | Target to detect | Units needed per arm |
|---|---|---|---|
| Recurring invoice paid rate | 23.3% | 60% | 28 invoices |
| Recurring invoice paid rate | 23.3% | 85% | 9 invoices |
| Month-1 repeat (proxy, all users) | 35.8% | 45.8% | 378 users |
| Month-1 repeat (proxy, all users) | 35.8% | 55.8% | 97 users |
| Month-3 repeat (proxy, all users) | 10.7% | 20.7% | 207 users |
| Month-3 repeat (proxy, all users) | 10.7% | 30.7% | 64 users |

Reading precision of a success rate p = 0.90: about 139 attempts for +/- 5 points, about 385 for +/- 3 points (95% CI, normal approximation, computed from n = z^2 p(1-p)/e^2). Normal-approximation sizes below about 30 per arm, such as the invoice-level rows, are indicative only.

Duration: the debit success rate needs at least 2 monthly cycles after mandate approval (4 weeks for weekly plans); M3 retention needs 3 full months after activation. At today's pace (6 external plans created in Oct 2026, `n2`), 200 plans (100 per arm) would take about 33 months; the rollout needs a promotion plan, or the first reading is limited to debit-level metrics (D1 to D6), which need far fewer users.

---

## 4. Phase 4: Success criteria

### 4.1 Baselines (measured, external users, as of 2026-10-27)

| Metric | Baseline | Note |
|---|---|---|
| Recurring invoice paid rate (settled) | 23.3% (7/30); CI 11.8-40.9% | `j2` |
| Plans with paid activation tx | 14 of 44 (32%) | `x1` |
| Paid-activation plans with at least 1 paid recurring invoice | 5 of 14 (36%) | `x1` |
| Paid-activation plans with at least 2 paid recurring invoices | 1 of 14 | `x1` |
| Live external plans | 18 of 44 (41%) | `f1` |
| Active recurring savers per month (distinct users with a paid recurring invoice) | Aug 1, Sep 1, Oct 3 | `s1` |
| Median time to pay a recurring invoice | 649 minutes | `j2` |
| Share of buys that are plan buys (Aug-Oct) | 0.66% by count, 0.008% by IDR | `k1` |
| Non-plan settle rate, VA / bank transfer / QRIS | 88.6% / 90.7% / 76.4% | `n1` |
| Month-1 / Month-3 repeat-buy (all users) | 35.8% / 10.7% | `k2` |
| Monthly buyers, mean Apr-Sep 2026 / Oct 2026 (partial) | 288 / 430 | `k1` |

### 4.2 Metric hierarchy

- **North Star: active recurring savers per month**: distinct users with at least one paid recurring contribution (`investment_plan_id` not null, not the activation tx) in the calendar month. Autodebet is expected to raise it by making the payment happen without user action. Baseline: 3 (Oct 2026).
- **Primary metrics (5):**
  1. Debit success rate (D1), baseline 23.3% for manual invoices.
  2. Mandate approval rate (A3), no baseline.
  3. First-debit success within 35 days of mandate approval (F6), no baseline.
  4. Month-3 plan survival of Autodebet plans (R2/R1 at k = 3), no baseline.
  5. Autodebet share of paid recurring cycles (A5/V5 on cycles), baseline 0%.
- **Guardrails (must not degrade):**
  - Manual Nabung Rutin plus non-plan buy volume per active buyer: no more than 5% below the pre-launch 3-month mean (cannibalisation).
  - Failed-debit rate (1 - D1): no more than 15% after the first 8 weeks; hard stop at 30% in any week.
  - Mandate revocation rate (R4): at most 5% per month.
  - Reconciliation mismatch (O2): at most 0.5%.
  - Support tickets per 1,000 debits (O3): threshold set after the first 4 weeks of data.
  - Overall buy settle rate of non-plan methods: no drop of more than 2 points.

### 4.3 Targets for 2027 by quarter [assumption unless noted]

Scenario logic: conservative = launch slips and adoption stays low; base = launch Q1 as planned with in-app promotion; ambitious = Autodebet is the default option in plan creation. Baselines are measured; every target is an assumption. Targets are end-of-quarter values.

| Metric | Baseline (measured) | Scenario | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|---|---|
| Active recurring savers per month | 3 (Oct 2026) | Conservative | 6 | 12 | 20 | 30 |
| | | Base | 10 | 25 | 40 | 60 |
| | | Ambitious | 20 | 45 | 80 | 120 |
| Debit success rate (D1) | 23.3% manual | Conservative | 70% | 72% | 75% | 78% |
| | | Base | 80% | 83% | 85% | 87% |
| | | Ambitious | 88% | 90% | 92% | 93% |
| Mandate approval rate (A3) | none | Conservative | 50% | 55% | 58% | 60% |
| | | Base | 60% | 65% | 70% | 72% |
| | | Ambitious | 70% | 75% | 78% | 80% |
| Autodebet share of paid recurring cycles | 0% | Conservative | 20% | 30% | 40% | 50% |
| | | Base | 30% | 45% | 60% | 70% |
| | | Ambitious | 40% | 60% | 75% | 85% |
| M3 plan survival, Autodebet plans (R2) | not measurable | Conservative / Base / Ambitious | set after 8 weeks of data | 40% / 50% / 60% | 45% / 55% / 65% | 50% / 60% / 70% |

Anchors: the base D1 target sits just below the 88.6-90.7% settle rate of non-plan VA and bank transfer (`n1`), which is the best measured "payment completes" benchmark. The North Star base of 60 equals about 14% of October 2026 monthly buyers (430, `k1`). These are planning numbers; recalibrate at the end of Q1 with real mandate data.

### 4.4 Launch gates and go/no-go for BCA

Evaluated per bank on BNI and Mandiri, after at least 8 weeks live. All thresholds are assumptions to be agreed.

| Gate | Go | No-go (hold BCA) |
|---|---|---|
| Volume sufficient to judge | at least 385 debit attempts overall (+/- 3 points at 90%) | fewer than 139 attempts: extend |
| Debit success rate (D1), last 4 weeks, each bank | 85% or higher | below 80% |
| Mandate approval rate (A3) | 60% or higher | below 45% |
| First-debit success within 35 days (F6) | 80% or higher | below 65% |
| Mandate revocation rate (R4), monthly | 5% or lower | above 10% |
| Reconciliation mismatch (O2), last 4 weeks | 0.5% or lower | above 2% |
| Bank uptime (O1 error rate) | below 2% | any bank incident above 24 h in the last 30 days |
| Manual plus non-plan volume per active buyer | within -5% | below -10% |
| Support tickets per 1,000 debits | at or below agreed ceiling | above 2x ceiling |

Between the Go and No-go bands: extend 4 weeks and re-read.

### 4.5 Risks, dependencies, open questions

Risks:
1. Tiny base: 15 external plan users, 3 payers in Oct 2026. Rates are noisy and a single IDR 10M invoice swings volume. Mitigation: report counts next to rates, use CIs.
2. Plan created before payment: 24 of 44 external plans have a cancelled first order. Autodebet registration at that step may lose users to the bank redirect. Mitigation: measure F-steps by plan with paid activation.
3. Bank behaviour unknown: limits, retry rules, response codes and settlement-file format for BNI and Mandiri are not in the repo. [assumption]
4. Cannibalisation of one-off buys by recurring debits is unmeasured.
5. GA cannot separate plan checkout from one-off buy today (1.4); funnel analysis depends on the new events in section 5.
6. Data gaps: support tickets and disputes (A7), the activation link (2.2), the paid-status mismatch (1.1).

Dependencies: backend work for mandate and debit services; mobile release for new events and screens; bank sandbox; finance for fee and settlement terms; an export for support tickets.

Open questions for business and bank partners:
- Q1. Is the first transaction paid by VA/QRIS, or by the first debit? (changes F6 and activation rules)
- Q2. Per-debit and per-period limits for BNI and Mandiri, and mandate validity period.
- Q3. Retry policy: number of retries, spacing, allowed hours.
- Q4. Who pays the Autodebet fee: SayaKaya, user, or split? (`app_covered_fee` vs `user_fee`)
- Q5. Debit date rule: UTC or Jakarta, and time of day (today invoices are created at 07:00 Jakarta, `p2`).
- Q6. Can rollout be randomised for the first 8 weeks?
- Q7. Settlement file format and delivery time.

---

## 5. Phase 5: Google Analytics tracking plan

### 5.1 Conventions (from existing events)

Existing event names are lower snake_case verbs or nouns: `order_created`, `order_button`, `payment_complete`, `buy_bottom_sheet`, `pin_on_submit`, `otp_on_submit`, `kyc_start` (`g2`). Screens are PascalCase in `firebase_screen`: `SubscriptionPaymentMethodBottomSheet`, `SubscriptionCheckoutScreen`, `PaymentScreen`, `InvestmentPlanListScreen`. New events use the prefix `autodebet_` and snake_case; new screens use PascalCase with `Autodebet`. Parameters use snake_case and stay under GA4's limit of 25 per event.

### 5.2 Events

"Client" = mobile app; "Server" = backend via the GA4 Measurement Protocol with the same `user_id`.

| Event | Trigger | Parameters (type, example) | Side | Screen / flow |
|---|---|---|---|---|
| `autodebet_entry_view` | Autodebet entry (banner/row) becomes visible | `source_screen` (string, `SubscriptionPaymentMethodBottomSheet`), `frequency` (string, `MONTHLY`) | Client | plan creation, plan list |
| `autodebet_entry_tap` | tap on entry | `source_screen` | Client | same |
| `autodebet_method_select` | user picks Autodebet as payment method | `source_screen`, `amount_bucket` (string, `100k-500k`), `frequency` | Client | `SubscriptionPaymentMethodBottomSheet` |
| `autodebet_bank_select` | user picks a bank | `bank_code` (string, `BNI`) | Client | `AutodebetBankScreen` |
| `autodebet_auth_redirect` | app leaves to the bank | `bank_code`, `mandate_id` (string) | Client | `AutodebetAuthScreen` |
| `autodebet_auth_return` | app regains focus after redirect | `bank_code`, `mandate_id`, `result` (string: `success`/`cancel`/`timeout`), `elapsed_sec` (int, 74) | Client | `AutodebetAuthScreen` |
| `autodebet_mandate_result` | backend gets the bank decision | `bank_code`, `mandate_id`, `status` (`ACTIVE`/`REJECTED`/`EXPIRED`), `reason_code` (string) | Server | n/a |
| `autodebet_debit_notice_view` | user opens a debit reminder/notification | `plan_id`, `cycle_no` (int), `bank_code`, `notice_type` (`upcoming`/`success`/`failed`) | Client | notification, `InvestmentPlanListScreen` |
| `autodebet_debit_result` | backend gets the bank result | `plan_id`, `cycle_no`, `bank_code`, `status` (`SUCCESS`/`FAILED`), `reason_category` (string), `attempt_no` (int), `value` (number, 500000), `currency` (`IDR`) | Server | n/a |
| `autodebet_manage_view` | opens mandate management | `bank_code`, `mandate_status` | Client | `AutodebetManageScreen` |
| `autodebet_manage_action` | change bank, pause, resume, cancel | `action` (string), `bank_code`, `mandate_id` | Client + Server confirm | `AutodebetManageScreen` |
| `autodebet_error` | error state shown | `step` (string), `error_code` (string), `bank_code` | Client | any Autodebet screen |

### 5.3 User properties

`autodebet_status` (`none`/`pending`/`active`/`paused`/`revoked`), `autodebet_bank` (`BNI`/`MANDIRI`/`BCA`/`none`), `nabung_rutin_active` (`true`/`false`). Never send account numbers, names or phone numbers.

### 5.4 Key events and custom definitions

- Key events (conversions): `autodebet_mandate_result` with `status = ACTIVE`; `autodebet_debit_result` with `status = SUCCESS`.
- Custom dimensions (event scope): `bank_code`, `source_screen`, `frequency`, `reason_category`, `status`, `step`, `notice_type`, `action`. User scope: `autodebet_status`, `autodebet_bank`. Custom metrics: `elapsed_sec`, `cycle_no`, `attempt_no`. The BigQuery export keeps all params; registering only matters for the GA UI.
- `user_id` consistency: set `user_id` to `main.users.id` before the bank redirect and again on return, so the post-redirect session keeps it (today 21.8% of events have no `user_id`, `i2`). Server events send the same `users.id`, plus the last known `client_id`. Join GA to main on `user_id` only.
- Add a `plan_id` or `is_nabung_rutin` parameter to the existing checkout events (`order_created`, `order_button`, `payment_complete`) so plan checkout is separable from one-off buys (gap in 1.4).

### 5.5 QA checklist

1. Each event fires once per action (no double-fire on rotation or resume).
2. Parameter names, types and allowed values match 5.2; no nulls in `bank_code`.
3. `user_id` is present on every Autodebet event after login; check the null share in `events_*`.
4. Server events carry the same `user_id` as the client for the same flow; test with a hashed sample.
5. `mandate_id` in GA matches `autodebet_mandates.id`; coverage at least 99% over a week.
6. Counts reconcile: `autodebet_debit_result` SUCCESS count within 1% of `autodebet_debit_attempts` SUCCESS count per day.
7. Redirect flow: kill the app during bank auth, return, and confirm `autodebet_auth_return` still fires with `result`.
8. iOS and Android both tested; check DebugView and then `events_intraday_*`.
9. No PII in any parameter value.

---

## 6. Phase 6: Technical data pipeline

### 6.1 Sources, ingestion and cadence

| Source | Into BigQuery | Cadence |
|---|---|---|
| App DB tables `transactions`, `investment_plans`, new `autodebet_*` | existing mirror into `sayakaya.main` (mechanism not in repo; `transactions` last modified minutes-to-hours before query, 1.2) | existing, hours |
| GA4 export | `analytics_266759216.events_*` and `events_intraday_*` | daily plus intraday |
| Bank callbacks | stored in `autodebet_bank_events` by the backend, mirrored with the rest | with the DB mirror |
| Bank settlement files | loaded to `autodebet_settlement_lines` by a daily job | daily, after bank delivery |

### 6.2 Layers (new datasets in asia-southeast2)

| Layer | Dataset | Tables |
|---|---|---|
| Raw | `main` (existing) | `autodebet_mandates`, `autodebet_mandate_plans`, `autodebet_debit_attempts`, `autodebet_bank_events`, `autodebet_response_codes`, `autodebet_settlement_lines` |
| Staging | `autodebet_stg` | `stg_mandates`, `stg_debit_attempts`, `stg_ga_autodebet_events` (GA events with `autodebet_` prefix, params unnested) |
| Intermediate | `autodebet_int` | `int_nabung_rutin_cycles` (every plan tx tagged `activation` / `recurring`, `cycle_no`, `collection_method`), `int_plan_activation` (plan to activation tx, using `activation_transaction_id`, heuristic until backfilled) |
| Mart | `autodebet_mart` | `fct_mandate`, `fct_debit_attempt`, `snap_user_autodebet_daily`, `fct_funnel_events`, `mart_autodebet_metrics` |

Partitioning and clustering (follow the 2026-10-15 rule on `mi_fee_logs`: never wrap the partition column; filter with `DATE(created_at) = ...`):
- `fct_debit_attempt`: partition `cycle_due_date`, cluster `bank_code`, `status`.
- `fct_mandate`: partition `DATE(auth_started_at)`, cluster `bank_code`, `status`.
- `snap_user_autodebet_daily`: partition `snapshot_date`, cluster `bank_code`.
- `stg_ga_autodebet_events`: partition `event_date`, cluster `event_name`, `user_id`. Read `events_*` with a `_TABLE_SUFFIX` range (30-90 days) to limit scan cost (as `k3` does).
- Incremental: stage tables use `MERGE` on `id` with `updated_at >= watermark - 1 day`; GA staging reprocesses the last 3 days (late events).

### 6.3 Model definitions

```sql
-- fct_debit_attempt: one row per attempt, with bank category and Jakarta business dates
CREATE OR REPLACE TABLE `sayakaya.autodebet_mart.fct_debit_attempt`
PARTITION BY cycle_due_date CLUSTER BY bank_code, status AS
SELECT a.id AS attempt_id, a.mandate_id, a.investment_plan_id, m.user_id, m.bank_code,
       a.cycle_no, a.cycle_due_date, a.attempt_no, a.amount, a.status,
       IFNULL(rc.category, 'UNKNOWN') AS failure_category,
       a.scheduled_at, a.executed_at, DATE(a.executed_at, 'Asia/Jakarta') AS executed_date_jkt,
       a.transaction_id,
       a.attempt_no = MAX(a.attempt_no) OVER (PARTITION BY a.investment_plan_id, a.cycle_due_date) AS is_final_attempt
FROM `sayakaya.main.autodebet_debit_attempts` a
JOIN `sayakaya.main.autodebet_mandates` m ON m.id = a.mandate_id
LEFT JOIN `sayakaya.main.autodebet_response_codes` rc
  ON rc.bank_code = m.bank_code AND rc.response_code = a.bank_response_code;

-- fct_mandate
CREATE OR REPLACE TABLE `sayakaya.autodebet_mart.fct_mandate`
PARTITION BY DATE(auth_started_at) CLUSTER BY bank_code, status AS
SELECT id AS mandate_id, user_id, bank_code, status, auth_started_at, approved_at, rejected_at, revoked_at, expires_at,
       TIMESTAMP_DIFF(approved_at, auth_started_at, SECOND) AS secs_to_approval
FROM `sayakaya.main.autodebet_mandates`;

-- snap_user_autodebet_daily: run daily, append yesterday
INSERT INTO `sayakaya.autodebet_mart.snap_user_autodebet_daily`
SELECT CURRENT_DATE('Asia/Jakarta') - 1 AS snapshot_date, m.user_id, m.bank_code,
       COUNT(DISTINCT mp.investment_plan_id) AS linked_plans,
       COUNTIF(m.status = 'ACTIVE') > 0 AS has_active_mandate
FROM `sayakaya.main.autodebet_mandates` m
LEFT JOIN `sayakaya.main.autodebet_mandate_plans` mp ON mp.mandate_id = m.id AND mp.unlinked_at IS NULL
GROUP BY 2, 3;

-- fct_funnel_events: GA events joined to users on user_id (not user_pseudo_id)
CREATE OR REPLACE TABLE `sayakaya.autodebet_mart.fct_funnel_events`
PARTITION BY event_date CLUSTER BY event_name, bank_code AS
SELECT PARSE_DATE('%Y%m%d', event_date) AS event_date, event_name, user_id,
       (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'bank_code') AS bank_code,
       (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source_screen') AS source_screen,
       platform
FROM `sayakaya.analytics_266759216.events_*`
WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Jakarta'), INTERVAL 90 DAY))
  AND STARTS_WITH(event_name, 'autodebet_');
```

`mart_autodebet_metrics` is a long table `(metric_id, period_start, period_grain, bank_code, numerator, denominator, value)` filled by the SQL in section 7 so dashboards read one table. These models target the proposed schema and cannot run until the tables exist.

### 6.4 Orchestration, data quality, monitoring

- Orchestration: no dbt, Dataform or Airflow files were found in the repo. Smallest change: BigQuery scheduled queries for the marts and a GitHub Actions workflow (same pattern as `cron-run-schedules.yml`) for the daily settlement-file load. Move to Dataform only if the model count grows beyond about 15. [assumption]
- Schedule: staging every hour, marts at 02:00 Asia/Jakarta, settlement load after bank file arrival.
- Data quality tests (run after each load, failure alerts):
  - Row counts: `autodebet_debit_attempts` non-decreasing; mart row count equals raw.
  - Nulls: `bank_code`, `mandate_id`, `cycle_due_date`, `idempotency_key` not null.
  - Uniqueness: one `SUCCESS` per `(investment_plan_id, cycle_due_date)`; `idempotency_key` unique.
  - Referential integrity: attempt to mandate, attempt to `transactions.id`, mandate to `users.id`; a `SUCCESS` attempt has a `transaction_id` with `investment_plan_id` set and `payment_method = 'autodebet'`.
  - Activation rule: no `autodebet_debit_attempts` row for a plan without a paid activation tx.
  - Freshness: `max(updated_at)` of attempts under 2 hours; GA table for yesterday present by 12:00; settlement file loaded daily.
  - Reconciliation: share of `SUCCESS` attempts without a `MATCHED` settlement line within 2 days.
- Monitoring and alerts (to Slack/email via the existing GitHub Actions channel): D1 below 80% for any bank-day, O1 above 5% in an hour, mismatch above 0.5%, any freshness failure, revocation spike above 3x 7-day mean.

### 6.5 Dashboards

| View | Audience | Contents |
|---|---|---|
| Executive (Raker summary) | leadership | North Star trend (active recurring savers), D1, A3, Autodebet share of recurring cycles, M3 survival, guardrail status (green/amber/red), BCA gate scorecard |
| Product | product, design | funnel F1 to F6 by bank and platform, A1 to A6, time to approval, drop-off screen, adoption among Nabung Rutin users, experiment readout (V4) |
| Operations | ops, support | D1 to D6 by bank and day, failure categories, retry recovery, O1, O2 mismatches list (hashed ids), mandate status counts, support ticket rate |
| Finance | finance | V5, V6 (fee per tx by bank and method), settlement vs `transactions` amount by day, mismatch value, volume per bank |

The dashboard app already reads BigQuery from `server/queries.js` (and `supabase/functions/api/queries.ts` mirror); new panels follow the same pattern.

### 6.6 Effort, sequencing and owners [assumption]

| Step | Work | Effort | Owner (role) |
|---|---|---|---|
| 1 | Decide open questions Q1 to Q7; sign off schema | 1 week | Product + Backend lead |
| 2 | Create tables, mandate and debit services, bank callback ingestion | 4-6 weeks | Backend |
| 3 | Add GA events (5.2) and `plan_id` on checkout events; QA (5.5) | 2 weeks, parallel to 2 | Mobile + Data |
| 4 | Backfill `activation_transaction_id` and load staging models | 1 week | Data |
| 5 | Marts, DQ tests, alerts | 2 weeks | Data |
| 6 | Dashboards (4 views) | 2 weeks | Data |
| 7 | Settlement load and reconciliation | 2 weeks | Backend + Finance |
| 8 | Staged rollout and first readout (8 weeks live) | 8 weeks | Product + Data |

Critical path: steps 1, 2, then 8; the first full readout is about 14-16 weeks after the decisions are taken.

---

---

## 7. Appendix: queries

Queries below ran against `sayakaya.main` and `analytics_266759216` (SELECT only). Results quoted in this document come from running them on 2026-10-27/28. Internal staff are excluded with `main.internal_syky` joined to `users` by email inside the query; no email or raw ID is returned.

### 8.1 Baselines on real data

**x1: external plan funnel (plans, paid activation, paid recurring)**
```sql
-- manual Nabung Rutin plan funnel, external users: plan created -> activation tx paid -> >=1 / >=2 recurring invoices paid
-- activation tx = nearest same-user buy with investment_plan_id IS NULL created 0-10 min after plan.created_at (no stored link exists)
WITH internal AS (SELECT DISTINCT u.id FROM `sayakaya.main.internal_syky` i JOIN `sayakaya.main.users` u ON LOWER(u.email) = LOWER(i.email)),
ip AS (SELECT id, user_id, created_at, deleted_at FROM `sayakaya.main.investment_plans` WHERE user_id NOT IN (SELECT id FROM internal)),
act AS (
  SELECT ip.id AS plan_id, t.status
  FROM ip LEFT JOIN `sayakaya.main.transactions` t
    ON t.user_id = ip.user_id AND t.type = 'buy' AND t.investment_plan_id IS NULL
   AND t.created_at BETWEEN ip.created_at AND TIMESTAMP_ADD(ip.created_at, INTERVAL 10 MINUTE)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ip.id ORDER BY t.created_at) = 1),
rec AS (SELECT investment_plan_id AS plan_id, COUNTIF(status = 'completed') AS paid FROM `sayakaya.main.transactions` WHERE investment_plan_id IS NOT NULL GROUP BY 1)
SELECT COUNT(*) AS plans_created,
  COUNTIF(act.status = 'completed') AS activation_paid,
  COUNTIF(act.status = 'completed' AND IFNULL(rec.paid, 0) >= 1) AS paid_ge1_recurring,
  COUNTIF(act.status = 'completed' AND IFNULL(rec.paid, 0) >= 2) AS paid_ge2_recurring,
  COUNTIF(ip.deleted_at IS NOT NULL) AS plans_deleted
FROM ip JOIN act ON act.plan_id = ip.id LEFT JOIN rec ON rec.plan_id = ip.id
```

**v1: activation vs recurring classification**
```sql
-- Nabung Rutin tx classified: activation (trigger tx, no plan id) vs recurring (plan id); external users only
WITH internal AS (SELECT DISTINCT u.id FROM `sayakaya.main.internal_syky` i JOIN `sayakaya.main.users` u ON LOWER(u.email)=LOWER(i.email)),
plans AS (SELECT id plan_id, user_id, created_at plan_created FROM `sayakaya.main.investment_plans` WHERE user_id NOT IN (SELECT id FROM internal)),
act AS (
  SELECT p.plan_id, p.user_id, t.id tx_id, t.status, t.created_at,
    ROW_NUMBER() OVER (PARTITION BY p.plan_id ORDER BY t.created_at) rn
  FROM plans p JOIN `sayakaya.main.transactions` t
    ON t.user_id = p.user_id AND t.type = 'buy' AND t.investment_plan_id IS NULL
   AND t.created_at BETWEEN p.plan_created AND TIMESTAMP_ADD(p.plan_created, INTERVAL 10 MINUTE)),
rec AS (
  SELECT t.investment_plan_id plan_id, t.user_id, t.id tx_id, t.status, t.created_at,
    ROW_NUMBER() OVER (PARTITION BY t.investment_plan_id ORDER BY t.created_at) cycle_no
  FROM `sayakaya.main.transactions` t WHERE t.investment_plan_id IN (SELECT plan_id FROM plans))
SELECT 'activation' role, 0 cycle_no, status, COUNT(*) n, COUNT(DISTINCT plan_id) plans FROM act WHERE rn=1 GROUP BY 1,2,3
UNION ALL
SELECT 'recurring', LEAST(cycle_no,3), status, COUNT(*), COUNT(DISTINCT plan_id) FROM rec GROUP BY 1,2,3
ORDER BY 1,2,3
```

**s1: external recurring invoices and payers per month**
```sql
-- external recurring invoices by due month (invoice created_at, Asia/Jakarta)
WITH internal AS (SELECT DISTINCT u.id FROM `sayakaya.main.internal_syky` i JOIN `sayakaya.main.users` u ON LOWER(u.email)=LOWER(i.email)),
t AS (SELECT user_id, status, DATE_TRUNC(DATE(created_at,'Asia/Jakarta'),MONTH) m FROM `sayakaya.main.transactions`
      WHERE investment_plan_id IS NOT NULL AND user_id NOT IN (SELECT id FROM internal))
SELECT FORMAT_DATE('%Y-%m',m) m, COUNT(*) invoices, COUNTIF(status='completed') paid, COUNTIF(status='expired') expired, COUNTIF(status='pending_payment') pending,
 COUNT(DISTINCT user_id) invoiced_users, COUNT(DISTINCT IF(status='completed',user_id,NULL)) paying_users
FROM t GROUP BY 1 ORDER BY 1
```

**j2: recurring invoice paid rate, time to pay, volume (internal vs external)**
```sql
-- baseline: per-plan recurring invoices vs paid, excl internal staff
WITH internal AS (SELECT DISTINCT u.id FROM `sayakaya.main.internal_syky` i JOIN `sayakaya.main.users` u ON LOWER(u.email)=LOWER(i.email)),
ip AS (SELECT ip.*, ip.user_id IN (SELECT id FROM internal) AS is_internal FROM `sayakaya.main.investment_plans` ip),
t AS (SELECT t.*, ip.is_internal, ip.frequency, ip.payment_method ip_pm FROM `sayakaya.main.transactions` t JOIN ip ON ip.id=t.investment_plan_id)
SELECT is_internal, COUNT(*) recurring_invoices, COUNTIF(status='completed') paid, COUNTIF(status='expired') expired, COUNTIF(status='pending_payment') pending,
 ROUND(SAFE_DIVIDE(COUNTIF(status='completed'), COUNTIF(status IN ('completed','expired'))),3) paid_rate_settled,
 COUNT(DISTINCT investment_plan_id) plans_with_invoice, COUNT(DISTINCT IF(status='completed',investment_plan_id,NULL)) plans_with_paid,
 COUNT(DISTINCT user_id) users, COUNT(DISTINCT IF(status='completed',user_id,NULL)) users_paid,
 SUM(IF(status='completed',amount,0)) paid_idr, APPROX_QUANTILES(IF(status='completed',amount,NULL),3) paid_amt_q,
 APPROX_QUANTILES(IF(status='completed',TIMESTAMP_DIFF(paid_at,created_at,MINUTE),NULL),4) mins_to_pay_q
FROM t GROUP BY 1
```

**w1: manual Nabung Rutin retention Mk by activation cohort**
```sql
-- baseline manual Nabung Rutin retention: plans (external users) whose activation tx completed; M+k = a completed recurring tx (investment_plan_id = plan) in calendar month cohort+k (Asia/Jakarta)
WITH internal AS (SELECT DISTINCT u.id FROM `sayakaya.main.internal_syky` i JOIN `sayakaya.main.users` u ON LOWER(u.email) = LOWER(i.email)),
plans AS (SELECT id AS plan_id, user_id, created_at FROM `sayakaya.main.investment_plans` WHERE user_id NOT IN (SELECT id FROM internal)),
act AS (
  SELECT p.plan_id, DATE_TRUNC(DATE(t.created_at, 'Asia/Jakarta'), MONTH) AS cohort_m
  FROM plans p JOIN `sayakaya.main.transactions` t
    ON t.user_id = p.user_id AND t.type = 'buy' AND t.investment_plan_id IS NULL AND t.status = 'completed'
   AND t.created_at BETWEEN p.created_at AND TIMESTAMP_ADD(p.created_at, INTERVAL 10 MINUTE)
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY p.plan_id ORDER BY t.created_at) = 1),
rec AS (
  SELECT investment_plan_id AS plan_id, DATE_TRUNC(DATE(created_at, 'Asia/Jakarta'), MONTH) AS m
  FROM `sayakaya.main.transactions` WHERE investment_plan_id IS NOT NULL AND status = 'completed' GROUP BY 1, 2)
SELECT k,
  COUNTIF(DATE_ADD(cohort_m, INTERVAL k + 1 MONTH) <= DATE_TRUNC(CURRENT_DATE('Asia/Jakarta'), MONTH)) AS matured_plans,
  COUNTIF(DATE_ADD(cohort_m, INTERVAL k + 1 MONTH) <= DATE_TRUNC(CURRENT_DATE('Asia/Jakarta'), MONTH)
          AND EXISTS (SELECT 1 FROM rec WHERE rec.plan_id = act.plan_id AND rec.m = DATE_ADD(cohort_m, INTERVAL k MONTH))) AS retained,
  COUNT(*) AS plans_with_paid_activation
FROM act CROSS JOIN UNNEST([1, 2, 3]) AS k GROUP BY k ORDER BY k
```

**n1: settle rate, plan invoices vs non-plan buys**
```sql
-- settle rate of customer-paid buys: plan invoices vs non-plan, external users, since 2026-08-01
WITH internal AS (SELECT DISTINCT u.id FROM `sayakaya.main.internal_syky` i JOIN `sayakaya.main.users` u ON LOWER(u.email)=LOWER(i.email))
SELECT investment_plan_id IS NOT NULL AS is_plan_invoice, payment_method, COUNT(*) n,
 COUNTIF(status='completed') completed, COUNTIF(status='expired') expired, COUNTIF(status='cancelled') cancelled,
 ROUND(SAFE_DIVIDE(COUNTIF(status='completed'), COUNTIF(status IN ('completed','expired','cancelled'))),3) settle_rate
FROM `sayakaya.main.transactions`
WHERE type='buy' AND created_at>='2026-08-01' AND payment_method NOT IN ('manual_bonus','bonus') AND user_id NOT IN (SELECT id FROM internal)
GROUP BY 1,2 HAVING n>=20 ORDER BY 1,3 DESC
```

**k1: monthly completed buys, buyers, plan share**
```sql
SELECT FORMAT_DATE('%Y-%m', DATE(created_at,'Asia/Jakarta')) m, COUNT(*) buys, COUNT(DISTINCT user_id) buyers, SUM(amount) idr, CAST(APPROX_QUANTILES(amount,2)[OFFSET(1)] AS INT64) median_amt,
 COUNTIF(investment_plan_id IS NOT NULL) plan_buys, SUM(IF(investment_plan_id IS NOT NULL, amount, 0)) plan_idr
FROM `sayakaya.main.transactions` WHERE type='buy' AND status='completed' AND created_at>='2025-11-01' GROUP BY 1 ORDER BY 1
```

**k2: repeat-buy retention M1/M3 by first-buy cohort (all users)**
```sql
-- calendar-month repeat-buy retention, first completed buy cohorts (all users, no plan filter)
WITH b AS (SELECT user_id, DATE_TRUNC(DATE(created_at,'Asia/Jakarta'), MONTH) m FROM `sayakaya.main.transactions` WHERE type='buy' AND status='completed' GROUP BY 1,2),
f AS (SELECT user_id, MIN(m) cohort FROM b GROUP BY 1)
SELECT FORMAT_DATE('%Y-%m',cohort) cohort, COUNT(*) users,
 ROUND(COUNTIF(EXISTS(SELECT 1 FROM b WHERE b.user_id=f.user_id AND b.m=DATE_ADD(cohort,INTERVAL 1 MONTH)))/COUNT(*),3) m1,
 ROUND(COUNTIF(EXISTS(SELECT 1 FROM b WHERE b.user_id=f.user_id AND b.m=DATE_ADD(cohort,INTERVAL 3 MONTH)))/COUNT(*),3) m3
FROM f WHERE cohort BETWEEN '2026-01-01' AND '2026-09-01' GROUP BY cohort ORDER BY cohort
```

**m1: fee and amount by payment method and bank (non-plan completed buys)**
```sql
SELECT payment_method, virtual_account_bank vab, payment_gateway gw, COUNT(*) n, ROUND(AVG(payment_fee)) avg_payment_fee, ROUND(AVG(user_fee)) avg_user_fee, ROUND(AVG(app_covered_fee)) avg_app_fee, ROUND(AVG(amount)) avg_amt
FROM `sayakaya.main.transactions` WHERE type='buy' AND status='completed' AND created_at>='2026-01-01' AND investment_plan_id IS NULL GROUP BY 1,2,3 HAVING n>=300 ORDER BY n DESC
```

**k3: GA subscription funnel, distinct users, 30 days**
```sql
WITH s AS (
 SELECT user_id, (SELECT value.string_value FROM UNNEST(event_params) WHERE key='firebase_screen') screen, event_name
 FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20260927' AND '20261026' AND user_id IS NOT NULL AND event_name IN ('screen_view','order_button','order_created','payment_complete'))
SELECT COUNT(DISTINCT IF(event_name='screen_view' AND screen='SubscriptionFormBottomSheet',user_id,NULL)) form,
 COUNT(DISTINCT IF(event_name='screen_view' AND screen='SubscriptionCheckoutScreen',user_id,NULL)) checkout,
 COUNT(DISTINCT IF(event_name='screen_view' AND screen='SubscriptionPaymentMethodBottomSheet',user_id,NULL)) pay_method_sheet,
 COUNT(DISTINCT IF(event_name='order_button',user_id,NULL)) order_button,
 COUNT(DISTINCT IF(event_name='order_created',user_id,NULL)) order_created,
 COUNT(DISTINCT IF(event_name='screen_view' AND screen='PaymentScreen',user_id,NULL)) payment_screen,
 COUNT(DISTINCT IF(event_name='payment_complete',user_id,NULL)) payment_complete,
 COUNT(DISTINCT IF(event_name='screen_view' AND screen='InvestmentPlanListScreen',user_id,NULL)) plan_list,
 COUNT(DISTINCT IF(event_name='screen_view' AND screen='InvestmentPlanSuccessScreen',user_id,NULL)) plan_success
FROM s
```

**i1: GA `user_id` coverage vs `main.users`, plan users, buyers**
```sql
WITH ga AS (SELECT DISTINCT user_id FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20260801' AND '20261026' AND user_id IS NOT NULL),
pu AS (SELECT DISTINCT user_id FROM `sayakaya.main.investment_plans`),
bu AS (SELECT DISTINCT user_id FROM `sayakaya.main.transactions` WHERE type='buy' AND status='completed' AND created_at>='2026-08-01')
SELECT (SELECT COUNT(*) FROM ga) ga_users,
 (SELECT COUNT(*) FROM ga JOIN `sayakaya.main.users` u ON u.id=ga.user_id) ga_users_in_users,
 (SELECT COUNT(*) FROM pu) plan_users, (SELECT COUNT(*) FROM pu JOIN ga USING(user_id)) plan_users_in_ga,
 (SELECT COUNT(*) FROM bu) buyers_since_aug, (SELECT COUNT(*) FROM bu JOIN ga USING(user_id)) buyers_in_ga
```

**i2: GA `user_pseudo_id` to `user_id` mapping quality**
```sql
-- pseudo id -> user_id mapping quality
SELECT COUNT(DISTINCT user_pseudo_id) devices, COUNT(DISTINCT IF(user_id IS NOT NULL,user_pseudo_id,NULL)) devices_with_uid,
 COUNTIF(user_id IS NULL)/COUNT(*) null_uid_event_share,
 (SELECT COUNT(*) FROM (SELECT user_id FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20260927' AND '20261026' AND user_id IS NOT NULL GROUP BY 1 HAVING COUNT(DISTINCT user_pseudo_id)>1)) users_multi_devices,
 (SELECT COUNT(*) FROM (SELECT user_pseudo_id FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20260927' AND '20261026' AND user_id IS NOT NULL GROUP BY 1 HAVING COUNT(DISTINCT user_id)>1)) devices_multi_users
FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20260927' AND '20261026'
```

### 8.2 Autodebet metrics on the proposed schema

Not executed: the tables in section 2 do not exist, so syntax and logic are unverified until they do. Column names follow section 2.2.

```sql
-- A3 / A4: mandate approval rate and time to approval, by bank and week
SELECT bank_code, DATE_TRUNC(DATE(auth_started_at, 'Asia/Jakarta'), WEEK) AS wk,
  COUNT(*) AS mandates,
  COUNTIF(approved_at IS NOT NULL) AS approved,
  SAFE_DIVIDE(COUNTIF(approved_at IS NOT NULL), COUNT(*)) AS approval_rate,
  APPROX_QUANTILES(TIMESTAMP_DIFF(approved_at, auth_started_at, SECOND), 100)[OFFSET(50)] AS median_secs_to_approval
FROM `sayakaya.main.autodebet_mandates` m
JOIN `sayakaya.main.autodebet_banks` b USING (bank_code)
WHERE NOT (status = 'PENDING_AUTH' AND TIMESTAMP_ADD(auth_started_at, INTERVAL b.auth_timeout_minutes MINUTE) > CURRENT_TIMESTAMP())
GROUP BY 1, 2 ORDER BY 2, 1;

-- D1 / D1b / D5 / D6: debit success, first-attempt success, on-time, days to success, by bank and month
WITH cyc AS (
  SELECT investment_plan_id, cycle_due_date, bank_code,
    LOGICAL_OR(status = 'SUCCESS') AS ok,
    LOGICAL_OR(status = 'SUCCESS' AND attempt_no = 1) AS ok_first,
    MIN(IF(status = 'SUCCESS', DATE(executed_at, 'Asia/Jakarta'), NULL)) AS ok_date
  FROM `sayakaya.autodebet_mart.fct_debit_attempt`
  WHERE cycle_due_date < CURRENT_DATE('Asia/Jakarta') AND status != 'CANCELLED'
  GROUP BY 1, 2, 3
  HAVING LOGICAL_AND(status NOT IN ('SCHEDULED','SUBMITTED','PENDING_BANK','RETRY_SCHEDULED')))
SELECT bank_code, DATE_TRUNC(cycle_due_date, MONTH) AS m, COUNT(*) AS due_cycles,
  SAFE_DIVIDE(COUNTIF(ok), COUNT(*)) AS d1_success,
  SAFE_DIVIDE(COUNTIF(ok_first), COUNT(*)) AS d1b_first_attempt,
  SAFE_DIVIDE(COUNTIF(ok AND ok_date <= cycle_due_date), COUNT(*)) AS d5_on_time,
  AVG(IF(ok, DATE_DIFF(ok_date, cycle_due_date, DAY), NULL)) AS d6_avg_days
FROM cyc GROUP BY 1, 2 ORDER BY 2, 1;

-- D2 / D4: failure share by category
SELECT bank_code, failure_category, COUNT(*) AS failed_attempts,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER (PARTITION BY bank_code)) AS share_of_failures
FROM `sayakaya.autodebet_mart.fct_debit_attempt`
WHERE status IN ('FAILED', 'EXHAUSTED') GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- D3: retry recovery
WITH c AS (
  SELECT investment_plan_id, cycle_due_date,
    LOGICAL_OR(attempt_no = 1 AND status IN ('FAILED','RETRY_SCHEDULED','EXHAUSTED')) AS first_failed,
    LOGICAL_OR(status = 'SUCCESS') AS ok
  FROM `sayakaya.autodebet_mart.fct_debit_attempt` GROUP BY 1, 2)
SELECT COUNTIF(first_failed) AS cycles_first_failed, COUNTIF(first_failed AND ok) AS recovered,
  SAFE_DIVIDE(COUNTIF(first_failed AND ok), COUNTIF(first_failed)) AS retry_recovery_rate
FROM c;

-- R1: retention Mk, Autodebet vs manual (activation excluded; cohort = plan with paid activation)
WITH act AS (
  SELECT p.id AS plan_id, DATE_TRUNC(DATE(t.created_at, 'Asia/Jakarta'), MONTH) AS cohort_m
  FROM `sayakaya.main.investment_plans` p
  JOIN `sayakaya.main.transactions` t ON t.id = p.activation_transaction_id AND t.status = 'completed'),
rec AS (
  SELECT DISTINCT investment_plan_id AS plan_id, DATE_TRUNC(DATE(created_at, 'Asia/Jakarta'), MONTH) AS m
  FROM `sayakaya.main.transactions`
  WHERE investment_plan_id IS NOT NULL AND status = 'completed'),
arm AS (
  SELECT a.plan_id, a.cohort_m, mp.investment_plan_id IS NOT NULL AS autodebet_plan
  FROM act a
  LEFT JOIN (SELECT DISTINCT investment_plan_id FROM `sayakaya.main.autodebet_mandate_plans`) mp
    ON mp.investment_plan_id = a.plan_id)
SELECT k, autodebet_plan,
  COUNTIF(DATE_ADD(cohort_m, INTERVAL k + 1 MONTH) <= DATE_TRUNC(CURRENT_DATE('Asia/Jakarta'), MONTH)) AS matured,
  COUNTIF(DATE_ADD(cohort_m, INTERVAL k + 1 MONTH) <= DATE_TRUNC(CURRENT_DATE('Asia/Jakarta'), MONTH)
          AND r.plan_id IS NOT NULL) AS retained
FROM arm
CROSS JOIN UNNEST([1, 3, 6, 12]) AS k
LEFT JOIN rec r ON r.plan_id = arm.plan_id AND r.m = DATE_ADD(arm.cohort_m, INTERVAL k MONTH)
GROUP BY 1, 2 ORDER BY 1, 2;

-- V5: Autodebet share of paid buy volume
SELECT DATE_TRUNC(DATE(created_at, 'Asia/Jakarta'), MONTH) AS m,
  SUM(IF(autodebet_debit_attempt_id IS NOT NULL, amount, 0)) AS autodebet_idr, SUM(amount) AS all_buy_idr,
  SAFE_DIVIDE(SUM(IF(autodebet_debit_attempt_id IS NOT NULL, amount, 0)), SUM(amount)) AS share
FROM `sayakaya.main.transactions` WHERE type = 'buy' AND status = 'completed' GROUP BY 1 ORDER BY 1;

-- O2: reconciliation mismatch rate by bank and day
SELECT bank_code, DATE(settled_at, 'Asia/Jakarta') AS d, COUNT(*) AS lines,
  SAFE_DIVIDE(COUNTIF(match_status != 'MATCHED'), COUNT(*)) AS mismatch_rate
FROM `sayakaya.main.autodebet_settlement_lines` GROUP BY 1, 2 ORDER BY 2, 1;

-- F-steps from GA (events in 5.2), distinct users per step, 30 days
SELECT bank_code,
  COUNT(DISTINCT IF(event_name = 'autodebet_method_select', user_id, NULL)) AS method_select,
  COUNT(DISTINCT IF(event_name = 'autodebet_bank_select', user_id, NULL)) AS bank_select,
  COUNT(DISTINCT IF(event_name = 'autodebet_auth_redirect', user_id, NULL)) AS auth_redirect,
  COUNT(DISTINCT IF(event_name = 'autodebet_mandate_result', user_id, NULL)) AS mandate_result
FROM `sayakaya.autodebet_mart.fct_funnel_events`
WHERE event_date >= DATE_SUB(CURRENT_DATE('Asia/Jakarta'), INTERVAL 30 DAY) GROUP BY 1;
```

---

## 8. Executive summary for the December 2026 Raker (one page)

**What we are measuring.** Autodebet should turn Nabung Rutin from a reminder invoice (user has to pay by VA or QRIS) into a payment that happens by itself. Today that reminder works poorly: 7 of 30 settled recurring invoices were paid (23.3%, 95% CI 11.8% to 40.9%), against 89-91% for normal VA and bank transfer buys.

**North Star: active recurring savers per month.** Baseline 3 (Oct 2026). 2027 base case: 10 (Q1), 25 (Q2), 40 (Q3), 60 (Q4); conservative 30 and ambitious 120 at Q4.

**Primary metrics and targets (base case, end of Q4 2027):**

| Metric | Baseline (measured) | Q4 2027 base | Range (conservative to ambitious) |
|---|---|---|---|
| Debit success rate | 23.3% (manual invoices) | 87% | 78% to 93% |
| Mandate approval rate | no data | 72% | 60% to 80% |
| First debit success within 35 days | no data | 80% or higher (gate) | set after 8 weeks |
| M3 plan survival, Autodebet | not measurable yet | 60% | 50% to 70% |
| Autodebet share of paid recurring cycles | 0% | 70% | 50% to 85% |

Baselines are measured from BigQuery. Targets are assumptions to be recalibrated after the first 8 weeks of live data.

**Guardrails.** Manual Nabung Rutin plus one-off buy volume per active buyer within -5%; failed-debit rate at most 15%; mandate revocation at most 5% per month; reconciliation mismatch at most 0.5%; support tickets within an agreed ceiling.

**BCA gate (Q3 2027).** At least 385 debit attempts on BNI and Mandiri, D1 at least 85% per bank over the last 4 weeks, approval at least 60%, revocation at most 5%, mismatch at most 0.5%, no bank incident above 24 hours in 30 days.

**Key risks.** (1) Very small base today: 15 external plan users, 3 payers in Oct 2026, so early rates are noisy. (2) 24 of 44 plans are created and then abandoned at the first order; adding a bank redirect there can lose users. (3) Bank terms (limits, retries, settlement files) are unknown. (4) GA cannot tell a plan checkout from a one-off buy; new events are required before launch. (5) Support and dispute data are not in BigQuery.

**Decisions needed from leadership.**
1. Launch date for BNI and Mandiri and the BCA window.
2. Approve a randomised 50/50 rollout for the first 8 weeks (otherwise matching, which is weaker).
3. Fee model: who pays the Autodebet fee.
4. Whether the first transaction is paid by VA/QRIS or by the first debit.
5. Budget and owners for the 14-16 week build (6.6) and a promotion plan to reach sample sizes.
6. Agree the go/no-go thresholds in 4.4.

---
