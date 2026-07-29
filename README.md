# Practice Analytics

M. Designs Architects practice dashboard — Vite + React + TypeScript on Vercel, data in Supabase, sheet Q&A via Claude (`/api/ask`).

## Stack

- Vite + React 19 + TypeScript
- Chart.js / react-chartjs-2
- Supabase (`pa_*` tables, anon SELECT)
- Vercel serverless `api/ask.ts` → Anthropic Messages API

## Supabase project

**M Designs Practice Analytics** — ref `wmlhewtqaqqpxhcqfbqq`  
URL: `https://wmlhewtqaqqpxhcqfbqq.supabase.co`

Schema: [`supabase/schema.sql`](supabase/schema.sql)

## Local setup

```bash
cd "Practice Analytics"
cp .env.example .env.local
# fill VITE_SUPABASE_* (and optionally ANTHROPIC_API_KEY + SUPABASE_SERVICE_ROLE_KEY)
npm install
npm run dev
```

Open the Vite URL (usually http://localhost:5173).

### Q&A API locally

Vite alone does not run `/api/ask`. Use:

```bash
npm run dev:api
# or: npx vercel dev --listen 3000
```

Set in `.env.local` / Vercel:

| Var | Where |
|-----|--------|
| `VITE_SUPABASE_URL` | Client + optional server fallback |
| `VITE_SUPABASE_ANON_KEY` | Client |
| `SUPABASE_URL` | Server (`/api/ask`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Seed script (preferred); `/api/ask` can use anon for reads |
| `ANTHROPIC_API_KEY` | Server only — without it, Q&A returns the stub message |

## Re-seed from dummy HTML JSON

Source JSON: `scripts/source/dashboard-data.json`

```bash
# Requires service role key in .env.local as SUPABASE_SERVICE_ROLE_KEY
# (or temporary anon insert policies — do not leave those enabled)
npm run seed
```

## Deploy to Vercel

1. Import the `Practice Analytics` folder as a Vercel project (Root Directory = that folder).
2. Set env vars above (Production + Preview).
3. Build command: `npm run build` · Output: `dist`
4. Deploy. SPA rewrites are in `vercel.json`.

## Manual test plan

- Sheet A-1: KPIs, filters, table sort/page, charts load from Supabase
- Sheet A-2: employee/team selection, granulation, charts
- Sheet A-3: aging buckets, as-of date, revenue/aging charts, tables
- Q&A without `ANTHROPIC_API_KEY`: stub message
- Q&A with key via `vercel dev` / deploy: grounded answer
- `npm run build` succeeds
