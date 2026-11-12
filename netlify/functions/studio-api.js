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
      let g;
      try { g = await AI.generate(lead, req); } catch (e) { if (e.notReady) return json(503, { error: e.message, notReady: true }); throw e; }
      const kws = (Array.isArray(req.keywords) ? req.keywords : []);
      return json(200, { post: await S.createPost(store, lead, { title: g.title, body: g.body, keywords: kws, source: 'AI 생성' }) });
    }
    return json(400, { error: '알 수 없는 요청이에요.' });
  } catch (e) {
    return json(400, { error: e.message || '처리하지 못했어요.' });
  }
};
