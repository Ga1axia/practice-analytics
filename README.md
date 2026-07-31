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
| **Employee** | Own assigned projects + workload + Project Schedule (no firm A/R) |
| **Customer** | Client status tracker + Project Schedule (Client’s Comments editable only) |

### Demo accounts

| Role | Email | Password | Bound to |
|------|-------|----------|----------|
| Admin | `admin@mdesigns.test` | `DemoAdmin2026!` | — |
| Employee | `employee@mdesigns.test` | `DemoEmployee2026!` | Avery Cobe |
| Customer | `customer@mdesigns.test` | `DemoCustomer2026!` | Elena Vargas (1 project) |

## Supabase project

**M Designs Practice Analytics** — ref `wmlhewtqaqqpxhcqfbqq`  
URL: `https://wmlhewtqaqqpxhcqfbqq.supabase.co`

Schema: [`supabase/schema.sql`](supabase/schema.sql)

## Local setup

```bash
cd "Practice Analytics"
cp .env.example .env.local
# fill VITE_SUPABASE_* (and optionally ANTHROPIC_API_KEY)
npm install
npm run dev
```

Open the Vite URL (usually http://localhost:5173) and sign in.

### Q&A API locally

```bash
npm run dev:api
```

| Var | Where |
|-----|--------|
| `VITE_SUPABASE_URL` | Client |
| `VITE_SUPABASE_ANON_KEY` | Client |
| `SUPABASE_URL` | Server (`/api/ask`) |
| `SUPABASE_ANON_KEY` | Server (user JWT + RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Seed script only |
| `ANTHROPIC_API_KEY` | Server only |

## Production

- Site: https://practice-analytics-six.vercel.app
- Repo: https://github.com/Ga1axia/practice-analytics

## Manual test plan

- Sign in as admin → sheets A-1–A-4 including Project Schedule (editable)
- Sign in as employee → A-1, A-2, A-3 Project Schedule for Avery projects; no A/R
- Sign in as customer → status tracker + schedule for Elena Vargas; only Client’s Comments editable
- Signed-out users cannot read `pa_*` tables
- Q&A requires auth; customers blocked from Ask This Sheet
