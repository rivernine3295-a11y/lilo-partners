// 네이버 검색광고 API(키워드 도구)로 연관 키워드와 월 검색량을 가져와요.
// 필요한 환경변수: NAVER_AD_CUSTOMER_ID, NAVER_AD_API_KEY, NAVER_AD_SECRET
const crypto = require('crypto');

function isReady() { return !!(process.env.NAVER_AD_CUSTOMER_ID && process.env.NAVER_AD_API_KEY && process.env.NAVER_AD_SECRET); }
const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function sign(ts, method, uri) {
  return crypto.createHmac('sha256', String(process.env.NAVER_AD_SECRET).trim()).update(ts + '.' + method + '.' + uri).digest('base64');
}
function count(v) {
  if (typeof v === 'number') return v;
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0; // "< 10" 처럼 나오면 10 미만이라는 뜻이라, 숫자만 읽어 10으로 둬요
}

async function suggest(hintList) {
  if (!isReady()) { const e = new Error('키워드 추천이 아직 연결되지 않았어요. (네이버 검색광고 API 키가 필요해요)'); e.notReady = true; throw e; }
  const hints = (Array.isArray(hintList) ? hintList : []).map((h) => clean(h, 30).replace(/\s+/g, '')).filter(Boolean).slice(0, 5);
  if (!hints.length) throw new Error('찾고 싶은 키워드를 한 개 이상 적어주세요. 예: 역삼미용실');
  const uri = '/keywordstool', ts = String(Date.now());
  const url = 'https://api.searchad.naver.com' + uri + '?hintKeywords=' + encodeURIComponent(hints.join(',')) + '&showDetail=1';
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  let res;
  try {
    res = await fetch(url, { signal: ctl.signal, headers: {
      'X-Timestamp': ts, 'X-API-KEY': String(process.env.NAVER_AD_API_KEY).trim(), 'X-Customer': String(process.env.NAVER_AD_CUSTOMER_ID).trim(), 'X-Signature': sign(ts, 'GET', uri),
    } });
  } catch (e) { throw new Error(e.name === 'AbortError' ? '네이버 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.' : '네이버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  finally { clearTimeout(t); }
  if (!res.ok) {
    const raw = (await res.text().catch(() => '')).slice(0, 300); console.error('naver ad error', res.status, raw);
    let msg = ''; try { const j = JSON.parse(raw); msg = j.title || j.message || ''; } catch (e) { msg = ''; }
    throw new Error('키워드 정보를 가져오지 못했어요. (오류 ' + res.status + (msg ? ': ' + String(msg).slice(0, 80) : '') + ')');
  }
  const data = await res.json();
  return (data.keywordList || []).map((x) => {
    const pc = count(x.monthlyPcQcCnt), mobile = count(x.monthlyMobileQcCnt);
    return { k: clean(x.relKeyword, 60), pc, mobile, total: pc + mobile, comp: clean(x.compIdx, 10) };
  }).filter((x) => x.k).sort((a, b) => b.total - a.total).slice(0, 40);
}

module.exports = { isReady, suggest, sign };
