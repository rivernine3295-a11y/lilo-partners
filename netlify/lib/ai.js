// AI 글 생성 (Google Gemini). 환경변수 GEMINI_API_KEY 가 있어야 동작하고, 모델은 GEMINI_MODEL 로 바꿀 수 있어요.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash'; // 기본 모델이 붐빌 때 쓰는 예비 모델(GEMINI_FALLBACK_MODEL 로 바꿀 수 있어요)
const LENGTHS = { '짧게': 1000, '중간': 2000, '길게': 3000 };
const TONES = ['전문적', '친근한', '따뜻한'];

function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max); }
function isReady() { return !!process.env.GEMINI_API_KEY; }

function buildPrompt(lead, input) {
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
    '[톤] ' + tone, '[분량] 한글 기준 약 ' + LENGTHS[lenKey] + '자',
    '',
    '규칙:',
    '- 핵심 키워드를 제목과 본문에 자연스럽게 넣되, 같은 단어를 억지로 반복하지 마세요.',
    '- 주어진 정보에 없는 가격, 할인, 이벤트, 수상 경력, 후기, 통계는 지어내지 마세요.',
    '- "무조건", "100%", "최고", 치료·효과를 보장하는 표현은 쓰지 마세요.',
    '- 소제목을 2~4개 넣고, 문단은 짧게 나누고, 마지막에 방문·예약을 부드럽게 안내하세요.',
    '- 마크다운 기호(#, *, -)는 쓰지 말고 일반 문장과 줄바꿈만 쓰세요.',
    '- 사진이 들어갈 자리는 [사진] 이라고만 표시하세요.',
    '',
    '반드시 JSON 으로만 답하세요: {"title":"글 제목","body":"본문"}',
  ].filter((x) => x !== '').join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUSY = [429, 500, 502, 503, 504];

// 한 모델에 한 번 요청. 생각 설정을 모델이 받지 않으면(400) 설정 없이 한 번 더 시도해요.
async function callModel(model, prompt, ctl) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const send = (genCfg) => fetch(url, {
    method: 'POST', signal: ctl.signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: genCfg }),
  });
  const base = { temperature: 0.8, maxOutputTokens: 6000, responseMimeType: 'application/json' };
  let res = await send({ ...base, thinkingConfig: { thinkingLevel: 'low' } });
  if (res.status === 400) res = await send(base);
  return res;
}

// opts.timeoutMs: 전체 제한 시간. 붐비면(503 등) 잠깐 쉬고 다시, 그래도 안 되면 예비 모델로 시도해요.
async function generate(lead, input, opts) {
  if (!isReady()) { const e = new Error('AI 글 생성이 아직 연결되지 않았어요. 담당자에게 문의해 주세요.'); e.notReady = true; throw e; }
  if (clean(input.topic, 500).length < 5) throw new Error('주제를 5글자 이상 적어주세요.');
  const models = [process.env.GEMINI_MODEL || DEFAULT_MODEL, process.env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
  const prompt = buildPrompt(lead, input);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), (opts && opts.timeoutMs) || 24000);
  const wait = (opts && opts.retryWaitMs != null) ? opts.retryWaitMs : 2500;
  let res = null, lastErr = '';
  try {
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
        if (attempt === 0) await sleep(wait);
      }
    }
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'AI 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.' : 'AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    if (BUSY.includes(res.status)) throw new Error('지금 AI가 많이 붐벼요. 1~2분 뒤에 다시 시도해 주세요. ' + lastErr);
    throw new Error('AI가 글을 만들지 못했어요. ' + lastErr);
  }
  const data = await res.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts;
  let out;
  try { out = JSON.parse((text || []).map((p) => p.text || '').join('')); } catch (e) { out = null; }
  const title = clean(out && out.title, 150), body = clean(out && out.body, 20000);
  if (title.length < 2 || body.length < 10) throw new Error('AI가 글을 제대로 만들지 못했어요. 다시 시도해 주세요. (응답 형식 오류' + (data.promptFeedback && data.promptFeedback.blockReason ? ': ' + data.promptFeedback.blockReason : (((data.candidates || [])[0] || {}).finishReason ? ': ' + data.candidates[0].finishReason : '')) + ')');
  return { title, body };
}

module.exports = { isReady, generate, buildPrompt };
