import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export type ClientMeeting = {
  id: string;
  project_key: string;
  client_name: string;
  meeting_at: string;
  title: string;
  attendees: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function formatMeetingWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const emptyDraft = () => ({
  meeting_at: toLocalInput(new Date().toISOString()),
  title: 'Client meeting',
  attendees: '',
  notes: '',
});

export function ClientMeetingsPanel({
  projectKey,
  clientName,
  compact,
  seedMeetings = null,
}: {
  projectKey: string;
  clientName: string;
  compact?: boolean;
  /** Shown when the client has no stored meetings yet (demo seed). */
  seedMeetings?: ClientMeeting[] | null;
}) {
  const [meetings, setMeetings] = useState<ClientMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('pa_client_meetings')
      .select('*')
      .eq('client_name', clientName)
      .order('meeting_at', { ascending: false });
    if (err) {
      setError(err.message);
      const seeded = seedMeetings || [];
      setMeetings(seeded);
      setSelectedId(seeded[0]?.id || null);
      setLoading(false);
      return;
    }
    const rows = (data || []) as ClientMeeting[];
    const effective = rows.length ? rows : seedMeetings || [];
    setMeetings(effective);
    setSelectedId((prev) => {
      if (prev && effective.some((r) => r.id === prev)) return prev;
      return effective[0]?.id || null;
    });
    setLoading(false);
  }, [clientName, seedMeetings]);

  useEffect(() => {
    setEditingId(null);
    setShowForm(false);
    setDraft(emptyDraft());
    void load();
  }, [projectKey, clientName, load]);

  const selected = useMemo(
    () => meetings.find((m) => m.id === selectedId) || null,
    [meetings, selectedId],
  );

  const projectCount = meetings.filter((m) => m.project_key === projectKey).length;

  async function saveMeeting() {
    const title = draft.title.trim() || 'Meeting';
    const notes = draft.notes.trim();
    if (!notes && !title) return;
    setSaving(true);
    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id || null;
    const payload = {
      project_key: projectKey,
      client_name: clientName,
      meeting_at: fromLocalInput(draft.meeting_at),
      title,
      attendees: draft.attendees.trim(),
      notes,
      updated_at: new Date().toISOString(),
      updated_by: uid,
    };

    if (editingId) {
      const { error: err } = await supabase
        .from('pa_client_meetings')
        .update(payload)
        .eq('id', editingId);
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { data, error: err } = await supabase
        .from('pa_client_meetings')
        .insert({ ...payload, created_by: uid })
        .select('*')
        .single();
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
      if (data) setSelectedId((data as ClientMeeting).id);
    }

    setShowForm(false);
    setEditingId(null);
    setDraft(emptyDraft());
    await load();
  }

  function startEdit(m: ClientMeeting) {
    setEditingId(m.id);
    setDraft({
      meeting_at: toLocalInput(m.meeting_at),
      title: m.title,
      attendees: m.attendees,
      notes: m.notes,
    });
    setShowForm(true);
  }

  function startNew() {
    setEditingId(null);
    setDraft({
      ...emptyDraft(),
      attendees: '',
      title: `Meeting — ${clientName}`,
    });
    setShowForm(true);
  }

  async function removeMeeting(id: string) {
    if (!window.confirm('Delete this meeting and its notes?')) return;
    const { error: err } = await supabase.from('pa_client_meetings').delete().eq('id', id);
    if (err) {
      setError(err.message);
      return;
    }
    if (selectedId === id) setSelectedId(null);
    await load();
  }

  return (
    <div className={`pd-meetings${compact ? ' compact' : ''}`}>
      <div className="pd-meetings-toolbar">
        <div>
          <h3>
            Meeting history <span className="tag">{clientName}</span>
          </h3>
          <p className="pd-muted">
            {loading
              ? 'Loading…'
              : `${meetings.length} meeting${meetings.length === 1 ? '' : 's'} for this client${
                  projectCount ? ` · ${projectCount} on this project` : ''
                }.`}
          </p>
        </div>
        <button type="button" className="pd-client-preview-btn" onClick={startNew}>
          Add meeting
        </button>
      </div>

      {error ? <p className="pd-muted" style={{ color: 'var(--rust)' }}>{error}</p> : null}

      {showForm ? (
        <div className="pd-meeting-form">
          <div className="pd-meeting-form-grid">
            <label>
              <span>When</span>
              <input
                type="datetime-local"
                value={draft.meeting_at}
                onChange={(e) => setDraft((d) => ({ ...d, meeting_at: e.target.value }))}
              />
            </label>
            <label>
              <span>Title</span>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Design review, site walk…"
              />
            </label>
            <label className="wide">
              <span>Attendees</span>
              <input
                type="text"
                value={draft.attendees}
                onChange={(e) => setDraft((d) => ({ ...d, attendees: e.target.value }))}
                placeholder="Client, PM, consultants…"
              />
            </label>
            <label className="wide">
              <span>Meeting notes</span>
              <textarea
                rows={6}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Decisions, action items, follow-ups…"
              />
            </label>
          </div>
          <div className="pd-meeting-form-actions">
            <button type="button" className="sched-text-btn" onClick={() => { setShowForm(false); setEditingId(null); }}>
              Cancel
            </button>
            <button
              type="button"
              className="pd-client-preview-btn"
              disabled={saving || !draft.notes.trim()}
              onClick={() => void saveMeeting()}
            >
              {saving ? 'Saving…' : editingId ? 'Save notes' : 'Save meeting'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="pd-meetings-layout">
        <div className="pd-meeting-list">
          {!loading && !meetings.length ? (
            <p className="pd-muted">No meetings logged yet. Add the first one to start the history.</p>
          ) : (
            <ul>
              {meetings.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`pd-meeting-row${selectedId === m.id ? ' selected' : ''}`}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <span className="when mono">{formatMeetingWhen(m.meeting_at)}</span>
                    <span className="title">{m.title || 'Meeting'}</span>
                    <span className="meta">
                      {m.project_key === projectKey ? 'This project' : 'Other project'}
                      {m.attendees ? ` · ${m.attendees}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pd-meeting-detail">
          {selected ? (
            <>
              <div className="pd-meeting-detail-head">
                <div>
                  <p className="pd-kicker">Meeting notes</p>
                  <h4>{selected.title}</h4>
                  <p className="mono">{formatMeetingWhen(selected.meeting_at)}</p>
                  {selected.attendees ? (
                    <p className="pd-muted">Attendees: {selected.attendees}</p>
                  ) : null}
                </div>
                <div className="pd-meeting-detail-actions">
                  <button type="button" className="sched-text-btn" onClick={() => startEdit(selected)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="sched-text-btn"
                    onClick={() => void removeMeeting(selected.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="pd-meeting-notes">
                {selected.notes.trim() ? selected.notes : 'No notes recorded for this meeting.'}
              </div>
            </>
          ) : (
            <p className="pd-muted">Select a meeting to read its notes history.</p>
          )}
        </div>
      </div>
    </div>
  );
}
