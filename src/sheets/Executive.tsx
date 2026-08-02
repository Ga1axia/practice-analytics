import { useMemo, useRef, useState } from 'react';
import { HBarChart } from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { useAuth } from '../hooks/useAuth';
import { useDashboard } from '../hooks/useDashboard';
import { fmtUSDk, palette } from '../lib/format';
import { parseProjectListFile } from '../lib/parseProjectList';
import { buildClientHierarchy } from '../lib/projectListHierarchy';
import { rowOutstanding } from '../lib/receivable';
import { supabase } from '../lib/supabase';
import type { DashboardData } from '../lib/types';

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

  const topManagers = useMemo(() => {
    const map: Record<string, number> = {};
    data.projects.forEach((r) => {
      if (!r.manager || r.row_kind === 'project') return;
      map[r.manager] = (map[r.manager] || 0) + (r.contract || 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
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
            Top managers by phase contract
            <span className="tag">From project list</span>
          </h3>
          <div className="chart-wrap tall">
            <HBarChart
              labels={topManagers.map((x) => x[0])}
              values={topManagers.map((x) => x[1])}
              color={palette.teal}
            />
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
