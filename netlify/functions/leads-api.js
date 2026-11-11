// 관리자 대시보드용 API. 헤더 x-admin-password 와 환경변수 ADMIN_PASSWORD 가 같아야 접근 가능.
const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');
const L = require('../lib/leads');
const I = require('../lib/ideas');
const ST = require('../lib/studio');

function json(code, obj) {
  return { statusCode: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(obj) };
}

function authorized(event) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const given = String((event.headers || {})['x-admin-password'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function customerMap(store) {
  const leads = await L.listLeads(store);
  const out = {};
  for (const l of leads) if (l.studioLoginId) {
    const c = await ST.getCustomer(store, l.studioLoginId);
    if (c) out[l.id] = { loginId: c.loginId, disabled: !!c.disabled, createdAt: c.createdAt, lastLoginAt: c.lastLoginAt || '', access: ST.accessInfo(l) };
  }
  return out;
}
async function setStudioLogin(store, leadId, loginId, by) {
  const lead = L.normalizeLead(await store.get('lead:' + leadId, { type: 'json' }));
  if (!lead) throw new Error('업체를 찾지 못했어요.');
  const now = new Date().toISOString();
  lead.history = (lead.history || []).concat([{ at: now, by, field: 'studioAccount', from: lead.studioLoginId || '', to: loginId }]).slice(-80);
  lead.studioLoginId = loginId; lead.updatedAt = now; lead.updatedBy = by;
  await store.setJSON('lead:' + leadId, lead);
  return lead;
}

exports.handler = async (event) => {
  connectLambda(event);
  if (!process.env.ADMIN_PASSWORD) return json(503, { error: '서버에 관리자 비밀번호가 아직 설정되지 않았어요.' });
  if (!authorized(event)) return json(401, { error: '비밀번호가 맞지 않아요.' });

  const store = getStore('lilo-leads');
  try {
    if (event.httpMethod === 'GET') {
      return json(200, { leads: await L.listLeads(store), ideas: await I.listIdeas(store), postStats: await ST.statsByLead(store), customers: await customerMap(store), ideaTopics: I.TOPICS, ideaStatuses: I.IDEA_STATUSES, statuses: L.STATUSES, admins: L.ADMINS, logTypes: L.LOG_TYPES, payStatuses: L.PAY_STATUSES, now: new Date().toISOString() });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
    const req = JSON.parse(event.body || '{}');
    if (req.action === 'ingest') {
      const sub = req.submission || {};
      if (!sub.id) return json(400, { error: 'no submission' });
      return json(200, { lead: await L.saveLeadIfNew(store, L.leadFromSubmission(sub)) });
    }
    const by = L.ADMINS.includes(req.by) ? req.by : '';
    if (!by) return json(400, { error: '누가 수정하는지 선택해주세요.' });
    if (req.action === 'ideaCreate') return json(200, { idea: await I.createIdea(store, req.idea || {}, by) });
    if (req.action === 'ideaUpdate') return json(200, { idea: await I.updateIdea(store, String(req.id || ''), req.fields || {}, by) });
    if (req.action === 'ideaComment') return json(200, { idea: await I.commentIdea(store, String(req.id || ''), req.text, by) });
    if (req.action === 'ideaVote') return json(200, { idea: await I.voteIdea(store, String(req.id || ''), by) });
    if (req.action === 'ideaDelete') { await I.deleteIdea(store, String(req.id || ''), by); return json(200, { ok: true }); }
    if (req.action === 'exposure') return json(200, { lead: await L.toggleExposure(store, String(req.id || ''), req.date, by) });
    if (req.action === 'customerCreate') {
      const lead = L.normalizeLead(await store.get('lead:' + String(req.id || ''), { type: 'json' }));
      if (!lead) throw new Error('업체를 찾지 못했어요.');
      const made = await ST.createCustomer(store, lead, req.loginId, by);
      return json(200, { account: made, lead: await setStudioLogin(store, lead.id, made.loginId, by) });
    }
    if (req.action === 'customerReset') {
      const lead = L.normalizeLead(await store.get('lead:' + String(req.id || ''), { type: 'json' }));
      if (!lead || !lead.studioLoginId) throw new Error('고객 계정이 없어요.');
      return json(200, { account: await ST.resetCustomer(store, lead.studioLoginId) });
    }
    if (req.action === 'customerToggle') {
      const lead = L.normalizeLead(await store.get('lead:' + String(req.id || ''), { type: 'json' }));
      if (!lead || !lead.studioLoginId) throw new Error('고객 계정이 없어요.');
      await ST.setCustomerDisabled(store, lead.studioLoginId, !!req.disabled);
      return json(200, { ok: true });
    }
    if (req.action === 'customerRemove') {
      const lead = L.normalizeLead(await store.get('lead:' + String(req.id || ''), { type: 'json' }));
      if (!lead || !lead.studioLoginId) throw new Error('고객 계정이 없어요.');
      await ST.removeCustomer(store, lead.studioLoginId);
      return json(200, { lead: await setStudioLogin(store, lead.id, '', by) });
    }
    if (req.action === 'addLog') return json(200, { lead: await L.addLog(store, String(req.id || ''), req.log || {}, by) });
    if (req.action === 'update') return json(200, { lead: await L.updateLead(store, String(req.id || ''), req.fields || {}, by) });
    if (req.action === 'create') return json(200, { lead: await L.createManual(store, req.lead || {}, by) });
    if (req.action === 'delete') { await L.removeLead(store, String(req.id || '')); return json(200, { ok: true }); }
    return json(400, { error: '알 수 없는 요청이에요.' });
  } catch (e) {
    return json(400, { error: e.message || '처리하지 못했어요.' });
  }
};
