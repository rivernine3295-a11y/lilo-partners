// 관리자 브레인스토밍(개선 아이디어) 저장/수정 로직
const TOPICS = ['시스템 변경', '영업 방식', '마케팅·콘텐츠', '견적·가격', '업무 분담', '기타'];
const IDEA_STATUSES = ['아이디어', '논의 중', '채택', '보류', '완료'];

function cleanStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function normalizeIdea(i) {
  if (!i) return i;
  if (!Array.isArray(i.votes)) i.votes = [];
  if (!Array.isArray(i.comments)) i.comments = [];
  return i;
}

async function listIdeas(store) {
  const { blobs } = await store.list({ prefix: 'idea:' });
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return all.filter(Boolean).map(normalizeIdea).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function createIdea(store, input, by) {
  const title = cleanStr(input.title, 100);
  if (title.length < 2) throw new Error('제목을 2글자 이상 적어주세요.');
  const topic = TOPICS.includes(input.topic) ? input.topic : '기타';
  const now = new Date().toISOString();
  const id = 'idea-' + now.replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  const idea = { id, createdAt: now, createdBy: by, topic, title, body: cleanStr(input.body, 3000), status: '아이디어', votes: [], comments: [], updatedAt: now, updatedBy: by };
  await store.setJSON('idea:' + id, idea);
  return idea;
}

async function load(store, id) {
  const idea = normalizeIdea(await store.get('idea:' + id, { type: 'json' }));
  if (!idea) throw new Error('아이디어를 찾지 못했어요.');
  return idea;
}

async function updateIdea(store, id, fields, by) {
  const idea = await load(store, id);
  const f = fields || {};
  if ('title' in f) { const t = cleanStr(f.title, 100); if (t.length < 2) throw new Error('제목을 2글자 이상 적어주세요.'); idea.title = t; }
  if ('body' in f) idea.body = cleanStr(f.body, 3000);
  if ('topic' in f) { if (!TOPICS.includes(f.topic)) throw new Error('주제 값이 올바르지 않아요.'); idea.topic = f.topic; }
  if ('status' in f) { if (!IDEA_STATUSES.includes(f.status)) throw new Error('상태 값이 올바르지 않아요.'); idea.status = f.status; }
  idea.updatedAt = new Date().toISOString();
  idea.updatedBy = by;
  await store.setJSON('idea:' + id, idea);
  return idea;
}

async function commentIdea(store, id, text, by) {
  const idea = await load(store, id);
  const t = cleanStr(text, 1000);
  if (!t) throw new Error('의견을 적어주세요.');
  idea.comments = idea.comments.concat([{ at: new Date().toISOString(), by, text: t }]).slice(-100);
  idea.updatedAt = new Date().toISOString();
  idea.updatedBy = by;
  await store.setJSON('idea:' + id, idea);
  return idea;
}

async function voteIdea(store, id, by) {
  const idea = await load(store, id);
  idea.votes = idea.votes.includes(by) ? idea.votes.filter((v) => v !== by) : idea.votes.concat([by]);
  await store.setJSON('idea:' + id, idea);
  return idea;
}

async function deleteIdea(store, id, by) {
  const idea = await load(store, id);
  if (idea.createdBy !== by) throw new Error('작성한 사람만 삭제할 수 있어요.');
  await store.delete('idea:' + id);
}

module.exports = { TOPICS, IDEA_STATUSES, listIdeas, createIdea, updateIdea, commentIdea, voteIdea, deleteIdea };
