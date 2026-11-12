// AI 글 생성 실행용 백그라운드 함수. studio-api 가 발급한 짧은 토큰이 있어야만 실행돼요(밖에서 직접 부를 수 없어요).
// 일반 함수는 응답 대기 시간이 짧아서, 오래 걸리는 AI 호출은 여기서 따로 처리하고 결과를 저장소에 남겨요.
const { connectLambda, getStore } = require('@netlify/blobs');
const L = require('../lib/leads');
const S = require('../lib/studio');
const AI = require('../lib/ai');

exports.handler = async (event) => {
  connectLambda(event);
  let t;
  try { t = S.readToken(JSON.parse(event.body || '{}').token); } catch (e) { t = null; }
  if (!t || !t.bg || !t.lid) return { statusCode: 401, body: 'no' };
  const store = getStore('lilo-leads');
  const key = 'genjob:' + t.lid;
  const job = await store.get(key, { type: 'json' });
  if (!job || job.id !== t.job || job.status !== 'pending') return { statusCode: 200, body: 'skip' };
  try {
    const lead = L.normalizeLead(await store.get('lead:' + t.lid, { type: 'json' }));
    if (!lead) throw new Error('업체 정보를 찾지 못했어요.');
    const g = await AI.generate(lead, job.input || {});
    const kws = Array.isArray((job.input || {}).keywords) ? job.input.keywords : [];
    const post = await S.createPost(store, lead, { title: g.title, body: g.body, keywords: kws, source: 'AI 생성' });
    await store.setJSON(key, { ...job, status: 'done', postId: post.id, finishedAt: new Date().toISOString() });
  } catch (e) {
    console.error('generate failed', e && e.message);
    await store.setJSON(key, { ...job, status: 'error', error: (e && e.message) || '글을 만들지 못했어요.', finishedAt: new Date().toISOString() });
  }
  return { statusCode: 200, body: 'ok' };
};
