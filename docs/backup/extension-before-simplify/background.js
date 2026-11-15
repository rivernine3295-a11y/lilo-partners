// 엔체커 탭을 찾거나 열고, 그 안에서 순위 조회를 실행한다.
var NC_RANK = 'https://www.nchecker.kr/rank';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function getNcTab() {
  var tabs = await chrome.tabs.query({ url: ['https://www.nchecker.kr/*', 'https://nchecker.kr/*'] });
  var tab = tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: NC_RANK, active: false });
  } else if (!/\/rank/.test(tab.url || '')) {
    tab = await chrome.tabs.update(tab.id, { url: NC_RANK });
  }
  // 로딩 완료까지 대기
  for (var i = 0; i < 40; i++) {
    tab = await chrome.tabs.get(tab.id);
    if (tab.status === 'complete') break;
    await sleep(500);
  }
  await sleep(800);
  return tab;
}

// 엔체커 페이지 안에서 실행되는 함수 (화면 구조를 직접 보지 못해 글자·속성으로 찾는다)
function runInPage(kw, link) {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function vis(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function desc(el) {
    var lab = '';
    if (el.id) { var l = document.querySelector('label[for="' + el.id + '"]'); if (l) lab = l.innerText; }
    return [el.placeholder, el.name, el.id, el.getAttribute('aria-label'), lab].filter(Boolean).join(' ');
  }
  function setVal(el, v) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var RE = /(\d+)\s*개\s*(?:업체)?\s*중\s*(\d+)\s*위/;
  function readResult() {
    var t = document.body.innerText || '';
    var m = t.match(RE);
    if (m) return { total: Number(m[1]), rank: Number(m[2]), raw: m[0] };
    var o = t.match(/(\d+)\s*개\s*(?:업체)?\s*중[^\n]{0,12}밖/) || t.match(/300\s*위\s*밖|순위\s*밖|밖/);
    if (o) { var tt = t.match(/(\d+)\s*개\s*(?:업체)?/); return { total: tt ? Number(tt[1]) : null, rank: 301, raw: o[0] }; }
    return null;
  }
  return (async function () {
    if (/\/login/.test(location.pathname) || document.querySelector('input[type="password"]')) return { error: 'login' };
    var inputs = Array.prototype.slice.call(document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]), textarea')).filter(vis);
    var kwIn = inputs.filter(function (e) { return /키워드|검색어|keyword/i.test(desc(e)); })[0];
    var linkIn = inputs.filter(function (e) { return /플레이스|place|url|링크|업체|상호|주소|ID|아이디/i.test(desc(e)) && e !== kwIn; })[0];
    if (!kwIn && inputs.length) kwIn = inputs[0];
    if (!linkIn && inputs.length > 1) linkIn = inputs.filter(function (e) { return e !== kwIn; })[0];
    var info = {
      inputs: inputs.map(function (e) { return desc(e) || e.type; }),
      buttons: Array.prototype.slice.call(document.querySelectorAll('button')).filter(vis).map(function (b) { return (b.innerText || '').trim(); }).filter(Boolean).slice(0, 20),
      url: location.href
    };
    if (!kwIn) return { error: 'noinput', debug: info, text: (document.body.innerText || '').slice(0, 1500) };
    var before = readResult();
    var beforeRaw = before ? before.raw : '';
    if (linkIn) setVal(linkIn, link);
    setVal(kwIn, kw);
    await sleep(300);
    var btn = Array.prototype.slice.call(document.querySelectorAll('button')).filter(vis).filter(function (b) { return /조회|검색|확인|순위|체크/.test(b.innerText || '') && !b.disabled; })[0];
    if (btn) btn.click();
    else { kwIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); }
    var start = Date.now();
    await sleep(2500);
    while (Date.now() - start < 40000) {
      var r = readResult();
      if (r && (r.raw !== beforeRaw || Date.now() - start > 12000)) return { rank: r.rank, total: r.total, raw: r.raw };
      var t = document.body.innerText || '';
      if (/한도|초과|제한/.test(t) && /(오늘|하루|일일)/.test(t)) return { error: 'limit', debug: info, text: t.slice(0, 800) };
      await sleep(1000);
    }
    return { error: 'noresult', debug: info, text: (document.body.innerText || '').slice(0, 1500) };
  })();
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'rank') return;
  (async function () {
    try {
      var tab = await getNcTab();
      var res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: runInPage, args: [msg.kw, msg.link] });
      sendResponse((res && res[0] && res[0].result) || { error: 'empty' });
    } catch (e) {
      sendResponse({ error: 'ext', detail: String(e && e.message || e) });
    }
  })();
  return true;
});
