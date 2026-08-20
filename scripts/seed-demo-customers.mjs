/**
 * Create 5 fake demo customer auth users + a tiny project each.
 * Usage: node --env-file=.env.local scripts/seed-demo-customers.mjs
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

const PASSWORD = 'DemoCustomer2026!';

const CUSTOMERS = [
  {
    email: 'jordan.blake@mdesigns.test',
    display_name: 'Jordan Blake',
    client_name: 'Jordan Blake',
    project: 'Blake Residence — Demo Remodel',
    city: 'Palo Alto',
    manager: 'Maria Abreu',
  },
  {
    email: 'sam.rivera@mdesigns.test',
    display_name: 'Sam Rivera',
    client_name: 'Sam Rivera',
    project: 'Rivera ADU — Demo Project',
    city: 'Mountain View',
    manager: 'Ni Ni',
  },
  {
    email: 'casey.nguyen@mdesigns.test',
    display_name: 'Casey Nguyen',
    client_name: 'Casey Nguyen',
    project: 'Nguyen Residence — Demo New Build',
    city: 'Los Altos',
    manager: 'Malika Junaid',
  },
  {
    email: 'morgan.patel@mdesigns.test',
    display_name: 'Morgan Patel',
    client_name: 'Morgan Patel',
    project: 'Patel Interior — Demo Refresh',
    city: 'Sunnyvale',
    manager: 'Arnita Serri',
  },
  {
    email: 'alex.torres@mdesigns.test',
    display_name: 'Alex Torres',
    client_name: 'Alex Torres',
    project: 'Torres Commercial — Demo Tenant Fit-Out',
    city: 'San Jose',
    manager: 'Zhengrui He',
  },
];

async function listAllUsers() {
  const users = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < 200) break;
  }
  return users;
}

async function ensureCustomer(c, authUsers) {
  const existing = authUsers.find((u) => u.email?.toLowerCase() === c.email.toLowerCase());
  let userId = existing?.id;

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: c.email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: 'customer', client_name: c.client_name },
      user_metadata: { display_name: c.display_name },
    });
    if (error) throw error;
    userId = data.user.id;
    authUsers.push(data.user);
    console.log(`Created ${c.email}`);
  } else {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: 'customer', client_name: c.client_name },
      user_metadata: { display_name: c.display_name },
    });
    if (error) throw error;
    console.log(`Updated ${c.email}`);
  }

  const { error: profErr } = await admin.from('pa_profiles').upsert(
    {
      id: userId,
      email: c.email,
      role: 'customer',
      display_name: c.display_name,
      employee_name: null,
      client_name: c.client_name,
    },
    { onConflict: 'id' },
  );
  if (profErr) throw profErr;

  const { error: projErr } = await admin.from('pa_projects').upsert(
    {
      project: c.project,
      client: c.client_name,
      city: c.city,
      manager: c.manager,
      status: 'ACTIVE',
      type: 'FIXED',
      phase: 'Schematic Design',
      contract: 120000,
      spent: 28000,
      billed: 36000,
      pct_used: 0.23,
      pct_billed: 0.3,
      retainer_paid: 10000,
      retainer_balance: 6000,
      ar: 8000,
      profit: 8000,
      margin: 0.22,
      row_kind: 'project',
      parent_project: null,
      sort_order: 9000,
    },
    { onConflict: 'project' },
  );
  if (projErr) throw projErr;

  console.log(`  → ${c.client_name} / ${c.project}`);
}

async function main() {
  const authUsers = await listAllUsers();
  for (const c of CUSTOMERS) {
    await ensureCustomer(c, authUsers);
  }
  console.log(`\nPassword for all: ${PASSWORD}`);
  console.log('Sign in on /demo with any of:');
  for (const c of CUSTOMERS) console.log(`  ${c.email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
