import { useMemo, useRef, useState } from 'react';
import { HBarChart, StackedCountHBar } from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { useAuth } from '../hooks/useAuth';
import { useDashboard } from '../hooks/useDashboard';
import {
  matchProcessPhaseIndex,
  PROCESS_PHASES,
} from '../lib/architecturalProcess';
import { fmtUSDk, palette } from '../lib/format';
import { parseProjectListFile } from '../lib/parseProjectList';
import { buildClientHierarchy } from '../lib/projectListHierarchy';
import { rowOutstanding } from '../lib/receivable';
import { supabase } from '../lib/supabase';
import type { DashboardData } from '../lib/types';

const OTHER_PHASE_COLOR = '#9AA8B5';

export function Executive({ data }: { data: DashboardData }) {
  const { profile } = useAuth();
  const { reload } = useDashboard();
  const isAdmin = profile?.role === 'admin';
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const hierarchy = useMemo(() => buildClientHierarchy(data.projects), [data.projects]);

  const summary = useMemo(() => {
    const clients = hierarchy.length;
    const projects = hierarchy.reduce((a, c) => a + c.projects.length, 0);
    const phases = hierarchy.reduce((a, c) => a + c.phaseCount, 0);
    const contract = data.kpi_all.contract_amount;
    const billed = data.kpi_all.billed;
    const outstanding = data.projects
      .filter((r) => r.row_kind !== 'project')
      .reduce((a, r) => a + Math.max(0, rowOutstanding(r)), 0);
    const billedHours = data.projects.reduce((a, r) => a + (r.billed_hours || 0), 0);
    const spentHours = data.projects.reduce((a, r) => a + (r.spent_hours || 0), 0);
    return { clients, projects, phases, contract, billed, outstanding, billedHours, spentHours };
  }, [data, hierarchy]);

  const topClients = useMemo(
    () =>
      [...hierarchy]
        .sort((a, b) => b.contract - a.contract)
        .slice(0, 10)
        .map((c) => [c.client, c.contract] as [string, number]),
    [hierarchy],
  );

  /** Employees × process-phase assignment counts (stacked bar). */
  const phaseAssignments = useMemo(() => {
    const phaseKeys = [...PROCESS_PHASES.map((p) => p.shortName), 'Other'];
    const byEmp = new Map<string, Record<string, number>>();

    for (const r of data.projects) {
      if (!r.manager || r.row_kind === 'project') continue;
      const phase = (r.phase || '').trim();
      if (!phase || phase === 'Other' || phase === 'Internal/PTO') continue;
      const st = (r.status || 'ACTIVE').toUpperCase();
      if (st !== 'ACTIVE') continue;

      const idx = matchProcessPhaseIndex(phase);
      const key = idx >= 0 ? PROCESS_PHASES[idx]!.shortName : 'Other';
      let row = byEmp.get(r.manager);
      if (!row) {
        row = Object.fromEntries(phaseKeys.map((k) => [k, 0]));
        byEmp.set(r.manager, row);
      }
      row[key] = (row[key] || 0) + 1;
    }

    const employees = [...byEmp.entries()]
      .map(([name, counts]) => ({
        name,
        counts,
        total: phaseKeys.reduce((a, k) => a + (counts[k] || 0), 0),
      }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, 14);

    const usedKeys = phaseKeys.filter((k) =>
      employees.some((e) => (e.counts[k] || 0) > 0),
    );

    const series = usedKeys.map((key) => {
      const proc = PROCESS_PHASES.find((p) => p.shortName === key);
      return {
        label: key,
        color: proc?.color || OTHER_PHASE_COLOR,
        values: employees.map((e) => e.counts[key] || 0),
      };
    });

    return {
      labels: employees.map((e) => e.name),
      series,
    };
  }, [data.projects]);

  async function onFile(file: File | null) {
    if (!file || !isAdmin) return;
    setUploading(true);
    setUploadMsg(null);
    setUploadErr(null);
    try {
      const parsed = await parseProjectListFile(file);
      const { data: result, error } = await supabase.rpc('pa_replace_project_list', {
        rows: parsed.rows,
      });
      if (error) throw error;
      const inserted =
        result && typeof result === 'object' && 'inserted' in result
          ? Number((result as { inserted: number }).inserted)
          : parsed.rows.length;
      setUploadMsg(
        `Uploaded ${file.name}: ${parsed.clients} clients · ${parsed.projects} projects · ${parsed.phases} phases (${inserted} rows written).`,
      );
      await reload();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section className="sheet active">
      {isAdmin ? (
        <div className="panel plist-upload">
          <h3>
            Upload Project List
            <span className="tag">Source of truth · Ajera / BQE · .xlsx</span>
          </h3>
          <p className="plist-upload-help">
            Upload a file in the same format as <span className="mono">Project List.xlsx</span>.
            This replaces the project list and drives Project Analysis and Project List views.
          </p>
          <div className="plist-upload-row">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={uploading}
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              className="plist-upload-btn"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Choose file'}
            </button>
          </div>
          {uploadMsg ? <p className="plist-upload-ok">{uploadMsg}</p> : null}
          {uploadErr ? <p className="plist-upload-err">{uploadErr}</p> : null}
        </div>
      ) : null}

      <KpiRow
        items={[
          { k: 'Clients', v: String(summary.clients) },
          { k: 'Projects', v: String(summary.projects), cls: 'accent-teal' },
          { k: 'Phases', v: String(summary.phases), cls: 'accent-gold' },
          { k: 'Contract', v: fmtUSDk(summary.contract), cls: 'accent-green' },
          { k: 'Net Billed', v: fmtUSDk(summary.billed), cls: 'accent-rust' },
          { k: 'Outstanding', v: fmtUSDk(summary.outstanding) },
        ]}
      />

      <div className="grid grid-2">
        <div className="panel">
          <h3>
            Top clients by contract
            <span className="tag">From project list</span>
          </h3>
          <div className="chart-wrap tall">
            <HBarChart
              labels={topClients.map((x) => x[0])}
              values={topClients.map((x) => x[1])}
              color={palette.navy}
            />
          </div>
        </div>
        <div className="panel">
          <h3>
            Phase assignments by employee
            <span className="tag">Active phases · count</span>
          </h3>
          <div className="chart-wrap tall">
            {phaseAssignments.labels.length === 0 ? (
              <div className="plist-empty">No active phase assignments</div>
            ) : (
              <StackedCountHBar
                labels={phaseAssignments.labels}
                series={phaseAssignments.series}
                xTitle="# of phases assigned"
              />
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>
          Hours snapshot
          <span className="tag">Billed vs spent</span>
        </h3>
        <KpiRow
          items={[
            {
              k: 'Billed hours',
              v: summary.billedHours.toLocaleString('en-US', { maximumFractionDigits: 1 }),
            },
            {
              k: 'Spent hours',
              v: summary.spentHours.toLocaleString('en-US', { maximumFractionDigits: 1 }),
              cls: 'accent-teal',
            },
            {
              k: 'Utilization (hrs)',
              v:
                summary.spentHours > 0
                  ? ((summary.billedHours / summary.spentHours) * 100).toFixed(1) + '%'
                  : '—',
              cls: 'accent-gold',
            },
          ]}
        />
      </div>
    </section>
  );
}
