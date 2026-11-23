# GA vs DB reconciliation (Phase 2)
Run 2026-11-22 WIB. Window 2026-10-01 to 2026-11-21 (52 days; Asia/Jakarta; GA `event_date` is already WIB, DB timestamps shifted +7 h). DB is source of truth. Same exclusion on both sides: GA mapped through `user_id` to cohort C; devices without `user_id` cannot be excluded or counted. Scripts: `45_ga_db.sql`, `22_churn_ga.sql`.

| Stage | GA metric | GA | DB metric | DB | GA / DB | Likely cause (Inferred unless stated) | Fix |
|---|---|---|---|---|---|---|---|
| Register | `register_success`, users in cohort C | 1,229 | users with `created_at` in window | 1,297 | 94.8% | Missing events: 70 DB registrations (5.4%) have no GA `register_success` for the same user_id (Observed). Possible: event not sent offline/ad-block/consent, web or non-app registration path | Log register server-side; check whether web sign-up exists |
| Register (duplicates) | `register_success` events vs users, all users | 1,281 events | distinct users | 1,239 | 3.4% extra events | Event fires more than once per user (Observed) | Fire once per user_id; dedupe in reports |
| KYC | `kyc_success`, users in cohort C | 955 | KYC approved (`verified_at` in window) | 905 | 105.5% | GA fires on submission, not approval: 97 GA users are not approved in the DB (Observed). DB approved matched in GA 855 of 905 (94.5%) | Rename to `kyc_submitted`; add `kyc_approved` from the server |
| KYC (compare to submitted) | `kyc_success`, users in cohort C | 955 | registered in window, status verified or failed | 988 | 96.7% | Closer match supports "GA = submission". Windows differ (registered in window vs event date), so approximate | |
| KYC start | `kyc_start`, users in cohort C | 1,157 | no DB equivalent | n/a | | Not available: DB records no 'started' state | |
| Order | `order_created`, users in cohort C | 347 | users with a buy transaction (any status, not bonus) | 365 | 95.1% | Missing events (Observed gap 18 users) | Same as register |
| Paid | `payment_complete`, users in cohort C | 299 | users with successful buy | 332 | 90.1% | DB successful buyers matched in GA: 294 of 332 (88.6%). Status `verified` (set by operations, 7 users) is not triggered in the app, so GA cannot see it; no `verified_by_operational` buyers in this window | Server-side purchase event on status change |
| Paid (events) | `payment_complete` events, cohort C | 674 | successful buy transactions | 826 | 81.6% | Fewer events than transactions; payment on a different day than creation also shifts counts (window by event date vs `created_at`) | |

What this means: GA sees roughly 9 in 10 of the registrations, orders and payments in the DB, so use GA for trends and the DB for exact counts; `kyc_success` in GA means "KYC submitted", not "approved".

## Other checks (Observed)
- `user_id` is set only after login: `first_open` has 0 users with `user_id` (Phase 1 DQ #25, as of 2026-11-09, not refreshed), and 3,577 of 4,031 devices (88.7%) have rows without it (`22_churn_ga.sql`). Pre-login steps (install, open, sign-up start) can only be counted per device.
- GA to DB mapping: 2,764 of 2,767 GA user_ids exist in `main.users`. Of 2,767 GA users: 155 are RAIZ/RAIZKAYA, 78 HNWI, 2,531 kept (`22_churn_ga.sql`).
- Timezone: GA `event_date` is WIB; DB `created_at` is UTC and shifted +7 h. Checked on one day only (as of 2026-11-09, not refreshed).
- Not tested: bot traffic (no bot flag in the export), consent mode / ad-block (no consent field read), consent rate.
- What this means: most visitors are anonymous until they log in, so GA cannot follow one person from install to first buy.

## Fix list (Proposed, order by value)
1. Server-side events for register, KYC approved, order created, payment complete (closes 70 register and 38 paid user gaps in this window).
2. Rename or split `kyc_success` into submitted and approved.
3. Dedupe `register_success`.
4. Send `user_id` (or a hashed id) from the first screen so pre-login funnel steps can be tied to users.
5. Fill `campaign`/`source` consistently (campaign is empty for most registrations).
