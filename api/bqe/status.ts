import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bqeConfig, hasServiceRole, loadConnection, serviceSupabase } from '../_lib/bqe.js';
import { requireAdmin } from '../_lib/requireAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const cfg = bqeConfig();
    const serviceOk = hasServiceRole();
    let conn = null;
    let connError: string | null = null;
    let lastTimeEntrySyncAt: string | null = null;
    let lastTimeEntrySyncStatus: string | null = null;
    let timeEntryCount: number | null = null;

    if (serviceOk) {
      try {
        conn = await loadConnection();
      } catch (e) {
        connError = e instanceof Error ? e.message : 'Could not load connection';
      }
      try {
        const sb = serviceSupabase();
        const { data: run } = await sb
          .from('pa_bqe_sync_runs')
          .select('completed_at, status, sync_type')
          .in('sync_type', ['historical', 'incremental'])
          .in('status', ['succeeded', 'partial'])
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        lastTimeEntrySyncAt = (run?.completed_at as string) || null;
        lastTimeEntrySyncStatus = (run?.status as string) || null;
        const { count } = await sb
          .from('pa_time_entries')
          .select('id', { count: 'exact', head: true });
        timeEntryCount = count ?? 0;
      } catch {
        /* tables may not exist until migration */
      }
    }

    res.status(200).json({
      configured: !!(cfg.clientId && cfg.clientSecret && cfg.redirectUri && serviceOk),
      hasClientId: !!cfg.clientId,
      hasClientSecret: !!cfg.clientSecret,
      hasRedirectUri: !!cfg.redirectUri,
      hasServiceRole: serviceOk,
      connected: !!conn,
      apiEndpoint: conn?.api_endpoint || null,
      connectedAt: conn?.connected_at || null,
      lastSyncAt: conn?.last_sync_at || null,
      lastSyncStatus: conn?.last_sync_status || null,
      lastSyncMessage: conn?.last_sync_message || null,
      lastTimeEntrySyncAt,
      lastTimeEntrySyncStatus,
      timeEntryCount,
      expiresAt: conn?.expires_at || null,
      error: connError,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'status failed' });
  }
}
