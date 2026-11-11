// 고객용 스튜디오: 계정·이용 기간·글 보관·발행 기록 로직 (저장소는 주입받아서 테스트 가능)
const crypto = require('crypto');
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const LOGIN_RE = /^[a-z0-9][a-z0-9_-]{3,23}$/;
const DEFAULT_QUOTA = 12;
const TOKEN_DAYS = 14;
const LOCK_FAILS = 8;
const LOCK_MIN = 15;

function cleanStr(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

/* ---------- 비밀번호·토큰 ---------- */
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  const a = Buffer.from(crypto.scryptSync(String(pw), salt, 32).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) out += chars[bytes[i] % chars.length];
  return out;
}
function secretKey() {
  const base = process.env.ADMIN_PASSWORD || '';
  if (!base) throw new Error('서버 비밀번호가 설정되지 않았어요.');
  return crypto.createHash('sha256').update('studio:' + base).digest();
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
  return body + '.' + sig;
}
function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp && p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

/* ---------- 이용 기간 ---------- */
function accessInfo(lead) {
  const t = kstToday();
  const start = lead.contractStart || '', end = lead.contractEnd || '';
  if (!end) return { state: 'no_term', daysLeft: null, start, end };
  const dl = Math.round((new Date(end + 'T00:00:00Z') - new Date(t + 'T00:00:00Z')) / 86400000);
  if (start && t < start) return { state: 'not_started', daysLeft: dl, start, end };
  if (t > end) return { state: 'expired', daysLeft: dl, start, end };
  return { state: 'active', daysLeft: dl, start, end };
}

/* ---------- 고객 계정 (관리자가 발급) ---------- */
async function getCustomer(store, loginId) {
  return store.get('customer:' + loginId, { type: 'json' });
}
async function createCustomer(store, lead, loginId, by) {
  const id = cleanStr(loginId, 24).toLowerCase();
  if (!LOGIN_RE.test(id)) throw new Error('아이디는 영문 소문자·숫자·-_ 4~24자로 적어주세요.');
  if (lead.studioLoginId) throw new Error('이미 계정이 있어요. 비밀번호 재발급을 사용해 주세요.');
  if (await getCustomer(store, id)) throw new Error('이미 사용 중인 아이디예요.');
  const password = genPassword();
  const h = hashPassword(password);
  await store.setJSON('customer:' + id, { loginId: id, leadId: lead.id, salt: h.salt, hash: h.hash, createdAt: new Date().toISOString(), createdBy: by, disabled: false, failCount: 0, lockUntil: 0 });
  return { loginId: id, password };
}
async function resetCustomer(store, loginId) {
  const c = await getCustomer(store, loginId);
  if (!c) throw new Error('고객 계정을 찾지 못했어요.');
  const password = genPassword();
  const h = hashPassword(password);
  Object.assign(c, { salt: h.salt, hash: h.hash, failCount: 0, lockUntil: 0 });
  await store.setJSON('customer:' + loginId, c);
  return { loginId, password };
}
async function setCustomerDisabled(store, loginId, disabled) {
  const c = await getCustomer(store, loginId);
  if (!c) throw new Error('고객 계정을 찾지 못했어요.');
  c.disabled = !!disabled;
  await store.setJSON('customer:' + loginId, c);
  return c;
}
async function removeCustomer(store, loginId) { await store.delete('customer:' + loginId); }

async function login(store, loginId, password) {
  const id = cleanStr(loginId, 24).toLowerCase();
  const c = id ? await getCustomer(store, id) : null;
  const bad = new Error('아이디 또는 비밀번호가 맞지 않아요.');
  if (!c) throw bad;
  if (c.lockUntil && c.lockUntil > Date.now()) throw new Error('로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.');
  if (c.disabled) throw new Error('사용이 중지된 계정이에요. 담당자에게 문의해 주세요.');
  if (!verifyPassword(password, c.salt, c.hash)) {
    c.failCount = (c.failCount || 0) + 1;
    if (c.failCount >= LOCK_FAILS) { c.lockUntil = Date.now() + LOCK_MIN * 60000; c.failCount = 0; }
    await store.setJSON('customer:' + id, c);
    throw bad;
  }
  c.failCount = 0; c.lockUntil = 0; c.lastLoginAt = new Date().toISOString();
  await store.setJSON('customer:' + id, c);
  return { token: signToken({ l: id, lid: c.leadId, exp: Date.now() + TOKEN_DAYS * 86400000 }), loginId: id };
}
async function authenticate(store, token) {
  const p = readToken(token);
  if (!p) return null;
  const c = await getCustomer(store, p.l);
  if (!c || c.disabled || c.leadId !== p.lid) return null;
  return c;
}
async function changePassword(store, c, oldPw, newPw) {
  if (!verifyPassword(oldPw, c.salt, c.hash)) throw new Error('현재 비밀번호가 맞지 않아요.');
  const n = String(newPw || '');
  if (n.length < 8 || n.length > 64) throw new Error('새 비밀번호는 8자 이상으로 적어주세요.');
  const h = hashPassword(n);
  c.salt = h.salt; c.hash = h.hash;
  await store.setJSON('customer:' + c.loginId, c);
}

/* ---------- 글 보관·발행 기록 ---------- */
async function listPosts(store, leadId) {
  const { blobs } = await store.list({ prefix: 'post:' + leadId + ':' });
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return all.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
function monthOf(iso) { return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7); }
function usedThisMonth(posts) { const m = kstToday().slice(0, 7); return posts.filter((p) => monthOf(p.createdAt) === m).length; }
function quotaOf(lead) { const q = Number(lead.studioQuota); return Number.isFinite(q) && q >= 0 ? q : DEFAULT_QUOTA; }

function cleanKeywords(k) {
  return (Array.isArray(k) ? k : []).map((x) => cleanStr(x, 40)).filter(Boolean).slice(0, 10);
}
async function createPost(store, lead, input) {
  const title = cleanStr(input.title, 150), body = cleanStr(input.body, 20000);
  if (title.length < 2) throw new Error('제목을 2글자 이상 적어주세요.');
  if (body.length < 10) throw new Error('본문을 10글자 이상 적어주세요.');
  const posts = await listPosts(store, lead.id);
  const q = quotaOf(lead);
  if (usedThisMonth(posts) >= q) throw new Error('이번 달 사용 가능한 글 수(' + q + '편)를 모두 사용했어요.');
  const now = new Date().toISOString();
  const id = now.replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  const post = { id, leadId: lead.id, createdAt: now, updatedAt: now, title, body, keywords: cleanKeywords(input.keywords), source: cleanStr(input.source, 20) || '직접 작성', status: '초안', publishedUrl: '', publishedAt: '' };
  await store.setJSON('post:' + lead.id + ':' + id, post);
  await refreshStats(store, lead.id);
  return post;
}
async function getPost(store, leadId, id) {
  const p = await store.get('post:' + leadId + ':' + cleanStr(id, 60), { type: 'json' });
  if (!p) throw new Error('글을 찾지 못했어요.');
  return p;
}
async function updatePost(store, leadId, id, fields) {
  const p = await getPost(store, leadId, id);
  if ('title' in fields) { const t = cleanStr(fields.title, 150); if (t.length < 2) throw new Error('제목을 2글자 이상 적어주세요.'); p.title = t; }
  if ('body' in fields) { const b = cleanStr(fields.body, 20000); if (b.length < 10) throw new Error('본문을 10글자 이상 적어주세요.'); p.body = b; }
  if ('keywords' in fields) p.keywords = cleanKeywords(fields.keywords);
  p.updatedAt = new Date().toISOString();
  await store.setJSON('post:' + leadId + ':' + p.id, p);
  await refreshStats(store, leadId);
  return p;
}
function validBlogUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && (/(^|\.)naver\.com$/.test(x.hostname) || /(^|\.)blog\.me$/.test(x.hostname));
  } catch (e) { return false; }
}
async function markPublished(store, leadId, id, url) {
  const u = cleanStr(url, 400);
  if (!validBlogUrl(u)) throw new Error('네이버 블로그 글 주소(https://blog.naver.com/...)를 붙여넣어 주세요.');
  const p = await getPost(store, leadId, id);
  p.status = '발행 완료'; p.publishedUrl = u; p.publishedAt = new Date().toISOString(); p.updatedAt = p.publishedAt;
  await store.setJSON('post:' + leadId + ':' + p.id, p);
  await refreshStats(store, leadId);
  return p;
}
async function unpublish(store, leadId, id) {
  const p = await getPost(store, leadId, id);
  p.status = '초안'; p.publishedUrl = ''; p.publishedAt = ''; p.updatedAt = new Date().toISOString();
  await store.setJSON('post:' + leadId + ':' + p.id, p);
  await refreshStats(store, leadId);
  return p;
}
async function deletePost(store, leadId, id) {
  const p = await getPost(store, leadId, id);
  if (p.status === '발행 완료') throw new Error('발행 완료로 기록된 글은 삭제할 수 없어요. 먼저 발행 기록을 취소해 주세요.');
  await store.delete('post:' + leadId + ':' + p.id);
  await refreshStats(store, leadId);
}
// 관리자 화면용: 업체별 요약. 글이 바뀔 때마다 그 업체 것만 다시 계산해 'stats:<업체>' 에 저장해 두고,
// 관리자 화면은 이 작은 요약만 읽어요(모든 글을 매번 읽지 않아요).
async function refreshStats(store, leadId) {
  const posts = await listPosts(store, leadId);
  const s = { total: posts.length, published: 0, lastPublishedAt: '', months: {}, recent: [] };
  for (const p of posts) {
    const m = monthOf(p.createdAt); s.months[m] = (s.months[m] || 0) + 1;
    if (p.status === '발행 완료') { s.published++; if (p.publishedAt > s.lastPublishedAt) s.lastPublishedAt = p.publishedAt; s.recent.push({ title: p.title, url: p.publishedUrl, at: p.publishedAt }); }
  }
  s.recent = s.recent.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
  if (!posts.length) await store.delete('stats:' + leadId); else await store.setJSON('stats:' + leadId, s);
  return s;
}
async function statsByLead(store) {
  const { blobs } = await store.list({ prefix: 'stats:' });
  const mk = kstToday().slice(0, 7), out = {};
  await Promise.all(blobs.map(async (b) => {
    const s = await store.get(b.key, { type: 'json' });
    if (!s) return;
    out[b.key.slice(6)] = { total: s.total, published: s.published, lastPublishedAt: s.lastPublishedAt, month: (s.months || {})[mk] || 0, recent: s.recent || [] };
  }));
  return out;
}

module.exports = { LOGIN_RE, DEFAULT_QUOTA, kstToday, accessInfo, createCustomer, resetCustomer, setCustomerDisabled, removeCustomer, getCustomer, login, authenticate, changePassword, listPosts, usedThisMonth, quotaOf, createPost, getPost, updatePost, markPublished, unpublish, deletePost, statsByLead, refreshStats, validBlogUrl, readToken, signToken };
