// AI 글 생성. 무료 서비스 여러 곳을 순서대로 시도해요(제미나이 → Groq → OpenRouter 무료 모델).
// 키가 없는 곳은 건너뛰어요. 순서는 환경변수 AI_PROVIDERS 로 바꿀 수 있어요(기본: gemini,groq,openrouter).
// 필요한 환경변수: GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY (하나 이상). 카드나 충전은 필요 없어요.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const LENGTHS = { '짧게': 1000, '중간': 2000, '길게': 3000 };
const TONES = ['전문적', '친근한', '따뜻한'];
const TONE_GUIDE = { '전문적': '믿음 가는 전문가지만 딱딱하지 않게, 쉬운 단어로 설명하듯', '친근한': '단골 손님에게 카페에서 이야기하듯 편하고 가볍게', '따뜻한': '고민을 들어주는 언니·누나처럼 다정하고 공감하며' };

function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max); }
const PROVIDER_KEYS = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
function providers() {
  const order = String(process.env.AI_PROVIDERS || 'gemini,groq,openrouter').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return order.filter((n, i) => PROVIDER_KEYS[n] && order.indexOf(n) === i && process.env[PROVIDER_KEYS[n]]);
}
function isReady() { return providers().length > 0; }

// 이 글(또는 이 부분)에 들어갈 사진 번호 범위 안내. part.photos = [첫 번호, 끝 번호] (전체 글 기준 번호, 1부터)
function photoRule(part) {
  const ph = part && part.photos;
  if (!ph) return '- 사진이 들어갈 자리는 [사진] 이라고만 표시하세요.';
  if (!ph[1]) return '- 이 부분에는 사진을 넣지 않으니 [사진] 표시는 쓰지 마세요.';
  const rng = ph[0] === ph[1] ? '[사진 ' + ph[0] + ']' : '[사진 ' + ph[0] + '] ~ [사진 ' + ph[1] + ']';
  return '- 첨부된 사진은 ' + rng + ' 입니다(첨부 순서대로). 사진을 실제로 보고 사진에 보이는 내용(스타일, 길이, 색감, 분위기 등)에 맞춰 쓰세요. 각 사진 내용을 설명하는 문단 바로 뒤에 [사진 번호] 를 따로 한 줄로 넣고, 사진에 보이지 않는 것은 지어내지 마세요. 사람 얼굴이나 개인을 특정하는 묘사는 하지 마세요.';
}
function buildPrompt(lead, input, part) {
  const tone = TONES.includes(input.tone) ? input.tone : '친근한';
  const lenKey = Object.keys(LENGTHS).find((k) => String(input.length || '').startsWith(k)) || '중간';
  const kws = (Array.isArray(input.keywords) ? input.keywords : []).map((k) => clean(k, 40)).filter(Boolean).slice(0, 10);
  const store = clean(lead.storeName, 60), area = clean([lead.region, lead.bizType].filter(Boolean).join(' '), 80);
  const topic = clean(input.topic, 500), extra = clean(input.extra, 300);
  return [
    '당신은 동네 매장 사장님이 직접 쓴 것처럼 네이버 블로그를 써주는 한국어 블로거입니다. 보고서나 광고 문구가 아니라, 사람이 말하듯 읽히는 글을 씁니다.',
    '아래 정보로 네이버 블로그에 올릴 글 한 편을 쓰세요.',
    '',
    '[매장 정보]', '매장명: ' + (store || '(미입력)'), '업종·지역: ' + (area || '(미입력)'),
    '[이번 글 핵심 키워드] ' + (kws.length ? kws.join(', ') : '(없음)'),
    '[주제] ' + topic,
    extra ? '[추가 요구사항] ' + extra : '',
    '[톤] ' + tone + ' — ' + (TONE_GUIDE[tone] || ''), '[분량] 한글 기준 약 ' + (part && part.total > 1 ? Math.round(LENGTHS[lenKey] / part.total) : LENGTHS[lenKey]) + '자' + (part && part.total > 1 ? ' (전체 글의 ' + part.total + '분의 1 분량)' : ''),
    part && part.role ? '[역할] 이 글은 ' + part.total + '부분으로 나누어 쓰고 있어요. 당신은 ' + part.n + '번째 부분만 쓰세요: ' + part.role + ' 다른 부분의 내용은 반복하지 마세요.' : '',
    '',
    '규칙:',
    '- 핵심 키워드를 제목과 본문에 자연스럽게 넣되, 같은 단어를 억지로 반복하지 마세요.',
    '- 주어진 정보에 없는 가격, 할인, 이벤트, 수상 경력, 후기, 통계는 지어내지 마세요.',
    '- "무조건", "100%", "최고", 치료·효과를 보장하는 표현은 쓰지 마세요.',
    part && part.total > 1 ? '- 소제목은 1개만 넣고, 문단은 짧게 나누세요.' : '- 소제목을 2~4개 넣고, 문단은 짧게 나누고, 마지막에 방문·예약을 부드럽게 안내하세요.',
    '- 문체: "~해요/~이에요" 같은 부드러운 해요체로 쓰세요. "~합니다/~입니다"를 연달아 쓰는 딱딱한 문체, 논문·기사 같은 표현("~에 대한 관심이 이어지고 있습니다", "~를 제공합니다")은 피하세요.',
    '- 한 문장은 짧게(두 줄 안쪽), 한 문단은 2~3문장으로 끊고 문단 사이를 비우세요. 어려운 한자어·영어 단어(structure 같은 외국어 포함)는 쉬운 우리말로 바꾸세요.',
    '- 첫 문장은 손님이 실제로 할 법한 고민이나 질문으로 시작하고(예: "요즘 머리 끝이 푸석해서 고민이시죠?"), 중간에 독자에게 말을 거는 문장을 한두 번 넣으세요. 이모지는 전체에서 2~4개만 자연스럽게 쓰세요.',
    '- "안녕하세요, 테스트입니다" 같은 어색한 인사나 매장명을 매번 반복하는 광고식 표현은 쓰지 마세요. 인사는 짧게 한 번만 하세요.',
    '- 마크다운 기호(#, *, -)는 쓰지 말고 일반 문장과 줄바꿈만 쓰세요.',
    photoRule(part),
    '',
    part && part.n > 1 ? '반드시 JSON 으로만 답하세요: {"body":"본문"}' : '반드시 JSON 으로만 답하세요: {"title":"글 제목","body":"본문"}',
  ].filter((x) => x !== '').join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUSY = [429, 500, 502, 503, 504];
const RETRY_NEXT = [404, 429, 500, 502, 503, 504]; // 이 상태면 같은 곳의 다른 모델 또는 다음 서비스로 넘어가요
const errMsg = (raw) => { let m = ''; try { const j = JSON.parse(raw); m = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { m = raw; } return String(typeof m === 'string' ? m : JSON.stringify(m)).replace(/\s+/g, ' ').slice(0, 90); };

// 모델이 돌려준 글자에서 JSON 을 꺼내요. (JSON 모드를 못 쓰는 모델은 앞뒤에 설명이 붙기도 해요)
function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* 아래에서 다시 시도 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; } }
  return null;
}

/* ---------- 제미나이 ---------- */
// 모델 종류에 맞게 '생각 시간'을 최소로 줄여 빠르게 받아요. 설정을 받지 않으면(400) 설정 없이 한 번 더 시도해요.
async function geminiCall(model, prompt, ctl, photos) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const send = (genCfg) => fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }].concat((photos || []).map((d) => ({ inlineData: { mimeType: 'image/jpeg', data: d.replace(/^data:image\/jpeg;base64,/, '') } }))) }], generationConfig: genCfg }) });
  const base = { temperature: 0.8, maxOutputTokens: 6000, responseMimeType: 'application/json' };
  const think = /2\.5/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' };
  let res = await send({ ...base, thinkingConfig: think });
  if (res.status === 400) res = await send(base);
  return res;
}
let gCache = { at: 0, list: [], p: null };
async function geminiUsable() {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
  if (!r.ok) return [];
  return ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, '')).filter((n) => /flash/.test(n) && !/image|tts|live|audio|embedding|thinking|robotics|computer|preview|exp|-\d{3}$/.test(n));
}
function gRank(n) { const v = (n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]; return (/lite/.test(n) ? 100 : 0) + (Number(v) < 3 ? 50 : 0) - Number(v); }
async function geminiFallbacks(primary) {
  if (process.env.GEMINI_FALLBACK_MODEL) return [process.env.GEMINI_FALLBACK_MODEL];
  if (gCache.list.length && Date.now() - gCache.at < 600000) return gCache.list.filter((n) => n !== primary).slice(0, 3);
  if (!gCache.p) gCache.p = geminiUsable().then((names) => { names.sort((a, b) => gRank(a) - gRank(b)); gCache = { at: Date.now(), list: names, p: null }; return names; }).catch(() => { gCache.p = null; return []; });
  return (await gCache.p).filter((n) => n !== primary).slice(0, 3);
}
async function viaGemini(prompt, ctl, wait, photos) {
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const models = [primary]; const errs = []; let res = null, used = primary;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await geminiCall(model, prompt, ctl, photos);
      if (res.ok) { used = model; break; }
      const raw = (await res.text().catch(() => '')).slice(0, 600); console.error('gemini error', model, res.status, raw);
      errs.push(model + ' (오류 ' + res.status + ': ' + errMsg(raw) + ')');
      if (RETRY_NEXT.includes(res.status) && res.status !== 500 && res.status !== 502 && res.status !== 504) break; // 이 모델은 지금 안 되니 바로 다음으로
      if (!BUSY.includes(res.status)) break;
      if (attempt === 0) await sleep(wait);
    }
    if (res.ok) break;
    if (mi === 0 && RETRY_NEXT.includes(res.status)) (await geminiFallbacks(primary)).forEach((f) => { if (!models.includes(f)) models.push(f); });
    if (!RETRY_NEXT.includes(res.status)) break;
  }
  if (!res.ok) { const e = new Error(errs.join(' → ')); e.busy = BUSY.includes(res.status); throw e; }
  const data = await res.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts;
  const out = parseJson((text || []).map((p) => p.text || '').join(''));
  if (!out || clean(out.body, 20000).length < 10) { const e = new Error('응답 형식 오류' + (data.promptFeedback && data.promptFeedback.blockReason ? ': ' + data.promptFeedback.blockReason : '')); e.busy = false; throw e; }
  return { title: clean(out.title, 150), body: clean(out.body, 20000), model: used };
}

/* ---------- OpenAI 방식으로 호출하는 서비스 (Groq, OpenRouter) ---------- */
const COMPAT = {
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', extra: {},
    usable: (m) => !/whisper|guard|tts|orpheus|embed|safeguard|distil/.test(m.id),
    pref: [/gpt-oss-120b/, /llama-3\.3-70b/, /llama-4/, /qwen/, /gpt-oss-20b/, /llama/] },
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', extra: {},
    // 요금이 0원인 모델만 써요. (유료 모델이 불려서 크레딧이 나가는 일을 막아요)
    usable: (m) => /:free$/.test(m.id) && m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 && !/vision|image|embed|guard/.test(m.id),
    pref: [/gpt-oss-120b/, /llama-3\.3-70b/, /qwen/, /gemma/, /deepseek/, /mistral/, /llama/] },
};
const cCache = {};
async function compatModels(id) {
  const c = COMPAT[id], k = process.env[c.key];
  if (cCache[id] && Date.now() - cCache[id].at < 600000 && cCache[id].list.length) return cCache[id].list;
  const r = await fetch(c.base + '/models', { headers: { authorization: 'Bearer ' + k } });
  if (!r.ok) throw Object.assign(new Error('모델 목록 조회 실패 (오류 ' + r.status + ')'), { busy: BUSY.includes(r.status), status: r.status });
  const all = ((await r.json()).data || []).filter((m) => m && m.id && c.usable(m));
  const score = (m) => { const i = c.pref.findIndex((re) => re.test(m.id)); return i < 0 ? 99 : i; };
  all.sort((a, b) => score(a) - score(b));
  const list = all.map((m) => m.id);
  cCache[id] = { at: Date.now(), list };
  return list;
}
async function viaCompat(id, prompt, ctl) {
  const c = COMPAT[id];
  const forced = process.env[c.modelEnv];
  let models;
  try { models = forced ? [forced] : (await compatModels(id)).slice(0, 3); } catch (e) { throw e; }
  if (!models.length) { const e = new Error('쓸 수 있는 무료 모델을 찾지 못했어요'); e.busy = false; throw e; }
  const errs = []; let lastBusy = false;
  for (const model of models) {
    let res;
    try {
      res = await fetch(c.base + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env[c.key] }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 4000 }) });
    } catch (e) { if (e.name === 'AbortError') throw e; errs.push(model + ' (연결 실패)'); continue; }
    if (!res.ok) { const raw = (await res.text().catch(() => '')).slice(0, 600); console.error(id + ' error', model, res.status, raw); errs.push(model + ' (오류 ' + res.status + ': ' + errMsg(raw) + ')'); lastBusy = BUSY.includes(res.status); if (RETRY_NEXT.includes(res.status) || res.status === 400) continue; break; }
    const data = await res.json();
    const out = parseJson((((data.choices || [])[0] || {}).message || {}).content);
    if (!out || clean(out.body, 20000).length < 10) { errs.push(model + ' (응답 형식 오류)'); continue; }
    return { title: clean(out.title, 150), body: clean(out.body, 20000), model };
  }
  const e = new Error(errs.join(' → ')); e.busy = lastBusy; throw e;
}

// 서비스 하나로 글 조각 하나를 써요.
// 사진을 볼 수 있는 건 제미나이뿐이에요. 다른 서비스로 넘어가면 사진 없이 글만 쓰고 [사진 번호] 자리만 표시해요.
async function runProvider(id, prompt, ctl, wait, photos) {
  if (id === 'gemini') return viaGemini(prompt, ctl, wait, photos);
  const note = photos && photos.length ? '\n\n(참고: 이번에는 사진을 볼 수 없어요. 사진 속 내용은 추측하지 말고, 주제에 맞는 문단 뒤에 위 번호대로 [사진 번호] 자리만 표시하세요.)' : '';
  return viaCompat(id, prompt + note, ctl);
}
const LABEL = { gemini: '제미나이', groq: 'Groq', openrouter: 'OpenRouter' };

// 서비스들을 순서대로 시도해요. 앞에서 성공하면 뒤는 부르지 않아요.
// 서버 함수가 오래 걸리면 중간에 끊기므로, 서비스마다 쓸 수 있는 시간을 나눠서(앞 서비스가 느리면 포기하고 다음으로) 전체 제한 안에 끝내요.
async function writePart(prompt, deadline, wait, photos) {
  const errs = []; let busy = true; const list = providers();
  for (let i = 0; i < list.length; i++) {
    const id = list[i]; const left = deadline - Date.now();
    if (left < 1200) { errs.push(LABEL[id] + ': 시간이 모자라 건너뜀'); continue; }
    const slice = i === list.length - 1 ? left : Math.max(1500, Math.min(left * 0.6, left - 1500));
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), slice);
    try { const r = await runProvider(id, prompt, ctl, wait, photos); r.provider = id; r.sawPhotos = id === 'gemini'; r.hadPhotos = !!(photos && photos.length); return r; }
    catch (e) {
      if (e.name === 'AbortError') { errs.push(LABEL[id] + ': 응답이 느려 중단(' + Math.round(slice / 1000) + '초)'); }
      else { errs.push(LABEL[id] + ': ' + e.message); busy = busy && e.busy !== false; }
    } finally { clearTimeout(t); }
  }
  // 서비스 이름·모델 같은 기술 내용은 고객 화면에 보이지 않게 하고(로그와 관리자 점검에서 확인), 쉬운 안내만 보여줘요.
  console.error('AI 전부 실패:', errs.join(' / '));
  const e = new Error(busy ? '지금 사용량이 많아 글 만들기가 잠시 어려워요. 1~2분 뒤에 다시 시도해 주세요.' : '글을 만들지 못했어요. 잠시 후 다시 시도해 주세요. 계속되면 담당자에게 알려 주세요.');
  e.detail = errs.join(' / '); throw e;
}

// 길이에 따라 나눠서 동시에 써요(한 번에 길게 쓰면 오래 걸려요). 짧게=1번, 중간=2번, 길게=3번 요청해요.
const ROLES = {
  1: ['도입(독자의 고민에 공감하는 두세 문장)과 첫 번째 소제목: 이 주제에서 손님이 자주 느끼는 고민이나 배경.'],
  2: ['도입(독자의 고민에 공감하는 두세 문장)과 첫 번째 소제목: 고민이나 배경, 그리고 매장에서 할 수 있는 방법을 주어진 정보 범위 안에서 소개.', '두 번째 소제목: 이용할 때 알아두면 좋은 점이나 관리 팁, 그리고 마지막에 방문·예약을 부드럽게 안내하는 마무리.'],
  3: ['도입(독자의 고민에 공감하는 두세 문장)과 첫 번째 소제목: 이 주제에서 손님이 자주 느끼는 고민이나 배경.', '두 번째 소제목: 매장에서 할 수 있는 방법이나 서비스를 주어진 정보 범위 안에서 소개(없는 사실은 지어내지 말 것).', '세 번째 소제목: 이용할 때 알아두면 좋은 점이나 관리 팁, 그리고 마지막에 방문·예약을 부드럽게 안내하는 마무리.'],
};
function partCount(input) { const k = Object.keys(LENGTHS).find((x) => String(input.length || '').startsWith(x)) || '중간'; return k === '짧게' ? 1 : k === '길게' ? 3 : 2; }

// opts.timeoutMs: 전체 제한 시간.
async function generate(lead, input, opts) {
  if (!isReady()) { const e = new Error('AI 글 생성이 아직 연결되지 않았어요. 담당자에게 문의해 주세요.'); e.notReady = true; throw e; }
  if (clean(input.topic, 500).length < 5) throw new Error('주제를 5글자 이상 적어주세요.');
  const total = partCount(input);
  const photos = (Array.isArray(input.photos) ? input.photos : []).filter((d) => typeof d === 'string' && /^data:image\/jpeg;base64,/.test(d)).slice(0, 5);
  const deadline = Date.now() + ((opts && opts.timeoutMs) || 9000);
  const wait = (opts && opts.retryWaitMs != null) ? opts.retryWaitMs : 1500;
  let parts;
  try {
    const n = photos.length;
    parts = await Promise.all(ROLES[total].map((role, i) => {
      const a = Math.round(i * n / total), b = Math.round((i + 1) * n / total);
      const part = { n: i + 1, total, role: total === 1 ? '' : role, photos: n ? [a + 1, b] : null };
      if (n && b < a + 1) part.photos = [0, 0];
      return writePart(buildPrompt(lead, input, part), deadline, wait, photos.slice(a, b));
    }));
  } catch (e) {
    if (/fetch failed|network|ECONN|ENOTFOUND/i.test(String(e.message))) throw new Error('지금 연결이 원활하지 않아요. 1~2분 뒤에 다시 시도해 주세요.');
    throw e;
  }
  const title = parts[0].title || clean(input.topic, 60);
  const body = parts.map((p) => p.body).join('\n\n');
  if (title.length < 2 || body.length < 10) throw new Error('글이 제대로 만들어지지 않았어요. 다시 한 번 시도해 주세요.');
  return { title, body, parts: total, provider: parts[0].provider, model: parts[0].model, sawPhotos: photos.length > 0 && parts.every((p) => !p.hadPhotos || p.sawPhotos) };
}

// 관리자 점검용: 연결된 서비스 각각을 짧게 시험해서 상태와 걸린 시간을 알려줘요. (고객 화면에서는 쓰지 않아요)
async function diagnose() {
  const out = { configured: providers(), results: [] };
  if (!out.configured.length) { out.error = 'AI 키(GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY)가 서버에 하나도 없어요.'; return out; }
  const lead = { storeName: '점검 헤어살롱', region: '서울 강남구', bizType: '미용실' };
  const prompt = buildPrompt(lead, { topic: '이번 달 손상모 케어 클리닉 소개', keywords: ['강남 미용실'], tone: '친근한', length: '짧게 (~1,000자)' });
  await Promise.all(out.configured.map(async (id) => {
    const r = { id, label: LABEL[id], ok: false };
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 40000); const t0 = Date.now();
    try {
      if (id === 'gemini') { r.primary = process.env.GEMINI_MODEL || DEFAULT_MODEL; try { const names = await geminiUsable(); r.primaryExists = names.includes(r.primary); r.models = names.slice(0, 8); } catch (e) { /* 목록 실패는 아래 생성 결과로 확인 */ } }
      else { try { r.models = (await compatModels(id)).slice(0, 6); } catch (e) { r.listError = e.message; } }
      const g = await runProvider(id, prompt, ctl, 1500);
      r.ok = true; r.model = g.model; r.title = g.title; r.chars = g.body.length;
    } catch (e) { r.error = e.name === 'AbortError' ? '40초 안에 응답이 없었어요' : e.message; }
    finally { clearTimeout(timer); }
    r.ms = Date.now() - t0; out.results.push(r);
  }));
  out.results.sort((a, b) => out.configured.indexOf(a.id) - out.configured.indexOf(b.id));
  return out;
}

module.exports = { isReady, generate, buildPrompt, diagnose, providers };
