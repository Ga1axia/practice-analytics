# Practice Analytics

M. Designs Architects practice dashboard — Vite + React + TypeScript on Vercel, data in Supabase Auth + RLS, sheet Q&A via Claude (`/api/ask`).

## Stack

- Vite + React 19 + TypeScript
- Chart.js / react-chartjs-2
- Supabase Auth + `pa_*` tables with role RLS
- Vercel serverless `api/ask.ts` → Anthropic Messages API (requires signed-in JWT)

## Roles

| Role | Access |
|------|--------|
| **Admin** | Full Practice Analytics (Project Analysis, Workload, Financial A/R, Project Schedule) |
| **Employee** | Multi-page workspace: hours, project list (active by default), project detail — no firm sheets |
| **Customer** | Client status tracker + Project Schedule (Client’s Comments editable only) |

### Production vs demo

| Path | Purpose |
|------|---------|
| `/` | Production portal — real sign-in only, no demo chrome or seeded schedule fallbacks |
| `/demo` | Demo tour — demo account cards, Demo labels, schedule seed data when DB rows are missing |

### Demo accounts (use on `/demo` only)

| Role | Email | Password | Bound to |
|------|-------|----------|----------|
| Admin | `admin@mdesigns.test` | `DemoAdmin2026!` | — |
| Employee | `arnita@mdesigns.test` | `DemoEmployee2026!` | Arnita Serri |
| Employee | `nini@mdesigns.test` | `DemoEmployee2026!` | Ni Ni |
| Employee | `zhengrui@mdesigns.test` | `DemoEmployee2026!` | Zhengrui He |
| Employee | `avery.cobe@mdesigns.test` | `DemoEmployee2026!` | Avery Cobe |
| Customer | `sinnathamby@mdesigns.test` | `DemoCustomer2026!` | Thiru & Renuka Sinnathamby (26-012, live project) |
| Customer | `customer@mdesigns.test` | `DemoCustomer2026!` | Elena Vargas (1 project) |
| Customer | `jordan.blake@mdesigns.test` | `DemoCustomer2026!` | Jordan Blake (demo remodel) |
| Customer | `sam.rivera@mdesigns.test` | `DemoCustomer2026!` | Sam Rivera (demo ADU) |
| Customer | `casey.nguyen@mdesigns.test` | `DemoCustomer2026!` | Casey Nguyen (demo new build) |
| Customer | `morgan.patel@mdesigns.test` | `DemoCustomer2026!` | Morgan Patel (demo interior) |
| Customer | `alex.torres@mdesigns.test` | `DemoCustomer2026!` | Alex Torres (demo commercial) |

Re-seed fake customers: `node --env-file=.env.local scripts/seed-demo-customers.mjs`

### Active employees (from time entries)

Anyone with hours in the last 30 days is provisioned as an **employee** auth user (`pa_profiles.role = employee`, `employee_name` matched to BQE). Emails are `firstname.lastname@mdesigns.test` (password `DemoEmployee2026!`) unless listed above.

Re-run after a TE sync:

```bash
npm run provision:employees
# or: node --env-file=.env.local scripts/provision-employees-from-time.mjs --days=30
```

Sign in on `/` or `/demo` with those credentials to open the employee portal.

## Supabase project

**M Designs Practice Analytics** — ref `wmlhewtqaqqpxhcqfbqq`  
URL: `https://wmlhewtqaqqpxhcqfbqq.supabase.co`

Schema: [`supabase/schema.sql`](supabase/schema.sql)

## Local setup

```bash
cd "Practice Analytics"
cp .env.example .env.local
# fill VITE_SUPABASE_* + server keys (see table)
npm install
# Terminal 1 — API (BQE connect/sync, Ask This Sheet)
npm run dev:api
# Terminal 2 — UI
npm run dev
```

Open the Vite URL (usually http://localhost:5173) for production sign-in, or http://localhost:5173/demo for the demo tour. BQE Connect/Sync requires **both** terminals — Vite proxies `/api` to `http://127.0.0.1:8787`.

| Var | Where |
|-----|--------|
| `VITE_SUPABASE_URL` | Client |
| `VITE_SUPABASE_ANON_KEY` | Client |
| `SUPABASE_URL` | Server (`/api/*`) |
| `SUPABASE_ANON_KEY` | Server (user JWT + RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server — BQE token store + project sync (required) |
| `CORE_CLIENT_ID` / `CORE_CLIENT_SECRET` | Server — BQE OAuth app |
| `BQE_REDIRECT_URI` | Server — must match Developer Portal (local: `http://localhost:5173/api/bqe/callback`) |
| `BQE_APP_ORIGIN` | Server — e.g. `http://localhost:5173` |
| `ANTHROPIC_API_KEY` | Server only |

On Vercel, set the same server vars in Project → Settings → Environment Variables (Production + Preview).

## Production

- Site: https://practice-analytics-six.vercel.app
- Repo: https://github.com/Ga1axia/practice-analytics

## Manual test plan

- `/` login has no demo account cards and empty credential fields
- `/demo` shows demo account cards and Demo branding
- Sign in as admin → sheets A-1–A-5 including Project Schedule (editable)
- Sign in as Arnita / Ni Ni / Zhengrui → employee workspace (hours, projects, tasks, calendar, project detail); no firm sheets / A/R
- Sign in as customer → status tracker + schedule for Elena Vargas; only Client’s Comments editable
- Sign in as Sinnathamby → client portal for **Thiru and Renuga Sinnathamby - 26-012**
- On `/` with empty schedules, employee calendar/tasks show empty states (no demo seed)
- On `/demo` with empty schedules, employee views may show demo seed tags
- Signed-out users cannot read `pa_*` tables
- Q&A requires auth; customers blocked from Ask This Sheet
