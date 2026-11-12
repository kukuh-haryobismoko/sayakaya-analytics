# GA vs DB reconciliation (Phase 2)
Run 2026-11-09 18:34 WIB. Window 2026-10-01 to 2026-11-08 (Asia/Jakarta; GA `event_date` is already WIB, DB timestamps shifted +7 h). DB is source of truth. Same exclusion on both sides: GA mapped through `user_id` to cohort C; devices without `user_id` cannot be excluded or counted. Scripts: `45_ga_db.sql`, `22_churn_ga.sql`.

| Stage | GA metric | GA | DB metric | DB | GA / DB | Likely cause (Inferred unless stated) | Fix |
|---|---|---|---|---|---|---|---|
| Register | `register_success`, users in cohort C | 788 | users with `created_at` in window | 832 | 94.7% | Missing events: 45 DB registrations (5.4%) have no GA `register_success` for the same user_id (Observed). Possible: event not sent offline/ad-block/consent, web or non-app registration path | Log register server-side; check whether web sign-up exists |
| Register (duplicates) | `register_success` events vs users, all users | 831 events | distinct users | 797 | 4.3% extra events | Event fires more than once per user (Observed) | Fire once per user_id; dedupe in reports |
| KYC | `kyc_success`, users in cohort C | 617 | KYC approved (`verified_at` in window) | 572 | 107.9% | GA fires on submission, not approval: 68 GA users are not approved in the DB (Observed). DB approved matched in GA 542 of 572 (94.8%) | Rename to `kyc_submitted`; add `kyc_approved` from the server |
| KYC (compare to submitted) | `kyc_success`, users in cohort C | 617 | registered in window, status verified or failed | 636 | 97.0% | Closer match supports "GA = submission". Windows differ (registered in window vs event date), so approximate | |
| KYC start | `kyc_start`, users in cohort C | 746 | no DB equivalent | n/a | | Not available: DB records no 'started' state | |
| Order | `order_created`, users in cohort C | 287 | users with a buy transaction (any status, not bonus) | 304 | 94.4% | Missing events (Observed gap 17 users) | Same as register |
| Paid | `payment_complete`, users in cohort C | 242 | users with successful buy | 278 | 87.1% | DB successful buyers matched in GA: 238 of 278 (85.6%). Statuses set by operations (`verified_by_operational` 27 users, `verified` 10) are not triggered in the app, so GA cannot see them | Server-side purchase event on status change |
| Paid (events) | `payment_complete` events, cohort C | 500 | successful buy transactions | 626 | 79.9% | Fewer events than transactions; payment on a different day than creation also shifts counts (window by event date vs `created_at`) | |

## Other checks (Observed)
- `user_id` is set only after login: `first_open` has 0 users with `user_id`, and 2,869 of 3,375 devices (85%) have rows without it (Phase 1 DQ #25). Pre-login steps (install, open, sign-up start) can only be counted per device.
- GA to DB mapping: 2,254 of 2,257 GA user_ids exist in `main.users`. Of 2,257 GA users: 144 are RAIZ/RAIZKAYA, 77 HNWI, 2,033 kept (Phase 1 DQ #26).
- Timezone: GA `event_date` is WIB; DB `created_at` is UTC and shifted +7 h. Checked on one day only.
- Not tested: bot traffic (no bot flag in the export), consent mode / ad-block (no consent field read), consent rate.

## Fix list (Proposed, order by value)
1. Server-side events for register, KYC approved, order created, payment complete (closes 45 register and 40 paid user gaps in this window).
2. Rename or split `kyc_success` into submitted and approved.
3. Dedupe `register_success`.
4. Send `user_id` (or a hashed id) from the first screen so pre-login funnel steps can be tied to users.
5. Fill `campaign`/`source` consistently (campaign is empty for most registrations).
