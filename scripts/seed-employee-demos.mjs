/**
 * Create demo employee auth users: Arnita, Ni Ni, Zhengrui.
 * Usage: node --env-file=.env.local scripts/seed-employee-demos.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !service) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMPLOYEES = [
  {
    email: 'arnita@mdesigns.test',
    password: 'DemoEmployee2026!',
    display_name: 'Arnita Serri',
    employee_name: 'Arnita Serri',
  },
  {
    email: 'nini@mdesigns.test',
    password: 'DemoEmployee2026!',
    display_name: 'Ni Ni',
    employee_name: 'Ni Ni',
  },
  {
    email: 'zhengrui@mdesigns.test',
    password: 'DemoEmployee2026!',
    display_name: 'Zhengrui He',
    employee_name: 'Zhengrui He',
  },
];

async function ensureUser(emp) {
  const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;
  const existing = listed.users.find((u) => u.email?.toLowerCase() === emp.email.toLowerCase());

  let userId = existing?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: emp.email,
      password: emp.password,
      email_confirm: true,
      app_metadata: { role: 'employee', employee_name: emp.employee_name },
      user_metadata: { display_name: emp.display_name },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`Created auth user ${emp.email}`);
  } else {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: emp.password,
      email_confirm: true,
      app_metadata: { role: 'employee', employee_name: emp.employee_name },
      user_metadata: { display_name: emp.display_name },
    });
    if (error) throw error;
    console.log(`Updated auth user ${emp.email}`);
  }

  const { error: profErr } = await admin.from('pa_profiles').upsert(
    {
      id: userId,
      email: emp.email,
      role: 'employee',
      display_name: emp.display_name,
      employee_name: emp.employee_name,
      client_name: null,
    },
    { onConflict: 'id' },
  );
  if (profErr) throw profErr;
  console.log(`Upserted profile ${emp.employee_name}`);
}

async function main() {
  for (const emp of EMPLOYEES) {
    await ensureUser(emp);
  }

  // Summary of projects each would see via RLS (manager match)
  for (const emp of EMPLOYEES) {
    const { data, error } = await admin
      .from('pa_projects')
      .select('project,client,status,row_kind')
      .eq('manager', emp.employee_name)
      .order('project');
    if (error) throw error;
    const headers = (data || []).filter((r) => r.row_kind === 'project');
    const phases = (data || []).filter((r) => r.row_kind !== 'project');
    const clients = new Set((data || []).map((r) => r.client).filter(Boolean));
    console.log(
      `\n${emp.employee_name}: ${data?.length || 0} rows · ${headers.length} project headers · ${phases.length} phase lines · ${clients.size} clients`,
    );
    [...clients].sort().slice(0, 8).forEach((c) => console.log(`  - ${c}`));
    if (clients.size > 8) console.log(`  … +${clients.size - 8} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
