// =====================================================================
// ECODAN Portal - تحديث الإيميلات (والباسورد اختياريًا) لإيميلات حقيقية
// -----------------------------------------------------------------------
// بيغيّر إيميل حساب Auth بتاع كل مستخدم من الإيميل الوهمي
// (username@ecodan-portal.local) للإيميل الحقيقي بتاعه، عشان:
//   1) زرار "نسيت الباسورد" يشتغل فعليًا (يبعت إيميل حقيقي).
//   2) المستخدم يدخل بإيميله مباشرة بدل اليوزرنيم (بعد تعديل index.html).
//
// لو محتاج كمان تغيّر باسورد حد في نفس الوقت، ضيف password في سطره
// (اختياري - سيبه فاضي أو احذفه لو عايز الباسورد يفضل زي ما هو).
//
// شغّله بنفس طريقة migrate_users.mjs بالظبط:
//   1) npm install @supabase/supabase-js   (لو لسه مش مثبتة)
//   2) set SUPABASE_URL=...
//      set SUPABASE_SERVICE_ROLE_KEY=...
//   3) node update_real_emails.mjs
//
// عدّل قايمة USER_EMAILS تحت دي.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const USER_EMAILS = {
    // لو عايز تغيّر الإيميل بس (الباسورد يفضل زي ما هو):
    // 'اسم_المستخدم': { email: 'الايميل_الحقيقي@example.com' },

    // لو عايز تغيّر الإيميل والباسورد مع بعض:
    // 'اسم_المستخدم': { email: 'الايميل_الحقيقي@example.com', password: 'باسورد_جديد' },

    'Abdalhamid Mahmoud':   { email: 'abyoumi@mdceo.com',              password: '123456' },
    'Faisal':               { email: 'faisalfaa@afford-house.com',    password: '133141' },
    'Mohamed Bassam':       { email: 'm.bassam@mdceo.com',             password: '357159' },
    'Ahmed Moharm':         { email: 'ahmohar@mdceo.com',              password: '@12345' },
    'Syed Irfn':            { email: 'sirfan@mdceo.com',               password: '12345' },
    'Mohamed Baraka':       { email: 'm.baraka@mdceo.com',             password: '12345@' },
    'MA':                   { email: 'malmaadawi@afford-house.com',   password: '55555M' },
    'Mohammed Almaghnam':   { email: 'mohammed.almaghnam@afford-house.com', password: 'Ma123456' },
    'Ahmedabdelhalim':      { email: 'a.halim@mdceo.com',              password: '125513260' },
    'Reda':                 { email: 'mreza@mdceo.com',                password: '2662002' },
    'Mohamed Mansour':      { email: 'm.mansoor@mdceo.com',            password: 'Mdceo@321' },
    'Ihsan':                { email: 'ihsabr@mdceo.com',               password: 'Ihsan@123' },

    // Admin وITQAN مفيش إيميل حقيقي معروف ليهم دلوقتي - سايبينهم
    // بالإيميل الوهمي القديم (@ecodan-portal.local) لحد ما يتوفر.
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.');
    process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

function oldFakeEmail(username) {
    return username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '') + '@ecodan-portal.local';
}

async function run() {
    const { data: authList, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) {
        console.error('Could not list auth users:', listErr.message);
        process.exit(1);
    }

    for (const [username, info] of Object.entries(USER_EMAILS)) {
        const fakeEmail = oldFakeEmail(username);
        const authUser = authList.users.find(u => u.email === fakeEmail);

        if (!authUser) {
            console.log(`\n-> ${username}: مفيش حساب Auth بالإيميل القديم ${fakeEmail} - تخطّى.`);
            continue;
        }

        const updates = { email: info.email, email_confirm: true };
        if (info.password) {
            updates.password = info.password;
        }

        console.log(`\n-> ${username}  (${fakeEmail}  ->  ${info.email})${info.password ? '  + باسورد جديد' : ''}`);

        const { error: updErr } = await admin.auth.admin.updateUserById(authUser.id, updates);

        if (updErr) {
            console.log('   ERROR:', updErr.message);
        } else {
            console.log('   تم التحديث بنجاح ✅');
        }
    }

    console.log('\nخلص. من دلوقتي كل مستخدم اتحدّث يدخل بإيميله الحقيقي (وباسورده الجديد لو اتحدد).');
    console.log('لازم كمان ترفع index.html المعدّل (بيقبل إيميل مش يوزرنيم) على GitHub Pages.');
}

run();

