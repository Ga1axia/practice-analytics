import { useEffect, useMemo, useState } from 'react';
import { ClientProjectBoard } from '../components/ClientProjectBoard';
import type { Profile } from '../lib/authTypes';
import type { ClientBoardProject } from '../lib/clientBoardTypes';
import { supabase } from '../lib/supabase';
import type { ProjectRow } from '../lib/types';

function pickProject(projects: ProjectRow[]) {
  if (!projects.length) return null;
  const headers = projects.filter((p) => p.row_kind === 'project');
  const pool = headers.length ? headers : projects;
  const active = pool.filter((p) => !p.status || p.status === 'ACTIVE');
  const use = active.length ? active : pool;
  return use.slice().sort((a, b) => a.project.localeCompare(b.project))[0] || null;
}

export function CustomerPortal({ profile }: { profile: Profile }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          'project,client,manager,status,type,phase,city,contract,spent,billed,ar,row_kind,parent_project',
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

  const project = useMemo(() => pickProject(projects), [projects]);
  const greeting = profile.display_name || profile.client_name || 'there';

  const boardProject: ClientBoardProject | null = project
    ? {
        projectKey: project.project,
        title: project.project,
        clientName: project.client || profile.client_name || 'Client',
        manager: project.manager,
        status: project.status,
        city: project.city,
        phase: project.phase,
      }
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
        mode="customer"
        authorName={profile.display_name || profile.client_name || 'Client'}
      />
    </main>
  );
}
