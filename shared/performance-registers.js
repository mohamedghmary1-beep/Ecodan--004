(function () {
  'use strict';
  const host = document.getElementById('projectRegisters');
  if (!host) return;
  const config = {
    issues: { title: 'Issues / المشكلات', fields: [['code','Code'],['title','Issue / المشكلة'],['in_charge','In charge / المسؤول'],['status','Status'],['action_requested','Action requested / الإجراء المطلوب']] },
    risks: { title: 'Risks / المخاطر', fields: [['code','Code'],['title','Risk / الخطر'],['owner','Owner / المسؤول'],['status','Status'],['impact_label','Impact / التأثير'],['mitigation','Mitigation / خطة المعالجة']] }
  };
  const rows = { issues: [], risks: [] };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const editable = () => window.canEditDashboard === true && ['admin','super_admin'].includes(window.currentUserRole);
  const client = () => window.__guardClient;
  function message(type, text) { document.getElementById(type+'RegisterMessage').textContent = text; }
  function renderDisplay() {
    const section = document.getElementById('registerDisplay');
    const display = document.getElementById('registerDisplayCards');
    display.innerHTML = Object.keys(config).filter(type => rows[type].some(row => String(row.title ?? '').trim())).map(type => {
      const items = rows[type].filter(row => String(row.title ?? '').trim()).map(row => `<article class="register-item"><h4>${esc(row.code)} · ${esc(row.title)}</h4>${config[type].fields.filter(([key]) => !['code','title'].includes(key) && row[key]).map(([key,label]) => `<p><span class="register-meta">${esc(label)}:</span> ${esc(row[key])}</p>`).join('')}</article>`).join('');
      return `<div class="register-card"><h3>${config[type].title}</h3>${items}</div>`;
    }).join('');
    section.hidden = !display.innerHTML;
  }
  function render(type) {
    const card = document.getElementById(type+'Register');
    card.querySelector('[data-add]').hidden = !editable();
    card.querySelector('.register-list').innerHTML = rows[type].map(row => `<article class="register-item"><h4>${esc(row.code)} · ${esc(row.title)}</h4>${config[type].fields.filter(([key]) => !['code','title'].includes(key) && row[key]).map(([key,label]) => `<p><span class="register-meta">${esc(label)}:</span> ${esc(row[key])}</p>`).join('')}${editable()?`<button type="button" data-edit="${esc(row.id)}">Edit / تعديل</button>`:''}</article>`).join('') || '<p class="register-meta">No entries yet / لا توجد سجلات حتى الآن</p>';
    renderDisplay();
  }
  async function load(type) {
    message(type, 'Loading…');
    try {
      if (!client()) throw new Error('Session is not ready. Reload after signing in.');
      const result = await client().from('project_'+type).select('*').order('sort_order').order('id');
      if (result.error) throw result.error;
      rows[type] = result.data || [];
      render(type); message(type, '');
    } catch (error) {
      message(type, ['PGRST205','42P01'].includes(error.code) ? 'Register tables are not installed. Run sql/schedule_risk_migration.sql in Supabase, then reload. / جداول السجل غير مهيأة.' : 'Could not load register: '+error.message);
    }
  }
  function openForm(type, row = {}) {
    if (!editable()) return;
    const card = document.getElementById(type+'Register');
    card.querySelector('form')?.remove();
    const form = document.createElement('form'); form.className = 'register-form';
    form.innerHTML = config[type].fields.map(([key,label]) => `<label class="${['title','action_requested','mitigation'].includes(key)?'wide':''}">${esc(label)}${['title','action_requested','mitigation'].includes(key)?`<textarea name="${key}" ${key==='title'?'required':''} maxlength="4000">${esc(row[key])}</textarea>`:`<input name="${key}" value="${esc(row[key] ?? (key==='status'?'Open':''))}" maxlength="200" ${key==='code'?'required':''}>`}</label>`).join('')+'<div class="register-form-actions"><button type="submit" class="primary">Save / حفظ</button><button type="button" data-cancel>Cancel / إلغاء</button></div>';
    form.querySelector('[data-cancel]').onclick = () => form.remove();
    form.onsubmit = event => {
      event.preventDefault();
      if (!editable() || !form.reportValidity()) return;
      const payload = Object.fromEntries(config[type].fields.map(([key]) => [key,form.elements.namedItem(key).value.trim()]));
      if (!payload.code || !payload.title) { message(type,'Code and title are required.'); return; }
      if (!row.id) payload.sort_order = Math.max(0,...rows[type].map(r => Number(r.sort_order)||0))+1;
      const save = async () => {
        if (!editable() || form.dataset.saving === 'true') return;
        form.dataset.saving = 'true';
        form.querySelectorAll('button').forEach(button => button.disabled = true);
        message(type,'Saving…');
        try {
          const query = client().from('project_'+type);
          const result = row.id ? await query.update(payload).eq('id',row.id) : await query.insert(payload);
          if (result.error) throw result.error;
          form.remove(); await load(type);
        } catch (error) { message(type,'Save failed: '+error.message); }
        finally { form.dataset.saving = 'false'; form.querySelectorAll('button').forEach(button => button.disabled = false); }
      };
      if (typeof window.guardUpload === 'function') {
        try { window.guardUpload(save); } catch (error) { message(type,'Could not confirm save: '+error.message); }
      } else { message(type,'Save confirmation is unavailable. Reload after signing in.'); }
    };
    card.querySelector('.register-card-header').after(form); form.querySelector('input').focus();
  }
  for (const type of Object.keys(config)) {
    const card = document.createElement('article'); card.id = type+'Register'; card.className = 'register-card';
    card.innerHTML = `<div class="register-card-header"><h3>${config[type].title}</h3><button type="button" class="primary" data-add hidden>+ Add / إضافة</button></div><p class="register-message" id="${type}RegisterMessage" role="status" aria-live="polite">Waiting for session…</p><div class="register-list"></div>`;
    host.appendChild(card);
    card.querySelector('[data-add]').onclick = () => openForm(type);
    card.addEventListener('click', event => {
      const button = event.target.closest('[data-edit]');
      if (button) { const row = rows[type].find(item => String(item.id)===button.dataset.edit); if (row) openForm(type,row); }
    });
  }
  function init() { Object.keys(config).forEach(type => { render(type); load(type); }); }
  document.addEventListener('authguard:ready', init);
  if (window.currentUserRole) init();
})();
