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
| **Admin** | Full Practice Analytics + dashboard management (BQE connect/sync, project list writes). Includes all executive capabilities. |
| **Executive (`exec`)** | Firm analytics sheets (Executive, Main Report, Project Analysis, Workload, Financial A/R, Project Dashboard/List, Staffing). No BQE connect. |
| **Project lead** | Employee workspace; contract / billed / outstanding and team hours on projects where they are **lead** (Project List manager or `pa_project_members.role = lead`). |
| **Employee** | Employee workspace for projects they belong to (membership or hours). Lead privileges only on projects where they are assigned as lead. |
| **Customer** | Client status tracker + Project Schedule (Client’s Comments editable only) |

### Microsoft firm accounts (`@mdesignsarchitects.com`)

Any firm Microsoft 365 user can sign in. Profiles are auto-created on first sign-in:

| Email local-part | Role |
|------------------|------|
| `taihei`, `junaidq` | admin |
| `malikajunaid` (also `malika`) | exec |
| `avery` / `avery.cobe` | project_lead |
| everyone else | employee |

### Production vs demo

| Path | Purpose |
|------|---------|
| `/` | Production portal — real sign-in only, no demo chrome or seeded schedule fallbacks |
| `/demo` | Demo tour — demo account cards, Demo labels, schedule seed data when DB rows are missing |

### Demo accounts (use on `/demo` only)

| Role | Email | Password | Bound to |
|------|-------|----------|----------|
| Admin | `admin@mdesigns.test` | `DemoAdmin2026!` | — |
| Exec | `malika.junaid@mdesigns.test` | `DemoEmployee2026!` | Malika Junaid |
| Project lead | `avery.cobe@mdesigns.test` | `DemoEmployee2026!` | Avery Cobe |
| Employee | `arnita@mdesigns.test` | `DemoEmployee2026!` | Arnita Serri |
| Employee | `nini@mdesigns.test` | `DemoEmployee2026!` | Ni Ni |
| Employee | `zhengrui@mdesigns.test` | `DemoEmployee2026!` | Zhengrui He |
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
| `BQE_REDIRECT_URI` | Server — must match Developer Portal (local: `http://localhost:5173/api/bqe/callback`; prod: `https://practice-analytics-six.vercel.app/api/bqe/callback`) |
| `BQE_APP_ORIGIN` | Server — e.g. `http://localhost:5173` or `https://practice-analytics-six.vercel.app` |
| `ANTHROPIC_API_KEY` | Server only |

On Vercel, set the same server vars in Project → Settings → Environment Variables (Production + Preview). Also register the **production** callback URL in the [BQE Developer Portal](https://api-developer.bqecore.com). Hobby plan caps functions at ~10s — the UI syncs in small monthly steps automatically on Vercel.

### Microsoft (Azure) sign-in

Production staff sign in with **Google** or **Microsoft 365** (`@mdesignsarchitects.com`). Email/password is removed from production login (demo role cards on `/demo` still use seeded passwords).

1. **Google Cloud Console** → APIs & Services → Credentials → Create OAuth client (Web).
   - Authorized JavaScript origins: `https://practice-analytics-six.vercel.app`, `http://localhost:5173`
   - Authorized redirect URI: `https://wmlhewtqaqqpxhcqfbqq.supabase.co/auth/v1/callback`
2. **Supabase** → Authentication → Providers → Google: enable, paste Client ID + Client Secret.
3. **Azure Entra ID** (Microsoft) — same as before; redirect URI:
   `https://wmlhewtqaqqpxhcqfbqq.supabase.co/auth/v1/callback`
4. Authentication → URL Configuration → Redirect URLs, allow:
   - `http://localhost:5173`
   - `http://localhost:5173/demo`
   - `https://practice-analytics-six.vercel.app`
   - `https://practice-analytics-six.vercel.app/demo`
   - `https://*.vercel.app/**` (preview deploys)

Admins get a **Test as…** control to view the portal as any `pa_profiles` user (UI only; JWT stays admin).

## Production

- Site: https://practice-analytics-six.vercel.app
- Repo: https://github.com/Ga1axia/practice-analytics

## Manual test plan

- Sign in as admin → sheets A-1–A-6 including BQE Connect on Executive
- Sign in as exec (Malika demo) → firm sheets, no BQE Connect
- Sign in as Avery → employee workspace with lead financials on managed projects
- Sign in as Arnita / Ni Ni / Zhengrui → employee workspace; no firm sheets / A/R
- Sign in as customer → status tracker + schedule for Elena Vargas; only Client’s Comments editable
- Sign in as Sinnathamby → client portal for **Thiru and Renuga Sinnathamby - 26-012**
- On `/` with empty schedules, employee calendar/tasks show empty states (no demo seed)
- On `/demo` with empty schedules, employee views may show demo seed tags
- Signed-out users cannot read `pa_*` tables
- Q&A requires auth; customers blocked from Ask This Sheet; firm financial Q&A is exec/admin only
- Microsoft OAuth returns to `/` or `/demo` (same origin you started from)
- `/` login has Microsoft as the primary action, no demo account cards, and empty credential fields
- `/demo` shows demo account cards on the right and Demo branding
