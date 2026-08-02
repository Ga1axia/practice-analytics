import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  looksLikeViewCommand,
  parseChatViewAction,
  type ChatViewAction,
} from '../lib/chatViewAction';
import { escapeHtml } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { DashboardData, SheetId } from '../lib/types';

type Msg = { role: 'user' | 'assistant'; text: string };

const SHEET_LABELS: Record<SheetId, string> = {
  exec: 'Executive',
  main: 'Main Report',
  s1: 'Project Analysis',
  s2: 'Workload & Performance',
  s3: 'Financial & A/R',
  s4: 'Project Schedule',
  s5: 'Project List',
};

export function FloatingChat({
  sheet,
  data,
  filters,
  onViewAction,
}: {
  sheet: SheetId;
  data?: DashboardData | null;
  filters?: Record<string, string>;
  onViewAction?: (action: ChatViewAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'assistant',
      text: 'Ask about projects, clients, contracts, or billing — or say **show me [client / project / manager]** to filter the Main Report.',
    },
  ]);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    active: boolean;
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = 360;
    const h = 480;
    setPos({
      x: Math.max(16, window.innerWidth - w - 24),
      y: Math.max(16, window.innerHeight - h - 24),
    });
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, open]);

  function onPointerDown(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest('button, input, textarea, a')) return;
    const el = panelRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    drag.current = {
      active: true,
      ox: e.clientX,
      oy: e.clientY,
      sx: pos.x,
      sy: pos.y,
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!drag.current?.active) return;
    const dx = e.clientX - drag.current.ox;
    const dy = e.clientY - drag.current.oy;
    const w = panelRef.current?.offsetWidth || 360;
    const h = panelRef.current?.offsetHeight || 420;
    setPos({
      x: Math.min(Math.max(8, drag.current.sx + dx), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, drag.current.sy + dy), window.innerHeight - h - 8),
    });
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (!drag.current) return;
    drag.current.active = false;
    try {
      panelRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);

    let applied: ChatViewAction | null = null;
    if (data && looksLikeViewCommand(text)) {
      applied = parseChatViewAction(text, data);
      if (applied && (applied.clear || applied.project || applied.client || applied.manager || applied.phase || applied.status)) {
        onViewAction?.(applied);
      }
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sheet: applied ? 'main' : sheet,
          question: text,
          filters: {
            ...(filters || {}),
            ...(applied?.project ? { project: applied.project } : {}),
            ...(applied?.client ? { client: applied.client } : {}),
            ...(applied?.manager ? { manager: applied.manager } : {}),
            ...(applied?.phase ? { phase: applied.phase } : {}),
            ...(applied?.status ? { status: applied.status } : {}),
            ...(applied?.clear ? { cleared: '1' } : {}),
          },
        }),
      });
      const body = (await res.json()) as { answer?: string; error?: string };
      let answer =
        body.answer ||
        body.error ||
        'Live Q&A needs ANTHROPIC_API_KEY (vercel env) and a signed-in session.';

      if (applied?.label) {
        // Prefer a short filter confirmation; append AI summary when useful
        const isStub = /ANTHROPIC_API_KEY|isn't configured|stub|Claude API error/i.test(answer);
        answer = isStub
          ? applied.label
          : `${applied.label}\n\n${answer}`;
      }

      setMsgs((m) => [...m, { role: 'assistant', text: answer }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'connection error';
      if (applied?.label) {
        setMsgs((m) => [...m, { role: 'assistant', text: applied!.label }]);
      } else {
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Could not reach /api/ask (${msg}). Run with vercel dev or a deployed API.`,
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="float-chat-launch"
        onClick={() => setOpen(true)}
        aria-label="Open AI chat"
      >
        Ask AI
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="float-chat"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="float-chat-head">
        <div>
          <div className="float-chat-title">Ask the database</div>
          <div className="float-chat-sub mono">{SHEET_LABELS[sheet]} · drag to move</div>
        </div>
        <button type="button" className="float-chat-close" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      <div className="float-chat-msgs" ref={listRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`float-chat-bubble ${m.role}`}>
            <div
              dangerouslySetInnerHTML={{
                __html: escapeHtml(m.text)
                  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
                  .replace(/\n/g, '<br>'),
              }}
            />
          </div>
        ))}
        {busy ? <div className="float-chat-bubble assistant"><i>Searching…</i></div> : null}
      </div>
      <div className="float-chat-chips">
        {[
          'Show me active projects',
          'Clear filters',
          'Top clients by billed',
        ].map((c) => (
          <button key={c} type="button" onClick={() => void ask(c)} disabled={busy}>
            {c}
          </button>
        ))}
      </div>
      <div className="float-chat-input">
        <input
          type="text"
          value={q}
          disabled={busy}
          placeholder='Try “show me [client]” or ask a question…'
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void ask();
          }}
        />
        <button type="button" disabled={busy || !q.trim()} onClick={() => void ask()}>
          Send
        </button>
      </div>
    </div>
  );
}
