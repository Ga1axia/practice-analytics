import { useEffect, useState } from 'react';
import {
  loadHistoricalTimeEntries,
  type HistoricalTimeEntryFilters,
} from '../lib/staffingTimeEntries';
import type { TimeEntryLite } from '../lib/staffingTypes';
import { downloadCsv, toCsv } from '../lib/downloadCsv';
import { downloadTablePdf } from '../lib/downloadPdf';

export type TimeEntryDrillFilter = {
  title: string;
  employeeName: string;
  fromDate: string;
  toDate: string;
  /** Free-text match against project / parent / phase / activity */
  projectQuery?: string;
  activityQuery?: string;
};

function matchesActivity(row: TimeEntryLite, q: string | undefined): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const blob = `${row.activity || ''} ${row.phase || ''} ${row.phase_name || ''}`.toLowerCase();
  return blob.includes(needle);
}

export function TimeEntryDrillPanel({
  filter,
  onClose,
}: {
  filter: TimeEntryDrillFilter;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TimeEntryLite[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const base: HistoricalTimeEntryFilters = {
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        employee: filter.employeeName,
        projectQuery: filter.projectQuery,
        page: 0,
        pageSize: 100,
      };
      const res = await loadHistoricalTimeEntries(base);
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
        setRows([]);
        setTotal(0);
      } else {
        const filtered = res.rows.filter((r) => matchesActivity(r, filter.activityQuery));
        setRows(filtered);
        setTotal(filter.activityQuery ? filtered.length : res.total);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const entryHeaders = [
    'Date',
    'Project',
    'Parent',
    'Phase',
    'Activity',
    'Hours',
    'Billable',
    'Memo',
  ] as const;

  function entryBody() {
    return rows.map((r) => [
      r.work_date,
      r.project_name,
      r.parent_project_name,
      r.phase_name || r.phase,
      r.activity,
      r.actual_hours,
      r.is_billable ? 'Y' : 'N',
      r.memo || r.description,
    ]);
  }

  function onExportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`time-entries-${stamp}.csv`, toCsv([...entryHeaders], entryBody()));
  }

  function onExportPdf() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTablePdf({
      filename: `time-entries-${stamp}.pdf`,
      title: filter.title,
      subtitle: `${filter.employeeName} · ${filter.fromDate} → ${filter.toDate} · ${rows.length} entries`,
      headers: [...entryHeaders],
      rows: entryBody(),
    });
  }

  return (
    <div className="emp-drill panel" role="dialog" aria-labelledby="emp-drill-title">
      <div className="emp-drill-head">
        <div>
          <p className="pd-kicker">Time entries</p>
          <h3 id="emp-drill-title">{filter.title}</h3>
          <p className="pd-muted">
            {filter.fromDate} → {filter.toDate}
            {loading ? '' : ` · ${total} entr${total === 1 ? 'y' : 'ies'}`}
          </p>
        </div>
        <div className="emp-drill-actions">
          <button
            type="button"
            className="emp-primary-btn"
            disabled={!rows.length}
            onClick={onExportCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="cp-text-btn"
            disabled={!rows.length}
            onClick={onExportPdf}
          >
            Export PDF
          </button>
          <button type="button" className="cp-text-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {loading ? <p className="pd-muted">Loading entries…</p> : null}
      {error ? <p className="plist-upload-err">{error}</p> : null}
      {!loading && !error && !rows.length ? (
        <p className="pd-muted">No matching time entries in this window.</p>
      ) : null}
      {rows.length ? (
        <div className="emp-drill-table-wrap">
          <table className="emp-drill-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Phase</th>
                <th>Activity</th>
                <th>Hours</th>
                <th>Billable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id || `${r.work_date}-${r.bqe_time_entry_id}`}>
                  <td className="mono">{r.work_date}</td>
                  <td title={r.parent_project_name || r.project_name || ''}>
                    {r.parent_project_name || r.project_name || '—'}
                  </td>
                  <td>{r.phase_name || r.phase || '—'}</td>
                  <td>{r.activity || '—'}</td>
                  <td className="mono">{Number(r.actual_hours || 0).toFixed(1)}</td>
                  <td>{r.is_billable ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
