import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bqeConfig, hasServiceRole, loadConnection } from '../_lib/bqe';
import { requireAdmin } from '../_lib/requireAdmin';

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
    if (serviceOk) {
      try {
        conn = await loadConnection();
      } catch (e) {
        connError = e instanceof Error ? e.message : 'Could not load connection';
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
      expiresAt: conn?.expires_at || null,
      error: connError,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'status failed' });
  }
}
