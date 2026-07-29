import { useState } from 'react';
import { escapeHtml } from '../lib/format';
import type { SheetId } from '../lib/types';

type Props = {
  sheet: SheetId;
  chips: string[];
  examples: string[];
  filters?: Record<string, string>;
};

export function QAPanel({ sheet, chips, examples, filters }: Props) {
  const [q, setQ] = useState('');
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text) return;
    setQ(text);
    setBusy(true);
    setHtml(
      `<div class="qa-bubble"><div class="qa-q">Q: ${escapeHtml(text)}</div><div class="qa-a"><i>Thinking…</i></div></div>`,
    );
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet, question: text, filters: filters || {} }),
      });
      const body = (await res.json()) as { answer?: string; stub?: boolean; error?: string };
      const answerRaw =
        body.answer ||
        body.error ||
        `Live Q&A isn't configured yet. Set ANTHROPIC_API_KEY on the server. Try: ${examples.join(' · ')}`;
      const answerHtml = escapeHtml(answerRaw)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\n/g, '<br>');
      setHtml(
        `<div class="qa-bubble"><div class="qa-q">Q: ${escapeHtml(text)}</div><div class="qa-a">${answerHtml}</div></div>`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'connection error';
      setHtml(
        `<div class="qa-bubble"><div class="qa-q">Q: ${escapeHtml(text)}</div><div class="qa-a">Live Q&amp;A isn't reachable right now (${escapeHtml(msg)}). Configure <code>ANTHROPIC_API_KEY</code> and run via <code>vercel dev</code> or a Vercel deploy. Examples:<br>${examples.map((x) => '&bull; ' + escapeHtml(x)).join('<br>')}</div></div>`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel qa-panel">
      <h3>
        Ask This Sheet <span className="tag">Claude + Supabase context</span>
      </h3>
      <div className="qa-input-row">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask();
          }}
          placeholder="Ask a question about this sheet…"
          disabled={busy}
        />
        <button type="button" onClick={() => ask()} disabled={busy}>
          Ask
        </button>
      </div>
      <div className="qa-chips">
        {chips.map((c) => (
          <button key={c} type="button" className="qa-chip" onClick={() => ask(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="qa-answer" dangerouslySetInnerHTML={html ? { __html: html } : undefined} />
    </div>
  );
}
