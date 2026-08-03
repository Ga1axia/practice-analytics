import { useCallback, useEffect, useState } from 'react';
import type {
  ClientBoardMode,
  ClientBoardProject,
  ClientMessage,
} from '../lib/clientBoardTypes';
import { supabase } from '../lib/supabase';

export function ClientMessageThread({
  project,
  mode,
  authorName,
  seedMessages = null,
}: {
  project: ClientBoardProject;
  mode: ClientBoardMode;
  authorName: string;
  /** Shown when the project has no stored messages yet (demo seed). */
  seedMessages?: ClientMessage[] | null;
}) {
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('pa_client_messages')
      .select('*')
      .eq('project_key', project.projectKey)
      .order('created_at', { ascending: true });
    if (err) {
      setError(err.message);
      setMessages(seedMessages || []);
    } else {
      const rows = (data || []) as ClientMessage[];
      setMessages(rows.length ? rows : seedMessages || []);
    }
    setLoading(false);
  }, [project.projectKey, seedMessages]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id || null;
    const { data, error: err } = await supabase
      .from('pa_client_messages')
      .insert({
        project_key: project.projectKey,
        client_name: project.clientName,
        author_role: mode === 'pm' ? 'staff' : 'customer',
        author_name: authorName,
        body,
        created_by: uid,
      })
      .select('*')
      .single();
    setSending(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDraft('');
    if (data) setMessages((m) => [...m, data as ClientMessage]);
  }

  return (
    <div className="cp-msg-board">
      <div className="cp-msg-compose">
        <label>
          <span className="cp-bubble-label">
            {mode === 'pm' ? `Message to ${project.clientName}` : 'Message to your project manager'}
          </span>
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              mode === 'pm'
                ? 'Write a note the client will see in their portal…'
                : 'Ask a question or send an update…'
            }
          />
        </label>
        <button
          type="button"
          className="cp-send-btn"
          disabled={sending || !draft.trim()}
          onClick={() => void send()}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error ? <p className="cp-status err">{error}</p> : null}
      {loading ? <p className="cp-status">Loading messages…</p> : null}
      {!loading && !messages.length ? (
        <p className="cp-comms-hint">No messages yet — start the thread above.</p>
      ) : (
        <ul className="cp-msg-timeline">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`cp-msg-bubble ${m.author_role === 'staff' ? 'staff' : 'customer'}`}
            >
              <div className="cp-msg-meta">
                <strong>
                  {m.author_role === 'staff'
                    ? m.author_name || 'M. Designs'
                    : m.author_name || project.clientName}
                </strong>
                <span className="mono">
                  {new Date(m.created_at).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
