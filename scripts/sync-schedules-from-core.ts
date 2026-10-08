/**
 * Run the daily CORE → schedule sync immediately (service role).
 *
 *   npm run sync:schedules-from-core
 */
import { createClient } from '@supabase/supabase-js';
import { syncAllSchedulesFromCore } from '../api/_lib/syncAllSchedulesFromCore.js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const result = await syncAllSchedulesFromCore(sb);
console.log(JSON.stringify(result, null, 2));
if (result.errors.length) process.exitCode = 1;
