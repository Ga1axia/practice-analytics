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
| Employee | `arnita@mdesigns.test` | `DemoEmployee2026!` | Arnita Serri (her managed projects) |
| Employee | `nini@mdesigns.test` | `DemoEmployee2026!` | Ni Ni (her managed projects) |
| Employee | `zhengrui@mdesigns.test` | `DemoEmployee2026!` | Zhengrui He (his managed projects) |
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

Open the Vite URL (usually http://localhost:5173) for production sign-in, or http://localhost:5173/demo for the demo tour.

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

- `/` login has no demo account cards and empty credential fields
- `/demo` shows demo account cards and Demo branding
- Sign in as admin → sheets A-1–A-5 including Project Schedule (editable)
- Sign in as Arnita / Ni Ni / Zhengrui → employee workspace (hours, projects, tasks, calendar, project detail); no firm sheets / A/R
- Sign in as customer → status tracker + schedule for Elena Vargas; only Client’s Comments editable
- On `/` with empty schedules, employee calendar/tasks show empty states (no demo seed)
- On `/demo` with empty schedules, employee views may show demo seed tags
- Signed-out users cannot read `pa_*` tables
- Q&A requires auth; customers blocked from Ask This Sheet
