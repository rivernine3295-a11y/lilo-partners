// AI 글 생성 (Google Gemini). 환경변수 GEMINI_API_KEY 가 있어야 동작하고, 모델은 GEMINI_MODEL 로 바꿀 수 있어요.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash'; // 기본 모델이 붐빌 때 쓰는 예비 모델(GEMINI_FALLBACK_MODEL 로 바꿀 수 있어요)
const LENGTHS = { '짧게': 1000, '중간': 2000, '길게': 3000 };
const TONES = ['전문적', '친근한', '따뜻한'];

function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max); }
function isReady() { return !!process.env.GEMINI_API_KEY; }

function buildPrompt(lead, input, part) {
  const tone = TONES.includes(input.tone) ? input.tone : '친근한';
  const lenKey = Object.keys(LENGTHS).find((k) => String(input.length || '').startsWith(k)) || '중간';
  const kws = (Array.isArray(input.keywords) ? input.keywords : []).map((k) => clean(k, 40)).filter(Boolean).slice(0, 10);
  const store = clean(lead.storeName, 60), area = clean([lead.region, lead.bizType].filter(Boolean).join(' '), 80);
  const topic = clean(input.topic, 500), extra = clean(input.extra, 300);
  return [
    '당신은 동네 매장의 네이버 블로그를 대신 써주는 한국어 작가입니다.',
    '아래 정보로 네이버 블로그에 올릴 글 한 편을 쓰세요.',
    '',
    '[매장 정보]', '매장명: ' + (store || '(미입력)'), '업종·지역: ' + (area || '(미입력)'),
    '[이번 글 핵심 키워드] ' + (kws.length ? kws.join(', ') : '(없음)'),
    '[주제] ' + topic,
    extra ? '[추가 요구사항] ' + extra : '',
    '[톤] ' + tone, '[분량] 한글 기준 약 ' + (part ? Math.round(LENGTHS[lenKey] / part.total) : LENGTHS[lenKey]) + '자' + (part ? ' (전체 글의 ' + part.total + '분의 1 분량)' : ''),
    part ? '[역할] 이 글은 ' + part.total + '부분으로 나누어 쓰고 있어요. 당신은 ' + part.n + '번째 부분만 쓰세요: ' + part.role + ' 다른 부분의 내용은 반복하지 마세요.' : '',
    '',
    '규칙:',
    '- 핵심 키워드를 제목과 본문에 자연스럽게 넣되, 같은 단어를 억지로 반복하지 마세요.',
    '- 주어진 정보에 없는 가격, 할인, 이벤트, 수상 경력, 후기, 통계는 지어내지 마세요.',
    '- "무조건", "100%", "최고", 치료·효과를 보장하는 표현은 쓰지 마세요.',
    part ? '- 소제목은 1개만 넣고, 문단은 짧게 나누세요.' : '- 소제목을 2~4개 넣고, 문단은 짧게 나누고, 마지막에 방문·예약을 부드럽게 안내하세요.',
    '- 마크다운 기호(#, *, -)는 쓰지 말고 일반 문장과 줄바꿈만 쓰세요.',
    '- 사진이 들어갈 자리는 [사진] 이라고만 표시하세요.',
    '',
    part && part.n > 1 ? '반드시 JSON 으로만 답하세요: {"body":"본문"}' : '반드시 JSON 으로만 답하세요: {"title":"글 제목","body":"본문"}',
  ].filter((x) => x !== '').join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUSY = [429, 500, 502, 503, 504];

// 한 모델에 한 번 요청. 모델 종류에 맞게 '생각 시간'을 최소로 줄여 빠르게 받아요. 설정을 받지 않으면(400) 설정 없이 한 번 더 시도해요.
async function callModel(model, prompt, ctl) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const send = (genCfg) => fetch(url, {
    method: 'POST', signal: ctl.signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: genCfg }),
  });
  const base = { temperature: 0.8, maxOutputTokens: 6000, responseMimeType: 'application/json' };
  const think = /2\.5/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' };
  let res = await send({ ...base, thinkingConfig: think });
  if (res.status === 400) res = await send(base);
  return res;
}

// 길이에 따라 나눠서 동시에 써요(한 번에 길게 쓰면 오래 걸려요). 짧게=1번, 중간=2번, 길게=3번 요청해요.
const ROLES = {
  1: ['도입(독자의 고민에 공감하는 두세 문장)과 첫 번째 소제목: 이 주제에서 손님이 자주 느끼는 고민이나 배경.'],
  2: ['도입(독자의 고민에 공감하는 두세 문장)과 첫 번째 소제목: 고민이나 배경, 그리고 매장에서 할 수 있는 방법을 주어진 정보 범위 안에서 소개.', '두 번째 소제목: 이용할 때 알아두면 좋은 점이나 관리 팁, 그리고 마지막에 방문·예약을 부드럽게 안내하는 마무리.'],
  3: ['도입(독자의 고민에 공감하는 두세 문장)과 첫 번째 소제목: 이 주제에서 손님이 자주 느끼는 고민이나 배경.', '두 번째 소제목: 매장에서 할 수 있는 방법이나 서비스를 주어진 정보 범위 안에서 소개(없는 사실은 지어내지 말 것).', '세 번째 소제목: 이용할 때 알아두면 좋은 점이나 관리 팁, 그리고 마지막에 방문·예약을 부드럽게 안내하는 마무리.'],
};
function partCount(input) { const k = Object.keys(LENGTHS).find((x) => String(input.length || '').startsWith(x)) || '중간'; return k === '짧게' ? 1 : k === '길게' ? 3 : 2; }

async function writePart(models, prompt, ctl, wait) {
  let res = null, lastErr = '';
  outer: for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await callModel(model, prompt, ctl);
      if (res.ok) break outer;
      const raw = (await res.text().catch(() => '')).slice(0, 600);
      console.error('gemini error', model, res.status, raw);
      let msg = ''; try { msg = (JSON.parse(raw).error || {}).message || ''; } catch (e) { msg = raw; }
      lastErr = '(오류 ' + res.status + (msg ? ': ' + String(msg).replace(/\s+/g, ' ').slice(0, 110) : '') + ')';
      if (res.status === 404) break; // 모델 이름이 없다는 뜻이라 예비 모델로 넘어가요
      if (!BUSY.includes(res.status)) break outer; // 키 문제 등은 다시 해도 같아요
      if (res.status === 429 || res.status === 503) break; // 이 모델은 지금 막혔으니 바로 예비 모델로 넘어가요(시간 아끼기)
      if (attempt === 0) await sleep(wait);
    }
  }
  if (!res.ok) {
    if (BUSY.includes(res.status)) throw new Error('지금 AI가 많이 붐벼요. 1~2분 뒤에 다시 시도해 주세요. ' + lastErr);
    throw new Error('AI가 글을 만들지 못했어요. ' + lastErr);
  }
  const data = await res.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts;
  let out; try { out = JSON.parse((text || []).map((p) => p.text || '').join('')); } catch (e) { out = null; }
  if (!out || clean(out.body, 20000).length < 10) throw new Error('AI가 글을 제대로 만들지 못했어요. 다시 시도해 주세요. (응답 형식 오류' + (data.promptFeedback && data.promptFeedback.blockReason ? ': ' + data.promptFeedback.blockReason : (((data.candidates || [])[0] || {}).finishReason ? ': ' + data.candidates[0].finishReason : '')) + ')');
  return { title: clean(out.title, 150), body: clean(out.body, 20000) };
}

// opts.timeoutMs: 전체 제한 시간.
async function generate(lead, input, opts) {
  if (!isReady()) { const e = new Error('AI 글 생성이 아직 연결되지 않았어요. 담당자에게 문의해 주세요.'); e.notReady = true; throw e; }
  if (clean(input.topic, 500).length < 5) throw new Error('주제를 5글자 이상 적어주세요.');
  const models = [process.env.GEMINI_MODEL || DEFAULT_MODEL, process.env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
  const total = partCount(input);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), (opts && opts.timeoutMs) || 24000);
  const wait = (opts && opts.retryWaitMs != null) ? opts.retryWaitMs : 1500;
  let parts;
  try {
    parts = await Promise.all(ROLES[total].map((role, i) => writePart(models, total === 1 ? buildPrompt(lead, input) : buildPrompt(lead, input, { n: i + 1, total, role }), ctl, wait)));
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI 응답이 너무 오래 걸려요. 길이를 "짧게"로 바꿔 다시 시도해 주세요.');
    if (/fetch failed|network|ECONN|ENOTFOUND/i.test(String(e.message))) throw new Error('AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    throw e;
  } finally { clearTimeout(timer); }
  const title = parts[0].title || clean(input.topic, 60);
  const body = parts.map((p) => p.body).join('\n\n');
  if (title.length < 2 || body.length < 10) throw new Error('AI가 글을 제대로 만들지 못했어요. 다시 시도해 주세요. (응답 형식 오류)');
  return { title, body, parts: total };
}

// 관리자 점검용: 키·모델 이름·실제 생성 시간을 한 번에 확인해요. (고객 화면에서는 쓰지 않아요)
async function diagnose() {
  const out = { keySet: isReady(), primary: process.env.GEMINI_MODEL || DEFAULT_MODEL, fallback: process.env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL };
  if (!out.keySet) { out.error = 'GEMINI_API_KEY 환경변수가 서버에 없어요.'; return out; }
  const t0 = Date.now();
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
    out.listStatus = r.status;
    if (r.ok) {
      const names = ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
      out.primaryExists = names.includes(out.primary); out.fallbackExists = names.includes(out.fallback);
      out.flashModels = names.filter((n) => /flash/.test(n) && !/image|tts|live|audio|embedding/.test(n)).slice(0, 12);
    } else { out.listError = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160); }
  } catch (e) { out.listError = e.message; }
  out.listMs = Date.now() - t0;
  const t1 = Date.now();
  try {
    const g = await generate({ storeName: '점검 헤어살롱', region: '서울 강남구', bizType: '미용실' }, { topic: '이번 달 손상모 케어 클리닉 소개', keywords: ['강남 미용실'], tone: '친근한', length: '짧게 (~1,000자)' }, { timeoutMs: 40000, retryWaitMs: 1500 });
    out.genOk = true; out.title = g.title; out.chars = g.body.length;
  } catch (e) { out.genOk = false; out.error = e.message; }
  out.genMs = Date.now() - t1;
  return out;
}

module.exports = { isReady, generate, buildPrompt, diagnose };
