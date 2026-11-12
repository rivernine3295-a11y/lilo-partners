// 릴로 블로그 서포터(고객용) API. 로그인한 고객은 자기 업체의 정보와 글만 다룰 수 있다.
const { connectLambda, getStore } = require('@netlify/blobs');
const L = require('../lib/leads');
const S = require('../lib/studio');
const AI = require('../lib/ai');

function json(code, obj) {
  return { statusCode: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(obj) };
}
const STATE_MSG = {
  expired: '이용 기간이 끝났어요. 재계약 문의를 남겨 주세요.',
  no_term: '계약 기간이 아직 등록되지 않았어요. 담당자에게 문의해 주세요.',
  not_started: '아직 이용 시작 전이에요. 계약 시작일부터 사용할 수 있어요.',
};

exports.handler = async (event) => {
  connectLambda(event);
  if (!process.env.ADMIN_PASSWORD) return json(503, { error: '서버 설정이 아직 끝나지 않았어요.' });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const store = getStore('lilo-leads');
  let req;
  try { req = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: '요청 형식이 올바르지 않아요.' }); }
  try {
    if (req.action === 'signup') return json(200, await S.signup(store, req, (event.headers || {})['x-nf-client-connection-ip'] || (event.headers || {})['x-forwarded-for'], L.listLeads));
    if (req.action === 'login') return json(200, await S.login(store, req.loginId, req.password));

    const c = await S.authenticate(store, (event.headers || {})['x-studio-token']);
    if (!c) return json(401, { error: '로그인이 필요해요.', login: true });
    const lead = L.normalizeLead(await store.get('lead:' + c.leadId, { type: 'json' }));
    if (!lead) return json(404, { error: '업체 정보를 찾지 못했어요.' });
    const access = S.accessInfo(lead);

    if (req.action === 'me') {
      const posts = access.state === 'active' ? await S.listPosts(store, lead.id) : [];
      return json(200, {
        loginId: c.loginId,
        store: { name: lead.storeName, bizType: lead.bizType, region: lead.region },
        keywords: (lead.keywords || []).map((k) => k.k),
        access, message: STATE_MSG[access.state] || '',
        quota: { limit: S.quotaOf(lead), used: S.usedThisMonth(posts) },
        today: S.kstToday(),
      });
    }
    if (access.state !== 'active') return json(403, { error: STATE_MSG[access.state] || '이용할 수 없어요.', state: access.state });

    if (req.action === 'listPosts') return json(200, { posts: (await S.listPosts(store, lead.id)).slice(0, 300) });
    if (req.action === 'createPost') return json(200, { post: await S.createPost(store, lead, req.post || {}) });
    if (req.action === 'updatePost') return json(200, { post: await S.updatePost(store, lead.id, req.id, req.fields || {}) });
    if (req.action === 'publish') return json(200, { post: await S.markPublished(store, lead.id, req.id, req.url) });
    if (req.action === 'unpublish') return json(200, { post: await S.unpublish(store, lead.id, req.id) });
    if (req.action === 'deletePost') { await S.deletePost(store, lead.id, req.id); return json(200, { ok: true }); }
    if (req.action === 'changePassword') { await S.changePassword(store, c, req.oldPassword, req.newPassword); return json(200, { ok: true }); }
    if (req.action === 'generate') {
      const q = S.quotaOf(lead);
      if (S.usedThisMonth(await S.listPosts(store, lead.id)) >= q) throw new Error('이번 달 사용 가능한 글 수(' + q + '편)를 모두 사용했어요.');
      if (!AI.isReady()) return json(503, { error: 'AI 글 생성이 아직 연결되지 않았어요. 담당자에게 문의해 주세요.', notReady: true });
      const key = 'genjob:' + lead.id;
      const prev = await store.get(key, { type: 'json' });
      if (prev) {
        // 진행 중인 작업이 있을 때만 막아요. 시작도 못 하고 30초 넘게 대기한 작업이나 4분 넘은 작업은 멈춘 것으로 보고 새로 시작해요.
        const age = Date.now() - new Date(prev.startedAt).getTime();
        const alive = (prev.status === 'pending' && age < 30000) || (prev.status === 'running' && age < 4 * 60000);
        if (alive) throw new Error('이미 글을 만드는 중이에요. 잠시만 기다려 주세요.');
      }
      const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const input = { topic: req.topic, keywords: Array.isArray(req.keywords) ? req.keywords.slice(0, 10) : [], tone: req.tone, length: req.length, extra: req.extra };
      await store.setJSON(key, { id: jobId, status: 'pending', startedAt: new Date().toISOString(), input });
      const h = event.headers || {};
      // 고객이 지금 접속한 주소 그대로 부르면 주소 이동(리다이렉트)에 걸리지 않아요.
      const origin = (h['x-forwarded-host'] || h.host) ? 'https://' + (h['x-forwarded-host'] || h.host) : process.env.URL;
      const bgToken = S.signToken({ bg: 1, lid: lead.id, job: jobId, exp: Date.now() + 10 * 60000 });
      let bgInfo = '';
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
        // 백그라운드 함수는 요청이 어떤 내용이든 바로 202 로 답해요. 주소 이동에도 안전하도록 GET + 주소에 토큰을 실어요.
        const r = await fetch(origin + '/.netlify/functions/studio-generate-background?t=' + encodeURIComponent(bgToken), { method: 'GET', signal: ctl.signal });
        clearTimeout(tm);
        bgInfo = 'HTTP ' + r.status;
        if (!r.ok && r.status !== 202) throw new Error('bg ' + r.status);
      } catch (e) {
        await store.setJSON(key, { id: jobId, status: 'error', error: 'AI 작업을 시작하지 못했어요. 잠시 후 다시 시도해 주세요. (' + (bgInfo || e.message) + ')', finishedAt: new Date().toISOString() });
        throw new Error('AI 작업을 시작하지 못했어요. 잠시 후 다시 시도해 주세요. (' + (bgInfo || e.message) + ')');
      }
      return json(200, { started: true });
    }
    if (req.action === 'genStatus') {
      const job = await store.get('genjob:' + lead.id, { type: 'json' });
      if (!job) return json(200, { status: 'none' });
      const age = Date.now() - new Date(job.startedAt).getTime();
      if (job.status === 'pending' && age > 30000) return json(200, { status: 'error', error: 'AI 작업이 시작되지 않았어요. 다시 시도해 주세요. (백그라운드 실행 안 됨' + (job.bg ? ', ' + job.bg : '') + ')' });
      if ((job.status === 'pending' || job.status === 'running') && age > 4 * 60000) return json(200, { status: 'error', error: 'AI 응답이 너무 오래 걸려요. 다시 시도해 주세요.' });
      return json(200, { status: job.status, postId: job.postId || '', error: job.error || '' });
    }
    return json(400, { error: '알 수 없는 요청이에요.' });
  } catch (e) {
    return json(400, { error: e.message || '처리하지 못했어요.' });
  }
};
