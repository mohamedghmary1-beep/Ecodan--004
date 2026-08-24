// =====================================================================
// ECODAN Portal - one-time user migration script
// -----------------------------------------------------------------------
// Creates a real Supabase Auth account + a `profiles` row for every
// existing row in the old `users` table (username/password/permissions/
// page_* columns), so the app can stop trusting client-side data and
// start using real, server-verified logins (see index.html / auth-guard.js).
//
// RUN THIS ON YOUR OWN COMPUTER, NOT IN THE BROWSER / NOT IN THE REPO.
// It needs your Supabase SERVICE ROLE key (Project Settings -> API ->
// service_role) which must NEVER be committed to Git or put in any
// front-end file - that key bypasses RLS entirely.
//
// Usage:
//   1) npm install @supabase/supabase-js
//   2) export SUPABASE_URL="https://uhhtvpxtpayovbtmnstz.supabase.co"
//      export SUPABASE_SERVICE_ROLE_KEY="paste-the-service-role-key-here"
//   3) node migrate_users.mjs
//
// It is safe to re-run: existing auth users/profiles are skipped.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.');
    process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// Must match usernameToEmail() in index.html exactly.
function usernameToEmail(username) {
    return username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '') + '@ecodan-portal.local';
}

async function ensureProfilesTable() {
    // profiles table + RLS policies are created by security_migration.sql.
    // This script only assumes the table already exists (run that file
    // first, or run it after - the table structure is idempotent).
}

async function migrate() {
    const { data: oldUsers, error } = await admin.from('users').select('*');
    if (error) {
        console.error('Could not read old `users` table:', error.message);
        process.exit(1);
    }
    if (!oldUsers || oldUsers.length === 0) {
        console.log('No rows found in `users` - nothing to migrate.');
        return;
    }

    console.log(`Found ${oldUsers.length} user(s) to migrate.`);

    for (const u of oldUsers) {
        const email = usernameToEmail(u.username);
        console.log(`\n-> ${u.username}  (${email})`);

        if (!u.password) {
            console.log('   SKIPPED: no password on record - set one manually afterwards.');
            continue;
        }

        // 1) Create (or find) the Auth user.
        let authUserId = null;
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email,
            password: u.password, // last time this plaintext value is ever used - rotate it after migrating!
            email_confirm: true
        });

        if (createErr) {
            if (String(createErr.message || '').toLowerCase().includes('already registered')) {
                const { data: list } = await admin.auth.admin.listUsers();
                const existing = list?.users?.find(x => x.email === email);
                if (existing) {
                    authUserId = existing.id;
                    console.log('   Auth user already exists, reusing it.');
                } else {
                    console.log('   ERROR: reported as existing but could not find it:', createErr.message);
                    continue;
                }
            } else {
                console.log('   ERROR creating auth user:', createErr.message);
                continue;
            }
        } else {
            authUserId = created.user.id;
            console.log('   Auth user created.');
        }

        // 2) Upsert the matching profile row (never stores the password).
        const { error: profileErr } = await admin.from('profiles').upsert({
            id: authUserId,
            username: u.username,
            permissions: u.permissions,
            page_performance: u.page_performance,
            page_summary: u.page_summary,
            page_task: u.page_task,
            page_home: u.page_home,
            page_weekly_report: u.page_weekly_report,
            page_general_by_activity: u.page_general_by_activity
        });

        if (profileErr) {
            console.log('   ERROR upserting profile:', profileErr.message);
        } else {
            console.log('   Profile row saved.');
        }
    }

    console.log('\nDone. Recommended next steps:');
    console.log('  1) Have every user log in once via index.html to confirm it works.');
    console.log('  2) Ask each user to change their password (Supabase Auth: use');
    console.log('     supabase.auth.updateUser({ password }) from a logged-in session,');
    console.log('     or reset it for them from the Supabase Dashboard).');
    console.log('  3) Run security_migration.sql (locks down the old `users` table).');
    console.log('  4) Once verified, DROP the old `users` table (STEP 2b in the SQL file).');
}

migrate();
