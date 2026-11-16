// 대표님 개인 전용 진단서 도구 API. 팀 관리자 화면과 비밀번호·저장소가 완전히 따로예요.
// 환경변수 REPORT_PASSWORD 가 있어야 열려요(ADMIN_PASSWORD 와 다른 값으로 정해 주세요).
const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');
const KW = require('../lib/keywords');

function json(code, obj) {
  return { statusCode: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(obj) };
}
function authorized(event) {
  const expected = process.env.REPORT_PASSWORD || '';
  if (!expected) return false;
  const given = String((event.headers || {})['x-report-password'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

const STATUSES = ['작성', '발송', '답장', '계약·완료', '제외'];
function sanitize(r) {
  const keywords = (Array.isArray(r.keywords) ? r.keywords : []).slice(0, 8).map((k) => ({
    k: clean(k.k, 40), vol: Math.max(0, Math.round(Number(k.vol) || 0)), comp: clean(k.comp, 10),
    rank: k.rank === '' || k.rank == null || !Number.isFinite(Number(k.rank)) ? null : Math.max(1, Math.round(Number(k.rank))),
    cap: k.cap ? 20 : 0, total: k.total === '' || k.total == null || !Number.isFinite(Number(k.total)) ? null : Math.max(0, Math.round(Number(k.total))),
  })).filter((k) => k.k);
  const rivals = (Array.isArray(r.rivals) ? r.rivals : []).slice(0, 6).map((v) => ({ rank: Math.max(1, Math.round(Number(v.rank) || 1)), name: clean(v.name, 12), mine: !!v.mine, vr: Number.isFinite(Number(v.vr)) && v.vr != null ? Math.round(Number(v.vr)) : null, br: Number.isFinite(Number(v.br)) && v.br != null ? Math.round(Number(v.br)) : null, bk: !!v.bk }));
  const checks = (Array.isArray(r.checks) ? r.checks : []).slice(0, 6).map((c) => !!c);
  while (checks.length < 6) checks.push(false);
  const mainN = Number(r.main); const main = Number.isInteger(mainN) && mainN >= 0 && mainN < 6 ? mainN : -1;
  return {
    store: clean(r.store, 60), region: clean(r.region, 60), biz: clean(r.biz, 20), checkedAt: clean(r.checkedAt, 40),
    keywords, rivals, intro: Math.max(0, Math.min(99999, Math.round(Number(r.intro) || 0))), checks, main, placeLink: clean(r.placeLink, 300), status: STATUSES.includes(r.status) ? r.status : '', contact: clean(r.contact, 80),
  };
}

exports.handler = async (event) => {
  connectLambda(event);
  if (!process.env.REPORT_PASSWORD) return json(503, { error: '서버에 진단서 비밀번호(REPORT_PASSWORD)가 아직 설정되지 않았어요.' });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  if (!authorized(event)) return json(401, { error: '비밀번호가 맞지 않아요.' });
  // 방금 저장한 기록이 목록에 바로 보이도록 강한 일관성으로 먼저 시도하고, 안 되는 환경이면 기본 방식으로 다시 시도
  const mk = (strong) => getStore(strong ? { name: 'lilo-reports', consistency: 'strong' } : { name: 'lilo-reports' });
  const store = {};
  ['list', 'get', 'setJSON', 'delete'].forEach((m) => { store[m] = async (...a) => { try { return await mk(true)[m](...a); } catch (e) { return await mk(false)[m](...a); } }; });
  let req;
  try { req = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: '요청 형식이 올바르지 않아요.' }); }
  try {
    if (req.action === 'ping') return json(200, { ok: true, keywordsReady: KW.isReady() });
    if (req.action === 'suggest') {
      try { return json(200, { items: await KW.suggest(req.hints) }); } catch (e) { return json(e.notReady ? 503 : 400, { error: e.message }); }
    }
    if (req.action === 'list') {
      const { blobs } = await store.list({ prefix: 'r:' });
      const all = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
      return json(200, { reports: all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)).slice(0, 500) });
    }
    if (req.action === 'save') {
      const r = sanitize(req.report || {});
      if (!r.store) return json(400, { error: '매장명을 적어주세요.' });
      const now = new Date().toISOString();
      const id = clean(req.id, 40) || now.replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
      const prev = clean(req.id, 40) ? await store.get('r:' + id, { type: 'json' }) : null;
      const rec = { id, ...r, status: r.status || (prev && prev.status) || '작성', savedAt: now };
      await store.setJSON('r:' + id, rec);
      return json(200, { report: rec });
    }
    if (req.action === 'setStatus') {
      const id = clean(req.id, 40); const rec = await store.get('r:' + id, { type: 'json' });
      if (!rec) return json(404, { error: '진단서를 찾지 못했어요.' });
      if (!STATUSES.includes(req.status)) return json(400, { error: '상태 값이 올바르지 않아요.' });
      rec.status = req.status; await store.setJSON('r:' + id, rec); return json(200, { report: rec });
    }
    if (req.action === 'delete') { await store.delete('r:' + clean(req.id, 40)); return json(200, { ok: true }); }
    return json(400, { error: '알 수 없는 요청이에요.' });
  } catch (e) {
    console.error('report-api', e && e.message);
    return json(400, { error: e.message || '처리하지 못했어요.' });
  }
};
