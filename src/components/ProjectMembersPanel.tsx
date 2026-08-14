import { useEffect, useMemo, useState } from 'react';
import {
  addProjectMember,
  ensureLeadMembership,
  loadProjectMembers,
  removeProjectMember,
  syncProjectMembersFromTimeEntries,
  type ProjectMember,
} from '../lib/projectMembers';

export function ProjectMembersPanel({
  projectKey,
  employeeName,
  canManage,
  rosterNames,
  compact = false,
  projectTitle,
  projectCode,
  leadNames,
  onMembersChange,
}: {
  projectKey: string;
  employeeName: string;
  canManage: boolean;
  rosterNames: string[];
  compact?: boolean;
  projectTitle?: string;
  projectCode?: string | null;
  /** Project List managers (header + phases) to keep as leads. */
  leadNames?: string[];
  onMembersChange?: (members: ProjectMember[]) => void;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      if (canManage) {
        await ensureLeadMembership({ projectKey, employeeName });
      }
      // Auto-add everyone with logged hours (and ensure phase/project PMs as leads).
      await syncProjectMembersFromTimeEntries({
        projectKey,
        projectTitle: projectTitle || projectKey,
        projectFullName: projectKey,
        projectCode: projectCode || null,
        leadNames: leadNames?.length
          ? leadNames
          : canManage
            ? [employeeName]
            : [],
      });
      const res = await loadProjectMembers(projectKey);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setMembers(res.members);
      onMembersChange?.(res.members);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally omit onMembersChange — parents often pass inline callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, employeeName, canManage, projectTitle, projectCode, leadNames?.join('|')]);

  const options = useMemo(() => {
    const taken = new Set(members.map((m) => m.employee_name.toLowerCase()));
    return rosterNames.filter((n) => !taken.has(n.toLowerCase()));
  }, [rosterNames, members]);

  async function onAdd() {
    if (!canManage || busy || !pick) return;
    setBusy(true);
    setError(null);
    const res = await addProjectMember({
      projectKey,
      employeeName: pick,
      role: 'member',
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPick('');
    const next = [...members, res.data].sort((a, b) =>
      a.employee_name.localeCompare(b.employee_name, undefined, { sensitivity: 'base' }),
    );
    setMembers(next);
    onMembersChange?.(next);
  }

  async function onRemove(m: ProjectMember) {
    if (!canManage || busy) return;
    if (m.role === 'lead' && m.employee_name === employeeName) {
      setError('You can’t remove yourself as project lead.');
      return;
    }
    if (!window.confirm(`Remove ${m.employee_name} from this project?`)) return;
    setBusy(true);
    setError(null);
    const res = await removeProjectMember({ projectKey, memberId: m.id });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const next = members.filter((x) => x.id !== m.id);
    setMembers(next);
    onMembersChange?.(next);
  }

  return (
    <section
      className={`emp-members-panel${compact ? ' emp-members-compact' : ' panel'}`}
      aria-label="Project team"
    >
      <h3>
        Team <span className="tag">{loading ? '…' : members.length}</span>
      </h3>
      {!compact ? (
        <p className="pd-muted emp-members-lede">
          {canManage
            ? 'Add members so they can open this project and receive assigned tasks. Payment figures stay lead-only.'
            : 'You’re on this project team. Leads manage membership and assignments.'}
        </p>
      ) : null}
      {error ? <p className="plist-upload-err">{error}</p> : null}
      {loading ? (
        <p className="pd-muted">…</p>
      ) : (
        <ul className="emp-members-list">
          {members.map((m) => (
            <li key={m.id}>
              <span className="emp-member-name" title={m.employee_name}>
                {compact ? m.employee_name.split(/\s+/)[0] || m.employee_name : m.employee_name}
              </span>
              <span className={`emp-member-role ${m.role}`}>
                {m.role === 'lead' ? 'Lead' : 'Mbr'}
              </span>
              {canManage && m.role !== 'lead' ? (
                <button
                  type="button"
                  className="emp-task-delete"
                  disabled={busy}
                  title="Remove member"
                  aria-label={`Remove ${m.employee_name}`}
                  onClick={() => void onRemove(m)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
          {!members.length ? <li className="pd-muted">None yet</li> : null}
        </ul>
      )}
      {canManage ? (
        <div className="emp-members-add">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={busy || !options.length}
            aria-label="Add team member"
          >
            <option value="">{options.length ? 'Add…' : 'Full'}</option>
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="emp-primary-btn"
            disabled={busy || !pick}
            onClick={() => void onAdd()}
          >
            +
          </button>
        </div>
      ) : null}
    </section>
  );
}
