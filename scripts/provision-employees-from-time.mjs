/**
 * Provision Supabase Auth + pa_profiles employee accounts for everyone who
 * logged time in the trailing window (default 30 days).
 *
 * Usage:
 *   node --env-file=.env.local scripts/provision-employees-from-time.mjs
 *   node --env-file=.env.local scripts/provision-employees-from-time.mjs --dry-run
 *   node --env-file=.env.local scripts/provision-employees-from-time.mjs --days=30
 *   node --env-file=.env.local scripts/provision-employees-from-time.mjs --reset-passwords
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const resetPasswords = process.argv.includes('--reset-passwords');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const days = Number(daysArg?.slice('--days='.length) || 30);

const DEFAULT_PASSWORD = process.env.EMPLOYEE_DEFAULT_PASSWORD || 'DemoEmployee2026!';
const EMAIL_DOMAIN = process.env.EMPLOYEE_EMAIL_DOMAIN || 'mdesigns.test';

/** Prefer existing demo / known emails over generated slugs. */
const KNOWN_EMAILS = {
  'Arnita Serri': 'arnita@mdesigns.test',
  'Ni Ni': 'nini@mdesigns.test',
  'Zhengrui He': 'zhengrui@mdesigns.test',
  'Avery Cobe': 'avery.cobe@mdesigns.test',
};

if (!url || !service) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function emailSlug(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
}

function emailFor(name) {
  if (KNOWN_EMAILS[name]) return KNOWN_EMAILS[name];
  const slug = emailSlug(name);
  if (!slug) throw new Error(`Cannot build email for "${name}"`);
  return `${slug}@${EMAIL_DOMAIN}`;
}

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < 200) break;
  }
  return users;
}

async function distinctEmployeesSince(isoDate) {
  /** @type {Map<string, { hours: number; entries: number }>} */
  const map = new Map();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from('pa_time_entries')
      .select('employee_name, actual_hours')
      .gte('work_date', isoDate)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const name = (row.employee_name || '').trim();
      if (!name) continue;
      const cur = map.get(name) || { hours: 0, entries: 0 };
      cur.hours += Number(row.actual_hours) || 0;
      cur.entries += 1;
      map.set(name, cur);
    }
    if (data.length < pageSize) break;
  }
  return [...map.entries()]
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureEmployee(emp, authUsers, profilesById, profilesByEmpName) {
  const email = emailFor(emp.name);
  const existingByEmail = authUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  const existingProfileByName = profilesByEmpName.get(emp.name.toLowerCase());

  // Already provisioned under another email for this employee_name — keep it.
  if (existingProfileByName && existingProfileByName.role === 'employee') {
    const auth = authUsers.find((u) => u.id === existingProfileByName.id);
    if (auth) {
      console.log(`  skip (exists) ${emp.name} → ${existingProfileByName.email}`);
      return { status: 'skipped', email: existingProfileByName.email };
    }
  }

  // Never overwrite admin / customer accounts that happen to share an email.
  if (existingByEmail) {
    const prof = profilesById.get(existingByEmail.id);
    if (prof && prof.role !== 'employee') {
      console.warn(
        `  WARN skip ${emp.name}: ${email} is role=${prof.role} — pick another email`,
      );
      return { status: 'conflict', email };
    }
  }

  if (dryRun) {
    console.log(`  would ${existingByEmail ? 'update' : 'create'} ${emp.name} → ${email}`);
    return { status: existingByEmail ? 'would_update' : 'would_create', email };
  }

  let userId = existingByEmail?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      app_metadata: { role: 'employee', employee_name: emp.name },
      user_metadata: { display_name: emp.name },
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    userId = data.user.id;
    authUsers.push(data.user);
    console.log(`  created ${emp.name} → ${email}`);
  } else {
    const patch = {
      email_confirm: true,
      app_metadata: { role: 'employee', employee_name: emp.name },
      user_metadata: { display_name: emp.name },
    };
    if (resetPasswords) patch.password = DEFAULT_PASSWORD;
    const { error } = await admin.auth.admin.updateUserById(userId, patch);
    if (error) throw new Error(`updateUser ${email}: ${error.message}`);
    console.log(`  updated auth ${emp.name} → ${email}${resetPasswords ? ' (password reset)' : ''}`);
  }

  const { error: profErr } = await admin.from('pa_profiles').upsert(
    {
      id: userId,
      email,
      role: 'employee',
      display_name: emp.name,
      employee_name: emp.name,
      client_name: null,
    },
    { onConflict: 'id' },
  );
  if (profErr) throw new Error(`profile ${email}: ${profErr.message}`);

  profilesById.set(userId, {
    id: userId,
    email,
    role: 'employee',
    employee_name: emp.name,
  });
  profilesByEmpName.set(emp.name.toLowerCase(), {
    id: userId,
    email,
    role: 'employee',
    employee_name: emp.name,
  });

  return { status: existingByEmail ? 'updated' : 'created', email };
}

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const iso = since.toISOString().slice(0, 10);

  console.log(dryRun ? 'DRY RUN' : 'LIVE', `— employees with TE since ${iso} (${days}d)`);
  console.log(`Email domain: @${EMAIL_DOMAIN}`);
  console.log(`Default password: ${DEFAULT_PASSWORD}`);

  const employees = await distinctEmployeesSince(iso);
  console.log(`Found ${employees.length} people:`);
  for (const e of employees) {
    console.log(`  ${e.name}  ${e.hours.toFixed(1)}h  ${e.entries} entries`);
  }

  const [authUsers, { data: profiles, error: pErr }] = await Promise.all([
    listAllAuthUsers(),
    admin.from('pa_profiles').select('id,email,role,employee_name,display_name'),
  ]);
  if (pErr) throw pErr;

  const profilesById = new Map((profiles || []).map((p) => [p.id, p]));
  const profilesByEmpName = new Map(
    (profiles || [])
      .filter((p) => p.employee_name)
      .map((p) => [String(p.employee_name).toLowerCase(), p]),
  );

  const summary = { created: 0, updated: 0, skipped: 0, conflict: 0, would_create: 0, would_update: 0 };
  const creds = [];

  for (const emp of employees) {
    const res = await ensureEmployee(emp, authUsers, profilesById, profilesByEmpName);
    summary[res.status] = (summary[res.status] || 0) + 1;
    creds.push({ name: emp.name, email: res.email, hours: emp.hours });
  }

  console.log('\nSummary:', summary);
  console.log('\nCredentials (employee portal):');
  for (const c of creds.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${c.email}  ←  ${c.name}`);
  }
  if (!dryRun) {
    console.log(`\nPassword for new accounts: ${DEFAULT_PASSWORD}`);
    if (!resetPasswords) {
      console.log('(Existing accounts kept their passwords; pass --reset-passwords to force.)');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
