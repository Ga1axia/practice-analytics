import { useEffect, useMemo, useState } from 'react';
import { ClientProjectBoard } from '../components/ClientProjectBoard';
import type { Profile } from '../lib/authTypes';
import type { ClientBoardOption, ClientBoardProject } from '../lib/clientBoardTypes';
import { inferCurrentPhase } from '../lib/clientPortal';
import { supabase } from '../lib/supabase';
import type { ProjectRow } from '../lib/types';

function isHeader(p: ProjectRow) {
  return p.row_kind === 'project' || !p.parent_project;
}

function pickProject(projects: ProjectRow[]) {
  if (!projects.length) return null;
  const headers = projects.filter(isHeader);
  const pool = headers.length ? headers : projects;
  const active = pool.filter((p) => !p.status || p.status === 'ACTIVE');
  const use = active.length ? active : pool;
  return use.slice().sort((a, b) => a.project.localeCompare(b.project))[0] || null;
}

function sum(rows: ProjectRow[], key: keyof ProjectRow) {
  return rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
}

export function CustomerPortal({ profile }: { profile: Profile }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const clientName = (profile.client_name || '').trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      if (!clientName) {
        setProjects([]);
        setLoading(false);
        return;
      }
      const { data, error: err } = await supabase
        .from('pa_projects')
        .select(
          'project,client,manager,status,type,phase,city,contract,spent,billed,ar,retainer_paid,retainer_balance,row_kind,parent_project',
        )
        .eq('client', clientName)
        .order('project');
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setProjects([]);
      } else {
        setProjects((data || []) as ProjectRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientName]);

  const headers = useMemo(() => {
    const list = projects.filter(isHeader);
    return list.length ? list : projects;
  }, [projects]);

  const project = useMemo(() => {
    if (selectedKey) return headers.find((p) => p.project === selectedKey) || pickProject(projects);
    return pickProject(projects);
  }, [headers, projects, selectedKey]);

  const greeting = profile.display_name || profile.client_name || 'there';

  const switcher: ClientBoardOption[] = headers.map((p) => ({
    projectKey: p.project,
    title: p.project,
    status: p.status,
  }));

  const boardProject: ClientBoardProject | null = project
    ? (() => {
        const children = projects.filter((p) => p.parent_project === project.project);
        const pool = children.length ? [project, ...children] : [project];
        const activeChildren = children.filter((p) => !p.status || p.status === 'ACTIVE');
        const phase = inferCurrentPhase(
          project.phase,
          activeChildren.map((p) => p.phase || p.project),
        );
        const additionalFee = children
          .filter((p) => /additional/i.test(`${p.phase || ''} ${p.project}`))
          .reduce((n, p) => n + (p.contract || 0), 0);
        return {
          projectKey: project.project,
          title: project.project,
          clientName: project.client || profile.client_name || 'Client',
          manager: project.manager,
          status: project.status,
          city: project.city,
          phase,
          contract: project.contract || sum(pool, 'contract'),
          billed: project.billed || sum(pool, 'billed'),
          spent: project.spent || sum(pool, 'spent'),
          ar: project.ar || sum(pool, 'ar'),
          retainerPaid: project.retainer_paid || sum(pool, 'retainer_paid'),
          retainerBalance: project.retainer_balance || sum(pool, 'retainer_balance'),
          additionalFee,
        };
      })()
    : null;

  if (loading) {
    return (
      <main className="customer-portal cp-dash">
        <p className="cp-status">Loading your project…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="customer-portal cp-dash">
        <p className="cp-status err">{error}</p>
      </main>
    );
  }

  if (!boardProject) {
    return (
      <main className="customer-portal cp-dash">
        <section className="cp-card">
          <p className="customer-kicker">Client portal</p>
          <h1 className="display">Welcome, {greeting}</h1>
          <p className="customer-lede">
            No project is linked to {profile.client_name || 'this account'} yet. Contact M. Designs
            and we’ll connect your portal.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="customer-portal cp-dash">
      <ClientProjectBoard
        project={boardProject}
        projects={switcher}
        onSelectProject={setSelectedKey}
        mode="customer"
        authorName={profile.display_name || profile.client_name || 'Client'}
      />
    </main>
  );
}
