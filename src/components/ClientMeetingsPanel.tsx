import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  meetingLocationLabel,
  parseMeetingSummary,
  type MeetingLocation,
} from '../lib/parseMeetingSummary';
import { supabase } from '../lib/supabase';

export type ClientMeeting = {
  id: string;
  project_key: string;
  client_name: string;
  meeting_at: string;
  title: string;
  attendees: string;
  location?: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

const LOCATION_OPTIONS: { id: MeetingLocation; label: string }[] = [
  { id: 'site', label: 'Site' },
  { id: 'office', label: 'In office' },
];

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

function emptyDraft() {
  return {
    meeting_at: toLocalInput(new Date().toISOString()),
    title: '',
    attendees: '',
    location: '' as MeetingLocation,
    notes: '',
  };
}

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
  const [dateTouched, setDateTouched] = useState(false);
  const [pasteHint, setPasteHint] = useState<string | null>(null);

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
    setDateTouched(false);
    setPasteHint(null);
    setDraft(emptyDraft());
    void load();
  }, [projectKey, clientName, load]);

  const selected = useMemo(
    () => meetings.find((m) => m.id === selectedId) || null,
    [meetings, selectedId],
  );

  const projectCount = meetings.filter((m) => m.project_key === projectKey).length;

  function applyParsedNotes(notes: string) {
    const parsed = parseMeetingSummary(notes);
    setDraft((d) => {
      const next = { ...d, notes };
      if (!d.title.trim() && parsed.title) next.title = parsed.title;
      if (!d.attendees.trim() && parsed.attendees) next.attendees = parsed.attendees;
      if (!d.location && parsed.location) next.location = parsed.location;
      if (!dateTouched && parsed.meetingAt) next.meeting_at = toLocalInput(parsed.meetingAt);
      return next;
    });
    const filled = [
      parsed.title || null,
      parsed.meetingAt ? formatMeetingWhen(parsed.meetingAt) : null,
      meetingLocationLabel(parsed.location) || null,
      parsed.attendees || null,
    ].filter(Boolean);
    if (filled.length) setPasteHint(`Picked up ${filled.join(' · ')}`);
    else setPasteHint(notes.trim() ? 'Full summary will be saved as written.' : null);
  }

  async function saveMeeting() {
    const title = draft.title.trim() || 'Meeting';
    const notes = draft.notes.trim();
    if (!notes) return;
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
      location: draft.location,
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

    setEditingId(null);
    setDateTouched(false);
    setPasteHint(null);
    setDraft(emptyDraft());
    await load();
  }

  function startEdit(m: ClientMeeting) {
    setEditingId(m.id);
    setDateTouched(true);
    setPasteHint(null);
    setDraft({
      meeting_at: toLocalInput(m.meeting_at),
      title: m.title,
      attendees: m.attendees,
      location: m.location === 'site' || m.location === 'office' ? m.location : '',
      notes: m.notes,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDateTouched(false);
    setPasteHint(null);
    setDraft(emptyDraft());
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError('Clipboard is empty.');
        return;
      }
      setError(null);
      applyParsedNotes(text);
    } catch {
      setError('Could not read the clipboard. Paste into the box with ⌘V or Ctrl+V.');
    }
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

  const hasNotes = Boolean(draft.notes.trim());
  const hasDraft = hasNotes || Boolean(draft.title.trim() || draft.attendees.trim() || draft.location);

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
      </div>

      {error ? <p className="pd-muted" style={{ color: 'var(--rust)' }}>{error}</p> : null}

      <div className="pd-meeting-form paste">
        <div className="pd-meeting-form-grid">
          <label>
            <span>Subject</span>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Design review, site walk…"
            />
          </label>
          <label>
            <span>Date</span>
            <input
              type="datetime-local"
              value={draft.meeting_at}
              onChange={(e) => {
                setDateTouched(true);
                setDraft((d) => ({ ...d, meeting_at: e.target.value }));
              }}
            />
          </label>
          <div>
            <span>Where</span>
            <div className="pd-meeting-where" role="group" aria-label="Meeting location">
              {LOCATION_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={draft.location === opt.id ? 'selected' : ''}
                  aria-pressed={draft.location === opt.id}
                  onClick={() =>
                    setDraft((d) => ({ ...d, location: d.location === opt.id ? '' : opt.id }))
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span>Attendees</span>
            <input
              type="text"
              value={draft.attendees}
              onChange={(e) => setDraft((d) => ({ ...d, attendees: e.target.value }))}
              placeholder="Client, PM, consultants…"
            />
          </label>
        </div>
        <label className="wide">
          <span>{editingId ? 'Meeting notes' : 'Paste meeting summary'}</span>
          <textarea
            rows={compact ? 7 : 10}
            value={draft.notes}
            onChange={(e) => applyParsedNotes(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text/plain');
              if (!text.trim() || draft.notes.trim()) return;
              e.preventDefault();
              applyParsedNotes(text);
            }}
            placeholder="Paste a Teams, Zoom, or written recap. Empty fields above fill in when they’re in the notes."
          />
        </label>
        {pasteHint ? <p className="pd-meeting-paste-hint">{pasteHint}</p> : null}
        <div className="pd-meeting-form-actions">
          {!editingId ? (
            <button type="button" className="sched-text-btn" onClick={() => void pasteFromClipboard()}>
              Paste from clipboard
            </button>
          ) : null}
          {editingId || hasDraft ? (
            <button type="button" className="sched-text-btn" onClick={cancelEdit}>
              {editingId ? 'Cancel' : 'Clear'}
            </button>
          ) : null}
          <button
            type="button"
            className="pd-client-preview-btn"
            disabled={saving || !hasNotes}
            onClick={() => void saveMeeting()}
          >
            {saving ? 'Saving…' : editingId ? 'Save notes' : 'Record meeting'}
          </button>
        </div>
      </div>

      <div className="pd-meetings-layout">
        <div className="pd-meeting-list">
          {!loading && !meetings.length ? (
            <p className="pd-muted">No meetings recorded yet. Paste a summary above to start the history.</p>
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
                      {meetingLocationLabel(m.location) ? ` · ${meetingLocationLabel(m.location)}` : ''}
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
                  {meetingLocationLabel(selected.location) ? (
                    <p className="pd-muted">{meetingLocationLabel(selected.location)}</p>
                  ) : null}
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
