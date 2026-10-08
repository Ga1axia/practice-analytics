import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serviceSupabase } from '../_lib/bqe.js';
import { syncAllSchedulesFromCore } from '../_lib/syncAllSchedulesFromCore.js';

function authorized(req: VercelRequest): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = String(req.headers.authorization || '');
  return auth === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const sb = serviceSupabase();
    const result = await syncAllSchedulesFromCore(sb, {
      persistOffset: true,
      activeOnly: true,
    });
    res.status(200).json({
      ...result,
      ranAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : 'Schedule CORE sync failed',
    });
  }
}
