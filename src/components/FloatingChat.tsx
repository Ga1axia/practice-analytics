import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  chatViewActionHasEffect,
  looksLikeViewCommand,
  parseChatViewAction,
  type ChatViewAction,
} from '../lib/chatViewAction';
import { useDemoMode } from '../hooks/useDemoMode';
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
  s4: 'Project Dashboard',
  s5: 'Project List',
  s6: 'Staffing',
};

function defaultPanelPos() {
  const w = 380;
  const h = 520;
  const top = 72;
  return {
    x: Math.max(16, window.innerWidth - w - 20),
    y: Math.max(16, Math.min(top, window.innerHeight - h - 16)),
  };
}

export function FloatingChat({
  sheet,
  data,
  filters,
  onViewAction,
  open: openProp,
  onOpenChange,
}: {
  sheet: SheetId;
  data?: DashboardData | null;
  filters?: Record<string, string>;
  onViewAction?: (action: ChatViewAction) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isDemo = useDemoMode();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const openRef = useRef(open);
  openRef.current = open;
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function setOpen(next: boolean | ((prev: boolean) => boolean)) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const value = typeof next === 'function' ? next(openRef.current) : next;
    if (!value) {
      inputRef.current?.blur();
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    }
    onOpenChange?.(value);
    if (openProp === undefined) setUncontrolledOpen(value);
    requestAnimationFrame(() => {
      window.scrollTo(scrollX, scrollY);
    });
  }

  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'assistant',
      text: 'Ask about projects, clients, contracts, or billing — or filter the Main Report: **show me active projects**, **unprofitable projects**, **margin above 20%**, **contracts over $500k**, **over budget**, **active phases**.',
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

  useEffect(() => {
    setPos(defaultPanelPos());
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange, openProp]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, open]);

  useEffect(() => {
    if (!open) return;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const t = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      window.scrollTo(scrollX, scrollY);
    }, 40);
    return () => window.clearTimeout(t);
  }, [open]);

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
      if (applied && chatViewActionHasEffect(applied)) {
        onViewAction?.(applied);
      } else if (applied && !chatViewActionHasEffect(applied)) {
        // Keep label-only reply (no match) without switching sheets.
      } else {
        applied = null;
      }
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const filterPayload: Record<string, string> = {
        ...(filters || {}),
      };
      if (applied?.project) filterPayload.project = applied.project;
      if (applied?.client) filterPayload.client = applied.client;
      if (applied?.manager) filterPayload.manager = applied.manager;
      if (applied?.phase) filterPayload.phase = applied.phase;
      if (applied?.projectStatus || applied?.status) {
        filterPayload.project_status = applied.projectStatus || applied.status || '';
        filterPayload.status = applied.projectStatus || applied.status || '';
      }
      if (applied?.phaseStatus) filterPayload.phase_status = applied.phaseStatus;
      if (applied?.profitSign) filterPayload.profit_sign = applied.profitSign;
      if (applied?.marginMin != null) filterPayload.margin_min = String(applied.marginMin);
      if (applied?.marginMax != null) filterPayload.margin_max = String(applied.marginMax);
      if (applied?.billingMin != null) filterPayload.billing_min = String(applied.billingMin);
      if (applied?.billingMax != null) filterPayload.billing_max = String(applied.billingMax);
      if (applied?.burnMin != null) filterPayload.burn_min = String(applied.burnMin);
      if (applied?.burnMax != null) filterPayload.burn_max = String(applied.burnMax);
      if (applied?.contractMin != null) filterPayload.contract_min = String(applied.contractMin);
      if (applied?.contractMax != null) filterPayload.contract_max = String(applied.contractMax);
      if (applied?.overBudget) filterPayload.over_budget = '1';
      if (applied?.underBudget) filterPayload.under_budget = '1';
      if (applied?.clear) filterPayload.cleared = '1';

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sheet: applied && chatViewActionHasEffect(applied) ? 'main' : sheet,
          question: text,
          filters: filterPayload,
        }),
      });
      const body = (await res.json()) as { answer?: string; error?: string };
      let answer =
        body.answer ||
        body.error ||
        (isDemo
          ? 'Live Q&A needs ANTHROPIC_API_KEY (vercel env) and a signed-in session.'
          : 'The assistant is temporarily unavailable. Please try again later.');

      if (applied?.label) {
        const isStub = /ANTHROPIC_API_KEY|isn't configured|stub|Claude API error/i.test(
          answer,
        );
        answer = isStub ? applied.label : `${applied.label}\n\n${answer}`;
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
            text: `Could not reach the assistant (${msg}). Please try again later.`,
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

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
          <div className="float-chat-sub mono">
            {SHEET_LABELS[sheet]} · ⌘K to close · drag to move
          </div>
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
        {busy ? (
          <div className="float-chat-bubble assistant">
            <i>Searching…</i>
          </div>
        ) : null}
      </div>
      <div className="float-chat-chips">
        {[
          'Show me active projects',
          'Show me unprofitable projects',
          'Show me over budget',
          'Show me contracts over $500k',
          'Clear filters',
        ].map((c) => (
          <button key={c} type="button" onClick={() => void ask(c)} disabled={busy}>
            {c}
          </button>
        ))}
      </div>
      <div className="float-chat-input">
        <input
          ref={inputRef}
          type="text"
          value={q}
          disabled={busy}
          placeholder='Try “show me unprofitable” or “margin above 20%”…'
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

/** Navbar control — opens Ask AI (also ⌘K / Ctrl+K). */
export function AskAiNavButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      className={`ask-ai-nav-btn${open ? ' on' : ''}`}
      onClick={onClick}
      aria-label="Ask AI"
      aria-pressed={open}
      title={isMac ? 'Ask AI (⌘K)' : 'Ask AI (Ctrl+K)'}
    >
      <span>Ask AI</span>
      <kbd className="ask-ai-kbd mono">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
