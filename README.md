# Sayakaya Analytics

A live analytics dashboard for the Sayakaya mutual-fund platform, reading directly
from BigQuery (`project: sayakaya`). Built for data analysts: KPI monitoring,
interactive charts, a filterable transaction explorer, a read-only SQL lab, and
CSV / Excel export everywhere.

It is a small Node.js app — an Express backend that talks to BigQuery with a
service account, and a zero-build static frontend. No framework toolchain, no
database to run; you only need Node and a service-account key.

---

## What you get

**Overview** — Platform AUM (live holdings × current NAV), total/verified users,
buy & sell volume for the selected date range, active users, transaction counts,
active funds, and 30-day new users. Plus a volume trend chart (day/week/month),
breakdowns by transaction type and status, user-verification mix, AUM by fund
type, and a largest-funds table.

**Data explorer** — Paginated transaction browser with date-range, type, status,
and ID/user search. Export the full filtered set to CSV or Excel.

**SQL lab** — Write your own read-only `SELECT` / `WITH` queries against the
warehouse, estimate the bytes scanned before running, view results, and export
them. Mutations, multi-statements, and the `password` column are blocked.

---

## Prerequisites

1. **Node.js 18+** — check with `node -v`.
2. **A Google Cloud service account** with read access to the `sayakaya` project's
   BigQuery data. Roles needed:
   - `roles/bigquery.dataViewer` (read the tables)
   - `roles/bigquery.jobUser` (run queries — queries are billed to the project)

### Creating the service-account key

In the Google Cloud console, project **sayakaya**:

1. IAM & Admin → Service Accounts → **Create service account**
   (e.g. `analytics-dashboard`).
2. Grant it **BigQuery Data Viewer** and **BigQuery Job User**.
3. Open the account → Keys → **Add key → Create new key → JSON**.
4. Save the downloaded file as `service-account.json` in the project root
   (next to `package.json`). It is already in `.gitignore` — never commit it.

> Prefer least privilege: a viewer/job-user account cannot modify your data, and
> the SQL lab is read-only on top of that.

---

## Setup

```bash
# 1. install dependencies
npm install

# 2. create your config from the template
cp .env.example .env
#    then open .env and confirm the values (see below)

# 3. run
npm start
```

Open **http://localhost:8080**.

### .env settings

| Variable | Meaning |
|---|---|
| `GCP_PROJECT_ID` | Project queried and billed. Default `sayakaya`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to your service-account JSON. |
| `PORT` | Port the app serves on (default 8080). |
| `MAX_BYTES_BILLED` | Hard cap on bytes scanned per query — your cost guardrail. Default 2 GB. |
| `BQ_LOCATION` | BigQuery location. The `main` dataset is in `asia-southeast2`. |
| `APP_PASSWORD` | Optional. If set, the app shows a password gate and requires it on every request. Leave blank to disable. |

---

## How it works

```
public/            static frontend (no build step)
  index.html       layout + tabs
  styles.css       design tokens (indigo / amber, mono numerals)
  app.js           fetch + Chart.js rendering + exports
server/
  index.js         Express app + all /api routes
  bigquery.js      BigQuery client, dry-run, read-only SQL validator
  queries.js       parameterized analytical queries
  export.js        CSV + Excel (exceljs) generators
```

The frontend calls JSON endpoints under `/api/*`; the backend runs parameterized
queries and returns rows. All user input (dates, filters, paging) goes through
**named query parameters**, never string concatenation. The only place raw SQL
runs is the SQL lab, which is validated to be a single read-only statement.

### Cost control

Every query sets `maximumBytesBilled` from `MAX_BYTES_BILLED`. The SQL lab also
offers a dry-run **Estimate cost** button so an analyst sees the scan size before
spending. Ad-hoc results are capped at 5,000 rows in the UI (100,000 for export).

### Security notes

- The `users.password` column is blocked in the SQL lab and never selected by any
  endpoint.
- The SQL lab rejects anything that is not a single `SELECT` / `WITH`, and blocks
  DML/DDL keywords.
- Set `APP_PASSWORD` for a quick shared-secret gate. For real multi-user auth,
  put this behind your own SSO / reverse proxy.

---

## Deploying

Any Node host works. For Google Cloud Run (same project, simplest auth):

```bash
gcloud run deploy sayakaya-analytics \
  --source . \
  --project sayakaya \
  --region asia-southeast2 \
  --allow-unauthenticated \
  --set-env-vars MAX_BYTES_BILLED=2000000000,BQ_LOCATION=asia-southeast2
```

On Cloud Run you can skip the JSON key entirely: deploy with a runtime service
account that has the two BigQuery roles, and the app picks up credentials
automatically (Application Default Credentials). Set `APP_PASSWORD` (or require
authenticated invocations) before exposing it publicly.

---

## Extending it

- **New metric / chart:** add a builder in `server/queries.js`, expose it as a
  route in `server/index.js`, then fetch and render it in `public/app.js`.
- **New dataset:** your project also has `aum`, `revenue_logs`, `sinvest`,
  `dormant`, `adjust_analytics`, and Firebase datasets — the same query pattern
  works against any of them.
- **Scheduled snapshots:** point a Cloud Scheduler job at an export endpoint to
  drop daily CSV/XLSX into Cloud Storage.
