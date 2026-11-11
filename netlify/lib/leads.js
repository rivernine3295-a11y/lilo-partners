// 문의 저장·수정 로직 (저장소는 주입받아서 테스트 가능)
const STATUSES = ['신규', '연락 완료', '상담 중', '계약', '보류'];
const ADMINS = ['강현구', '윤현노', '윤지수'];

function cleanStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function leadFromSubmission(sub) {
  const d = (sub && sub.data) || {};
  const now = new Date().toISOString();
  return {
    id: cleanStr(sub.id, 80),
    createdAt: sub.created_at || now,
    form: cleanStr(sub.form_name, 40),
    source: cleanStr(d.source, 40) || (sub.form_name === 'lilo-contact' ? '일반 문의' : '빠른 문의'),
    storeName: cleanStr(d.storeName, 80),
    contact: cleanStr(d.contact, 80),
    bizType: cleanStr(d.bizType, 20),
    placeLink: cleanStr(d.placeLink, 300),
    diagnosis: cleanStr(d.diagnosis, 300),
    status: '신규',
    assignee: '',
    memo: '',
    lastContactAt: '',
    updatedAt: now,
    updatedBy: '',
    history: [],
  };
}

async function saveLead(store, lead) {
  await store.setJSON('lead:' + lead.id, lead);
}

async function listLeads(store) {
  const { blobs } = await store.list({ prefix: 'lead:' });
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return all.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function validateFields(fields) {
  const out = {};
  if ('status' in fields) {
    if (!STATUSES.includes(fields.status)) throw new Error('상태 값이 올바르지 않아요.');
    out.status = fields.status;
  }
  if ('assignee' in fields) {
    if (fields.assignee !== '' && !ADMINS.includes(fields.assignee)) throw new Error('담당자 값이 올바르지 않아요.');
    out.assignee = fields.assignee;
  }
  if ('memo' in fields) out.memo = cleanStr(fields.memo, 2000);
  if ('lastContactAt' in fields) {
    const v = cleanStr(fields.lastContactAt, 10);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('날짜 형식이 올바르지 않아요.');
    out.lastContactAt = v;
  }
  return out;
}

async function updateLead(store, id, fields, by) {
  const key = 'lead:' + id;
  const lead = await store.get(key, { type: 'json' });
  if (!lead) throw new Error('문의를 찾지 못했어요.');
  const changes = validateFields(fields);
  const now = new Date().toISOString();
  for (const k of Object.keys(changes)) {
    if (lead[k] !== changes[k]) {
      lead.history = (lead.history || []).concat([{ at: now, by, field: k, from: lead[k], to: changes[k] }]).slice(-50);
      lead[k] = changes[k];
    }
  }
  lead.updatedAt = now;
  lead.updatedBy = by;
  await store.setJSON(key, lead);
  return lead;
}

async function createManual(store, input, by) {
  const now = new Date().toISOString();
  const id = 'manual-' + now.replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  const lead = leadFromSubmission({
    id,
    created_at: now,
    form_name: 'manual',
    data: {
      source: cleanStr(input.source, 40) || '수동 등록',
      storeName: input.storeName,
      contact: input.contact,
      bizType: input.bizType,
    },
  });
  lead.memo = cleanStr(input.memo, 2000);
  lead.updatedBy = by;
  if (!lead.storeName && !lead.contact) throw new Error('매장명이나 연락처 중 하나는 적어주세요.');
  await saveLead(store, lead);
  return lead;
}

async function removeLead(store, id) {
  await store.delete('lead:' + id);
}

module.exports = { STATUSES, ADMINS, leadFromSubmission, saveLead, listLeads, updateLead, createManual, removeLead };
