# Staffing history

Admin sheet **A-6 · Staffing**. Focus is **observed** hours from persisted BQE time entries (`pa_time_entries`) — how much people work, phase/project mix, activity specialties, and project touch size. Not weekly capacity planning.

Planning tables (`pa_employee_capacity`, allocations, etc.) may still exist in the schema from earlier work; the Staffing UI does not drive them.

## Apply migration

```bash
# Or apply in the Supabase SQL editor:
# supabase/migrations/20260811_staffing_workload.sql
# supabase/migrations/20260812_staffing_te_grants.sql
```

## Admin workflow

1. Connect BQE CORE (Executive → BQE panel).
2. Run **Import historical time entries** (Staffing sheet or BQE panel). Default since = 36 months.
3. Open **Staffing** → **People & patterns**: pick a trailing window (30/90/180/365/all).
4. Click a person for phase / project / activity breakdown and project-size detail.
5. Use **Raw time entries** to browse/filter the underlying rows.

## Verification SQL

```sql
select count(*) as total_entries from pa_time_entries;

select employee_name, count(*), sum(actual_hours) as hours
from pa_time_entries
group by 1 order by hours desc nulls last;

select date_trunc('month', work_date)::date as month, count(*), sum(actual_hours)
from pa_time_entries
group by 1 order by 1;

select employee_name,
       coalesce(parent_project_name, project_name) as project,
       coalesce(phase_name, phase) as phase,
       sum(actual_hours) as hrs
from pa_time_entries
where work_date >= current_date - 90
group by 1, 2, 3
order by 1, hrs desc;
```

## Known limitations

- BQE project **manager** is not necessarily the person logging time (`resource`).
- Phase identity uses CORE hierarchy when available; otherwise falls back to project labels.
- Roster names that never appear on time entries show zero observed hours until names match.
