// 문의·영업 업체 저장/수정 로직 (저장소는 주입받아서 테스트 가능)
const STATUSES = ['문의', '상담', '견적 제시', '계약', '진행 중', '완료', '보류'];
const ADMINS = ['강현구', '윤현노', '윤지수'];
const OLD_STATUS = { '신규': '문의', '연락 완료': '상담', '상담 중': '상담' };
const LOG_TYPES = ['통화', '방문', '카톡', '메일', '기타'];
const PAY_STATUSES = ['', '보장 진행 중', '청구 대기', '청구 완료', '입금 완료'];
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function cleanStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// 예전 형식의 데이터도 새 형식으로 맞춰서 읽는다.
function normalizeLead(l) {
  if (!l) return l;
  if (OLD_STATUS[l.status]) l.status = OLD_STATUS[l.status];
  if (!STATUSES.includes(l.status)) l.status = '문의';
  const defaults = { region: '', designerCount: '', quote: '', contractMonths: '', contractStart: '', contractEnd: '',
    nextContactAt: '', decisionMaker: '', placeLink: '', closedBy: '', closedAt: '', workStart: '', guaranteeDays: 25, exposureDays: [], paymentStatus: '', paidAt: '', studioLoginId: '', studioQuota: 12, inviteCode: '', internal: false, keywords: [], logs: [], history: [] };
  for (const k of Object.keys(defaults)) if (l[k] === undefined) l[k] = defaults[k];
  return l;
}

function leadFromSubmission(sub) {
  const d = (sub && sub.data) || {};
  const now = new Date().toISOString();
  return normalizeLead({
    id: cleanStr(sub.id, 80),
    createdAt: sub.created_at || now,
    form: cleanStr(sub.form_name, 40),
    source: cleanStr(d.source, 40) || (sub.form_name === 'lilo-contact' ? '일반 문의' : '빠른 문의'),
    storeName: cleanStr(d.storeName, 80),
    contact: cleanStr(d.contact, 80),
    bizType: cleanStr(d.bizType, 20),
    placeLink: cleanStr(d.placeLink, 300),
    diagnosis: cleanStr(d.diagnosis, 300),
    status: '문의',
    assignee: '',
    memo: '',
    lastContactAt: '',
    updatedAt: now,
    updatedBy: '',
  });
}

async function saveLead(store, lead) {
  await store.setJSON('lead:' + lead.id, lead);
}

async function saveLeadIfNew(store, lead) {
  const exists = await store.get('lead:' + lead.id, { type: 'json' });
  if (exists) return normalizeLead(exists);
  await saveLead(store, lead);
  return lead;
}

async function listLeads(store) {
  const { blobs } = await store.list({ prefix: 'lead:' });
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return all.filter(Boolean).map(normalizeLead).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dateField(v) {
  const s = cleanStr(v, 10);
  if (s && !DATE_RE.test(s)) throw new Error('날짜 형식이 올바르지 않아요.');
  return s;
}
function numField(v, max, label) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(label + ' 값이 올바르지 않아요.');
  return Math.round(n);
}
function keywordsField(v) {
  if (!Array.isArray(v)) throw new Error('키워드 형식이 올바르지 않아요.');
  return v.slice(0, 10).map((x) => {
    const k = cleanStr(x && x.k, 40);
    if (!k) return null;
    const ranks = ((x && x.ranks) || []).slice(-60).map((r) => ({ d: dateField(r.d), r: numField(r.r, 9999, '순위') })).filter((r) => r.d && r.r !== '');
    return { k, ranks };
  }).filter(Boolean);
}

function validateFields(fields) {
  const out = {};
  const f = fields || {};
  if ('status' in f) {
    if (!STATUSES.includes(f.status)) throw new Error('단계 값이 올바르지 않아요.');
    out.status = f.status;
  }
  if ('assignee' in f) {
    if (f.assignee !== '' && !ADMINS.includes(f.assignee)) throw new Error('담당자 값이 올바르지 않아요.');
    out.assignee = f.assignee;
  }
  const strs = { memo: 2000, storeName: 80, contact: 80, bizType: 20, placeLink: 300, region: 60, decisionMaker: 40, source: 40 };
  for (const k of Object.keys(strs)) if (k in f) out[k] = cleanStr(f[k], strs[k]);
  for (const k of ['lastContactAt', 'nextContactAt', 'contractStart', 'contractEnd']) if (k in f) out[k] = dateField(f[k]);
  if ('workStart' in f) out.workStart = dateField(f.workStart);
  if ('paidAt' in f) out.paidAt = dateField(f.paidAt);
  if ('studioQuota' in f) { const q = numField(f.studioQuota, 999, '월 글 수'); out.studioQuota = q === '' ? 12 : q; }
  if ('guaranteeDays' in f) { const g = numField(f.guaranteeDays, 365, '보장 일수'); out.guaranteeDays = g === '' ? 25 : g; }
  if ('paymentStatus' in f) { if (!PAY_STATUSES.includes(f.paymentStatus)) throw new Error('결제 상태 값이 올바르지 않아요.'); out.paymentStatus = f.paymentStatus; }
  if ('closedBy' in f) {
    if (f.closedBy !== '' && !ADMINS.includes(f.closedBy)) throw new Error('성사자 값이 올바르지 않아요.');
    out.closedBy = f.closedBy;
  }
  if ('closedAt' in f) out.closedAt = dateField(f.closedAt);
  if ('designerCount' in f) out.designerCount = numField(f.designerCount, 999, '디자이너 수');
  if ('quote' in f) out.quote = numField(f.quote, 1000000000, '견적가');
  if ('contractMonths' in f) out.contractMonths = numField(f.contractMonths, 120, '계약 개월 수');
  if ('keywords' in f) out.keywords = keywordsField(f.keywords);
  return out;
}

async function updateLead(store, id, fields, by) {
  const key = 'lead:' + id;
  const lead = normalizeLead(await store.get(key, { type: 'json' }));
  if (!lead) throw new Error('업체를 찾지 못했어요.');
  const changes = validateFields(fields);
  const now = new Date().toISOString();
  // 계약 단계로 처음 넘어가면 성사자·성사일을 자동으로 남긴다(정산 근거). 직접 지정한 값이 있으면 그 값을 우선한다.
  if (changes.status === '계약' && lead.status !== '계약') {
    if (!lead.closedBy && !('closedBy' in changes)) changes.closedBy = by;
    if (!lead.closedAt && !('closedAt' in changes)) changes.closedAt = now.slice(0, 10);
  }
  // 계약 단계로 처음 넘어갈 때 계약 기간이 비어 있으면, 시작일=오늘 · 종료일=계약 개월 수 뒤로 자동 입력해요(개월 수를 아는 경우만).
  if (changes.status === '계약' && lead.status !== '계약') {
    const months = Number('contractMonths' in changes ? changes.contractMonths : lead.contractMonths);
    const hasStart = ('contractStart' in changes ? changes.contractStart : lead.contractStart), hasEnd = ('contractEnd' in changes ? changes.contractEnd : lead.contractEnd);
    if (!hasStart && !hasEnd && months > 0) {
      const st = kstToday(), d = new Date(st + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months);
      changes.contractStart = st; changes.contractEnd = d.toISOString().slice(0, 10);
    }
  }
  // 진행 중으로 처음 넘어가면 작업 시작일을 오늘로 자동 기록한다(보장 일수 계산의 기준).
  if (changes.status === '진행 중' && lead.status !== '진행 중' && !lead.workStart && !('workStart' in changes)) changes.workStart = kstToday();
  for (const k of Object.keys(changes)) {
    if (JSON.stringify(lead[k]) !== JSON.stringify(changes[k])) {
      const entry = k === 'keywords' || k === 'memo'
        ? { at: now, by, field: k }
        : { at: now, by, field: k, from: lead[k], to: changes[k] };
      lead.history = (lead.history || []).concat([entry]).slice(-80);
      lead[k] = changes[k];
    }
  }
  lead.updatedAt = now;
  lead.updatedBy = by;
  await store.setJSON(key, lead);
  return lead;
}

async function addLog(store, id, log, by) {
  const key = 'lead:' + id;
  const lead = normalizeLead(await store.get(key, { type: 'json' }));
  if (!lead) throw new Error('업체를 찾지 못했어요.');
  const text = cleanStr(log && log.text, 1000);
  if (!text) throw new Error('내용을 적어주세요.');
  const type = LOG_TYPES.includes(log.type) ? log.type : '기타';
  const now = new Date().toISOString();
  lead.logs = (lead.logs || []).concat([{ at: now, by, type, text }]).slice(-200);
  if (['통화', '방문', '카톡', '메일'].includes(type)) lead.lastContactAt = now.slice(0, 10);
  lead.updatedAt = now;
  lead.updatedBy = by;
  await store.setJSON(key, lead);
  return lead;
}

// 1페이지 노출 확인일을 켜고 끈다(같은 날짜를 다시 누르면 취소). 누가 언제 확인했는지 함께 남긴다.
async function toggleExposure(store, id, date, by) {
  const key = 'lead:' + id;
  const lead = normalizeLead(await store.get(key, { type: 'json' }));
  if (!lead) throw new Error('업체를 찾지 못했어요.');
  const d = dateField(date);
  if (!d) throw new Error('날짜를 선택해주세요.');
  if (d > kstToday()) throw new Error('오늘 이후 날짜는 기록할 수 없어요.');
  const now = new Date().toISOString();
  const list = lead.exposureDays || [];
  const had = list.some((x) => x.d === d);
  lead.exposureDays = had ? list.filter((x) => x.d !== d) : list.concat([{ d, by, at: now }]).sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-400);
  lead.history = (lead.history || []).concat([{ at: now, by, field: 'exposure', from: had ? d : '', to: had ? '' : d }]).slice(-80);
  lead.updatedAt = now;
  lead.updatedBy = by;
  await store.setJSON(key, lead);
  return lead;
}

async function createManual(store, input, by) {
  const now = new Date().toISOString();
  const id = 'manual-' + now.replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  const lead = leadFromSubmission({
    id, created_at: now, form_name: 'manual',
    data: { source: cleanStr(input.source, 40) || '수동 등록', storeName: input.storeName, contact: input.contact, bizType: input.bizType, placeLink: input.placeLink },
  });
  const extra = validateFields({
    region: input.region || '', designerCount: input.designerCount === undefined ? '' : input.designerCount,
    quote: input.quote === undefined ? '' : input.quote, decisionMaker: input.decisionMaker || '',
    nextContactAt: input.nextContactAt || '', memo: input.memo || '',
    keywords: (input.keywords || []).map((k) => ({ k, ranks: [] })),
  });
  Object.assign(lead, extra);
  if (STATUSES.includes(input.status)) lead.status = input.status;
  lead.updatedBy = by;
  if (!lead.storeName && !lead.contact) throw new Error('매장명이나 연락처 중 하나는 적어주세요.');
  await saveLead(store, lead);
  return lead;
}

async function removeLead(store, id) {
  await store.delete('lead:' + id);
}

module.exports = { STATUSES, ADMINS, LOG_TYPES, PAY_STATUSES, toggleExposure, normalizeLead, leadFromSubmission, saveLead, saveLeadIfNew, listLeads, updateLead, addLog, createManual, removeLead };
