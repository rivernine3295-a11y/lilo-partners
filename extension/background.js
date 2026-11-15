// 릴로 진단서 도우미 — 엔체커 순위 조회, 추천 키워드, 플레이스 읽기
// v0.2.0: 엔체커 실제 화면(2026-11-15 확인) 기준으로 수정
var NC_RANK = 'https://www.nchecker.kr/rank';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function placeIdOf(u) {
  var s = String(u || '');
  var m = s.match(/place\/(\d{5,})/) || s.match(/\/(\d{7,})(?:[/?#]|$)/) || s.match(/^(\d{5,})$/);
  return m ? m[1] : '';
}
// 엔체커에서 확인된 형식(m.place 주소)으로 맞춘다. 번호를 못 찾으면 원래 주소 그대로 쓴다.
function ncLink(u) {
  var id = placeIdOf(u);
  return id ? 'https://m.place.naver.com/place/' + id + '/home' : String(u || '').trim();
}

async function waitComplete(tabId, tries) {
  var tab;
  for (var i = 0; i < (tries || 40); i++) {
    tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') break;
    await sleep(500);
  }
  return tab;
}

async function getNcTab() {
  var tabs = await chrome.tabs.query({ url: ['https://www.nchecker.kr/*', 'https://nchecker.kr/*'] });
  var tab = tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: NC_RANK, active: false });
  } else if (!/\/rank/.test(tab.url || '')) {
    tab = await chrome.tabs.update(tab.id, { url: NC_RANK });
  }
  tab = await waitComplete(tab.id, 40);
  await sleep(1200);
  return tab;
}

// ───────── 엔체커 페이지 안에서 실행되는 함수 (하나로 묶어야 화면 안에서 공통 코드가 함께 실행됨) ─────────
// op: 'recommend' | 'rank' | 'rankmulti'
function ncRun(op, link, kws) {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function vis(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function txt() { return document.body.innerText || ''; }
  function num(s) { return Number(String(s).replace(/,/g, '')); }
  function setVal(el, v) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function btns() { return Array.prototype.slice.call(document.querySelectorAll('button')).filter(vis); }

  // 로그인 확인 → 플레이스 칸 입력 → "확인됨" 대기
  async function prepare() {
    if (/\/login/.test(location.pathname) || document.querySelector('input[type="password"]')) return { error: 'login' };
    var inp = Array.prototype.slice.call(document.querySelectorAll('input')).filter(vis).filter(function (e) { return /플레이스/.test(e.placeholder || ''); })[0];
    if (!inp) return { error: 'noinput', text: txt().slice(0, 800) };
    if (!(inp.value === link && /확인됨/.test(txt()))) {
      setVal(inp, link);
      var t0 = Date.now(), ok = false;
      while (Date.now() - t0 < 25000) {
        await sleep(500);
        if (/확인됨/.test(txt())) { ok = true; break; }
        if (/찾을 수 없|확인할 수 없|올바르지|유효하지|존재하지/.test(txt())) return { error: 'place', text: txt().slice(0, 800) };
      }
      if (!ok) return { error: 'place', text: txt().slice(0, 800) };
    }
    var m = txt().match(/✓\s*([^\n]+?)\s*\((\d+)\)\s*확인됨/);
    return { ok: true, name: m ? m[1] : '', id: m ? m[2] : '' };
  }

  // 결과 칸에서 "키워드 / 14 / 위 / … / 1,068개 업체 중" 순서로 읽기 (띄어쓰기 차이는 무시)
  function readBlock(k, storeName) {
    var root = document.querySelector('main') || document.body;
    var t = root.innerText || '';
    var i = t.indexOf('조회 결과');
    if (i < 0) return null;
    var lines = t.slice(i).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var key = String(k).replace(/\s/g, '');
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].replace(/\s/g, '') !== key) continue;
      var chunk = lines.slice(j + 1, j + 12);
      var joined = chunk.join('\n');
      if (storeName && joined.indexOf(storeName) < 0) continue;
      var tm = joined.match(/([\d,]+)\s*개\s*업체\s*중/);
      var rm = /^[\d,]+$/.test(chunk[0] || '') && chunk[1] === '위' ? num(chunk[0]) : null;
      if (rm == null && /밖|미노출|없음/.test(chunk.slice(0, 4).join(' '))) rm = 301;
      if (rm == null && !tm) continue;
      return { rank: rm, total: tm ? num(tm[1]) : null };
    }
    return null;
  }

  function collectCards() {
    var out = [];
    btns().forEach(function (b) {
      var tx = (b.innerText || '').replace(/\s+/g, ' ').trim();
      if (!/^\+?\s*조회$/.test(tx)) return;
      var p = b.parentElement, name = '';
      for (var i = 0; i < 4 && p; i++, p = p.parentElement) {
        var lines = (p.innerText || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (lines.length >= 2 && !/^\+?\s*조회$/.test(lines[0]) && !/추적/.test(lines[0])) { name = lines[0]; break; }
      }
      if (name && out.indexOf(name) < 0) out.push(name);
    });
    return out;
  }

  return (async function () {
    var p = await prepare();
    if (!p.ok) return p;

    if (op === 'recommend') {
      var btn = null;
      for (var w = 0; w < 20 && !btn; w++) {
        btn = btns().filter(function (b) { return /AI\s*추천\s*키워드/.test(b.innerText || '') && !b.disabled; })[0];
        if (!btn) await sleep(500);
      }
      if (!btn) return { keywords: [], note: 'norecommend', store: p.name };
      var cards = collectCards();
      if (!cards.length) {
        btn.click();
        var t1 = Date.now();
        while (Date.now() - t1 < 55000) { await sleep(1000); cards = collectCards(); if (cards.length) break; }
      }
      return { keywords: cards.slice(0, 12), store: p.name };
    }

    // rank / rankmulti
    var list = (op === 'rank' ? [kws] : kws).map(function (x) { return String(x || '').trim(); }).filter(Boolean).slice(0, 5);
    if (!list.length) return { error: 'nokw' };
    var ta = Array.prototype.slice.call(document.querySelectorAll('textarea')).filter(vis)[0];
    if (!ta) return { error: 'noinput', text: txt().slice(0, 800) };
    setVal(ta, list.join('\n'));
    await sleep(500);
    var run = null;
    for (var w2 = 0; w2 < 10 && !run; w2++) {
      run = btns().filter(function (b) { return /^순위 조회(\s*\(\d+개\))?$/.test((b.innerText || '').trim()) && !b.disabled; })[0];
      if (!run) await sleep(500);
    }
    if (!run) return { error: 'nobutton', buttons: btns().map(function (b) { return (b.innerText || '').trim(); }).slice(0, 20) };
    run.click();
    var start = Date.now();
    await sleep(3000);
    var res = null;
    while (Date.now() - start < 110000) {
      var t = txt();
      if (/한도|초과|제한/.test(t) && /(오늘|하루|일일)/.test(t) && !/조회 결과/.test(t)) return { error: 'limit', text: t.slice(0, 800) };
      var h = t.match(/조회 결과\s*(\d+)\s*\/\s*(\d+)/);
      if (h && Number(h[1]) >= list.length && Number(h[2]) === list.length) {
        res = list.map(function (k) { var r = readBlock(k, p.name); return r ? { k: k, rank: r.rank, total: r.total } : { k: k, rank: null, total: null }; });
        break;
      }
      await sleep(1000);
    }
    if (!res) return { error: 'noresult', text: txt().slice(0, 1200) };
    if (op === 'rank') return { rank: res[0].rank, total: res[0].total, store: p.name };
    return { results: res, store: p.name };
  })();
}

// ───────── 플레이스 화면 읽기 (v0.2.0은 기본 정보만. 점검 항목은 진단 결과를 보고 확정 예정) ─────────
function readPlace() {
  var t = document.body.innerText || '';
  var og = document.querySelector('meta[property="og:title"]');
  var name = (og && og.content) || document.title || '';
  name = name.replace(/\s*[:\-|·]\s*네이버.*$/, '').replace(/\s*-\s*네이버.*$/, '').trim();
  var addr = '';
  var m = t.match(/(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)[^\n]{3,40}/);
  if (m) addr = m[0].trim();
  var biz = /네일|젤|패디/.test(name + t.slice(0, 600)) ? '네일샵' : (/에스테틱|피부관리|왁싱|속눈썹|마사지/.test(name + t.slice(0, 600)) ? '에스테틱' : '미용실');
  var booking = t.indexOf('예약') >= 0 ? false : true;
  return { name: name, addr: addr, biz: biz, booking: booking, loaded: t.length > 200, url: location.href };
}

async function openTab(url) {
  var tab = await chrome.tabs.create({ url: url, active: false });
  await waitComplete(tab.id, 40);
  await sleep(2500);
  return tab;
}

// 진단용: 플레이스 화면의 탭 목록과 글자를 모아 돌려준다 (점검 항목 읽기 방식을 정확히 맞추기 위한 자료)
function dumpInPage(id) {
  var links = [];
  Array.prototype.slice.call(document.querySelectorAll('a[href]')).forEach(function (a) {
    var h = a.getAttribute('href') || '';
    var tx = (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (h.indexOf('/' + id) >= 0 || a.getAttribute('role') === 'tab') links.push({ t: tx, h: h.slice(0, 140) });
  });
  return { url: location.href, title: document.title, text: (document.body.innerText || '').slice(0, 3500), links: links.slice(0, 40) };
}
async function dumpPlace(link) {
  var id = placeIdOf(link);
  if (!id) return { error: 'noid' };
  var out = { id: id, pages: [] };
  async function grab(url, label) {
    var tab = null;
    try {
      tab = await openTab(url);
      var res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: dumpInPage, args: [id] });
      var r = (res && res[0] && res[0].result) || {};
      r.label = label;
      out.pages.push(r);
      return r;
    } catch (e) {
      out.pages.push({ label: label, error: String(e && e.message || e) });
      return null;
    } finally { try { if (tab) chrome.tabs.remove(tab.id); } catch (e2) {} }
  }
  var home = await grab('https://m.place.naver.com/place/' + id + '/home', 'home');
  var urls = [];
  if (home && home.links) {
    home.links.forEach(function (l) {
      if (/^(소식|메뉴|가격|사진|리뷰|예약|정보|홈)/.test(l.t) && l.t.indexOf('홈') !== 0) {
        try { var u = new URL(l.h, 'https://m.place.naver.com').href; if (urls.indexOf(u) < 0) urls.push({ u: u, t: l.t }); } catch (e) {}
      }
    });
  }
  var seen = {};
  urls = urls.filter(function (x) { if (seen[x.u]) return false; seen[x.u] = 1; return true; });
  if (!urls.length) {
    ['feed', 'menu', 'price', 'photo', 'review', 'information'].forEach(function (p) { urls.push({ u: 'https://m.place.naver.com/place/' + id + '/' + p, t: p }); });
  }
  for (var i = 0; i < Math.min(urls.length, 6); i++) { await grab(urls[i].u, urls[i].t); }
  return out;
}

// ───────── 페이지(진단서)에서 온 요청 처리 ─────────
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;
  if (msg.type === 'place') {
    (async function () {
      var tab = null;
      try {
        tab = await openTab(ncLink(msg.link));
        var res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPlace });
        sendResponse((res && res[0] && res[0].result) || { error: 'empty' });
      } catch (e) { sendResponse({ error: 'ext', detail: String(e && e.message || e) }); }
      try { if (tab) chrome.tabs.remove(tab.id); } catch (e2) {}
    })();
    return true;
  }
  if (msg.type === 'placedump') {
    dumpPlace(msg.link).then(sendResponse, function (e) { sendResponse({ error: 'ext', detail: String(e && e.message || e) }); });
    return true;
  }
  if (msg.type === 'recommend') {
    (async function () {
      try {
        var tab = await getNcTab();
        var res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ncRun, args: ['recommend', ncLink(msg.link), null] });
        sendResponse((res && res[0] && res[0].result) || { keywords: [] });
      } catch (e) { sendResponse({ error: 'ext', detail: String(e && e.message || e) }); }
    })();
    return true;
  }
  if (msg.type !== 'rank' && msg.type !== 'rankmulti') return;
  (async function () {
    try {
      var tab = await getNcTab();
      var res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ncRun, args: [msg.type === 'rankmulti' ? 'rankmulti' : 'rank', ncLink(msg.link), msg.type === 'rankmulti' ? msg.kws : msg.kw] });
      sendResponse((res && res[0] && res[0].result) || { error: 'empty' });
    } catch (e) {
      sendResponse({ error: 'ext', detail: String(e && e.message || e) });
    }
  })();
  return true;
});
