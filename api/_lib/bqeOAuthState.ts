import { serviceSupabase } from './bqe.js';

export async function saveBqeOAuthState(state: string, userId: string): Promise<void> {
  const sb = serviceSupabase();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const { error } = await sb.from('pa_bqe_oauth_states').upsert(
    { state, user_id: userId, expires_at: expiresAt },
    { onConflict: 'state' },
  );
  if (error) {
    if (/pa_bqe_oauth_states|does not exist|schema cache/i.test(error.message)) {
      return;
    }
    throw new Error(`OAuth state save failed: ${error.message}`);
  }
  await sb.from('pa_bqe_oauth_states').delete().lt('expires_at', new Date().toISOString());
}

export async function consumeBqeOAuthState(
  state: string,
): Promise<{ userId: string } | null> {
  if (!state.trim()) return null;
  const sb = serviceSupabase();
  const { data, error } = await sb
    .from('pa_bqe_oauth_states')
    .select('user_id, expires_at')
    .eq('state', state)
    .maybeSingle();
  if (error) {
    if (/pa_bqe_oauth_states|does not exist|schema cache/i.test(error.message)) {
      return null;
    }
    throw new Error(`OAuth state load failed: ${error.message}`);
  }
  if (!data?.user_id) return null;
  const exp = data.expires_at ? new Date(data.expires_at as string).getTime() : 0;
  if (exp && exp < Date.now()) {
    await sb.from('pa_bqe_oauth_states').delete().eq('state', state);
    return null;
  }
  await sb.from('pa_bqe_oauth_states').delete().eq('state', state);
  return { userId: data.user_id as string };
}
