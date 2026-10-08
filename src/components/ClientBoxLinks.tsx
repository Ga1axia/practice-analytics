import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientBoardMode, ClientBoxLink } from '../lib/clientBoardTypes';
import {
  CLIENT_FILE_CATEGORIES,
  clientFileCategoryLabel,
  isBoxShareUrl,
  normalizeClientFileCategory,
  type ClientFileCategoryId,
} from '../lib/clientCopy';
import { documentReviews, markDocumentReviewed, type DocReview } from '../lib/clientPortal';
import { supabase } from '../lib/supabase';

function emptyDraft(): {
  title: string;
  boxUrl: string;
  section: ClientFileCategoryId;
} {
  return { title: '', boxUrl: '', section: 'drawings' };
}

export function ClientBoxLinks({
  projectKey,
  clientName,
  authorName,
  mode,
  compact = false,
  embedded = false,
  canEdit,
}: {
  projectKey: string;
  clientName: string;
  authorName: string;
  mode: ClientBoardMode;
  compact?: boolean;
  embedded?: boolean;
  /** Project managers add and edit. Defaults to staff (pm) mode. */
  canEdit?: boolean;
}) {
  const staff = mode === 'pm';
  const editable = canEdit ?? staff;
  const [links, setLinks] = useState<ClientBoxLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [reviews, setReviews] = useState(() => documentReviews(projectKey));

  const grouped = useMemo(() => {
    const buckets: Record<ClientFileCategoryId, ClientBoxLink[]> = {
      drawings: [],
      renderings: [],
      packages: [],
    };
    for (const link of links) {
      buckets[normalizeClientFileCategory(link.section, link.title)].push(link);
    }
    return buckets;
  }, [links]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('pa_client_box_links')
      .select('*')
      .eq('project_key', projectKey)
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
      setLinks([]);
    } else {
      setLinks((data || []) as ClientBoxLink[]);
    }
    setLoading(false);
  }, [projectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setReviews(documentReviews(projectKey));
    setEditingId(null);
    setDraft(emptyDraft());
  }, [projectKey]);

  function startEdit(link: ClientBoxLink) {
    setEditingId(link.id);
    setDraft({
      title: link.title,
      boxUrl: link.box_url,
      section: normalizeClientFileCategory(link.section, link.title),
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
  }

  async function saveLink() {
    const name = draft.title.trim();
    const url = draft.boxUrl.trim();
    if (!name || !url || saving) return;
    if (!isBoxShareUrl(url)) {
      setError('Paste an https:// Box link (app.box.com or boxcloud.com).');
      return;
    }
    setSaving(true);
    setError(null);
    if (editingId) {
      const { data, error: err } = await supabase
        .from('pa_client_box_links')
        .update({ title: name, box_url: url, section: draft.section })
        .eq('id', editingId)
        .select('*')
        .single();
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
      if (data) {
        setLinks((prev) => prev.map((l) => (l.id === editingId ? (data as ClientBoxLink) : l)));
      }
      cancelEdit();
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id || null;
    const { data, error: err } = await supabase
      .from('pa_client_box_links')
      .insert({
        project_key: projectKey,
        client_name: clientName,
        title: name,
        box_url: url,
        section: draft.section,
        created_by: uid,
        created_by_name: authorName,
      })
      .select('*')
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDraft(emptyDraft());
    if (data) setLinks((prev) => [data as ClientBoxLink, ...prev]);
  }

  async function removeLink(id: string) {
    const { error: err } = await supabase.from('pa_client_box_links').delete().eq('id', id);
    if (err) {
      setError(err.message);
      return;
    }
    if (editingId === id) cancelEdit();
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  function markReviewed(id: string) {
    const next = markDocumentReviewed(projectKey, id, authorName);
    setReviews((prev) => ({ ...prev, [id]: next }));
  }

  function fileRow(link: ClientBoxLink, rec: DocReview | undefined) {
    const editing = editingId === link.id;
    return (
      <li key={link.id} className={editing ? 'editing' : ''}>
        <div>
          <strong>{link.title}</strong>
          <span className="meta mono">
            Added {new Date(link.created_at).toLocaleDateString()}
            {link.created_by_name ? ` · ${link.created_by_name}` : ''}
          </span>
          {rec ? (
            <span className="meta mono">
              Reviewed {new Date(rec.at).toLocaleString()} by {rec.by}
            </span>
          ) : null}
        </div>
        <div className="cp-doc-actions">
          <a className="cp-text-btn" href={link.box_url} target="_blank" rel="noreferrer">
            Open in Box
          </a>
          {!staff ? (
            <button
              type="button"
              className="cp-text-btn"
              disabled={!!rec}
              onClick={() => markReviewed(link.id)}
            >
              {rec ? 'Reviewed' : 'Mark as reviewed'}
            </button>
          ) : null}
          {editable ? (
            <>
              <button
                type="button"
                className="cp-text-btn"
                onClick={() => (editing ? cancelEdit() : startEdit(link))}
              >
                {editing ? 'Cancel' : 'Edit'}
              </button>
              <button type="button" className="cp-text-btn" onClick={() => void removeLink(link.id)}>
                Remove
              </button>
            </>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div className={`cp-box-links${compact ? ' compact' : ''}`}>
      {!compact && !embedded ? (
        <>
          <p className="customer-kicker">Box files</p>
          <h3 className="cp-box-heading">{staff ? 'Project Box' : 'Shared with you'}</h3>
          <p className="cp-phase-summary">
            {editable
              ? 'Paste a Box share link. The client sees it on their Files tab immediately.'
              : 'Open a file in Box to view or download. Your project team posts new sets here.'}
          </p>
        </>
      ) : null}

      {compact ? (
        <p className="pd-muted">
          {editable
            ? 'Paste a Box share link. It appears on the client Files tab, grouped as drawings, renderings, or packages.'
            : 'Open a file in Box. Your project manager posts drawings, renderings, and packages here.'}
        </p>
      ) : null}

      {editable ? (
        <form
          className="cp-box-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveLink();
          }}
        >
          <label>
            <span>Title</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="CD Set — Rev 3"
              required
            />
          </label>
          <label>
            <span>Box link</span>
            <input
              value={draft.boxUrl}
              onChange={(e) => setDraft((d) => ({ ...d, boxUrl: e.target.value }))}
              placeholder="https://app.box.com/s/…"
              inputMode="url"
              autoComplete="url"
              required
            />
          </label>
          <label>
            <span>Category</span>
            <select
              value={draft.section}
              onChange={(e) =>
                setDraft((d) => ({ ...d, section: e.target.value as ClientFileCategoryId }))
              }
            >
              {CLIENT_FILE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="cp-box-form-actions">
            <button
              type="submit"
              className="cp-text-btn"
              disabled={saving || !draft.title.trim() || !draft.boxUrl.trim()}
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add Box link'}
            </button>
            {editingId ? (
              <button type="button" className="cp-text-btn" onClick={cancelEdit}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {error ? <p className="cp-status err">{error}</p> : null}
      {loading ? <p className="cp-status">Loading files…</p> : null}
      {!loading && !links.length ? (
        <div className="cp-empty-card">
          <p>
            {editable
              ? 'No files on this project yet. Paste a Box share URL above.'
              : 'No design files have been shared yet. Your PM will post drawings, renderings, and packages here when they are ready.'}
          </p>
        </div>
      ) : null}
      {links.length
        ? CLIENT_FILE_CATEGORIES.map((cat) => {
            const items = grouped[cat.id];
            if (!items.length) return null;
            return (
              <div key={cat.id} className="cp-file-cat">
                <h3 className="cp-file-cat-heading">{clientFileCategoryLabel(cat.id)}</h3>
                <ul className="cp-doc-list">{items.map((l) => fileRow(l, reviews[l.id]))}</ul>
              </div>
            );
          })
        : null}
    </div>
  );
}
