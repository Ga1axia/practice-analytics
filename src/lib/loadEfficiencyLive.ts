import {
  buildEfficiencyAnalysis,
  companyMonthlyFromTimeEntries,
  type EfficiencyAnalysis,
  type EfficiencyTimeRow,
} from './efficiencyAnalysis';
import { supabase } from './supabase';

const TE_SELECT =
  'id,work_date,actual_hours,is_billable,is_written_off,is_extra,employee_name,project_name,parent_project_name,activity';

const PAGE = 1000;
const MAX_ROWS = 40_000;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First day of the month two months before `now` (enough for last-complete-month pick). */
export function liveEfficiencyWindow(now = new Date()): { fromDate: string; toDate: string } {
  const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { fromDate: ymd(from), toDate: ymd(to) };
}

async function fetchTimeEntriesForWindow(
  fromDate: string,
  toDate: string,
): Promise<{ rows: EfficiencyTimeRow[]; error: string | null }> {
  const rows: EfficiencyTimeRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('pa_time_entries')
      .select(TE_SELECT)
      .gte('work_date', fromDate)
      .lte('work_date', toDate)
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return { rows: [], error: error.message || 'Failed to load time entries' };
    }
    const chunk = (data || []) as EfficiencyTimeRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return { rows, error: null };
}

/**
 * Firm Bill/NB efficiency from live `pa_time_entries` (not the stale monthly snapshot).
 * Returns null when the table is empty or unreadable so callers can fall back.
 */
export async function loadLiveEfficiencyAnalysis(
  now = new Date(),
): Promise<EfficiencyAnalysis | null> {
  try {
    const { fromDate, toDate } = liveEfficiencyWindow(now);
    const { rows, error } = await fetchTimeEntriesForWindow(fromDate, toDate);
    if (error || !rows.length) return null;
    const monthly = companyMonthlyFromTimeEntries(rows);
    return buildEfficiencyAnalysis(monthly, now);
  } catch {
    return null;
  }
}
