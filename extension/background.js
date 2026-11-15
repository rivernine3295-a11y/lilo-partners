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
  await sleep(2500);
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
    var findInp = function () { return Array.prototype.slice.call(document.querySelectorAll('input')).filter(vis).filter(function (e) { return /플레이스/.test(e.placeholder || ''); })[0]; };
    var inp = findInp();
    for (var w0 = 0; w0 < 40 && !inp; w0++) { await sleep(500); inp = findInp(); }
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
  function readBlock(k, allKeys) {
    var root = document.querySelector('main') || document.body;
    var t = root.innerText || '';
    var i = t.indexOf('조회 결과');
    if (i < 0) return null;
    var lines = t.slice(i).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var key = String(k).replace(/\s/g, '');
    var keys = (allKeys || []).map(function (x) { return String(x).replace(/\s/g, ''); });
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].replace(/\s/g, '') !== key) continue;
      var end = Math.min(lines.length, j + 14);
      for (var q = j + 1; q < end; q++) { if (keys.indexOf(lines[q].replace(/\s/g, '')) >= 0) { end = q; break; } }
      var chunk = lines.slice(j + 1, end);
      var joined = chunk.join('\n');
      var head = chunk.slice(0, 4).join(' ');
      var tm = joined.match(/([\d,]+)\s*개\s*업체\s*중/);
      var rm = null;
      if (/밖|미노출|없음/.test(head)) rm = 301;
      else { var m1 = head.match(/^([\d,]+)\s*위/); if (m1) rm = num(m1[1]); }
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
    var findTa = function () { return Array.prototype.slice.call(document.querySelectorAll('textarea')).filter(vis)[0]; };
    var ta = findTa();
    for (var w3 = 0; w3 < 20 && !ta; w3++) { await sleep(500); ta = findTa(); }
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
      if (h && Number(h[1]) >= Number(h[2]) && Number(h[2]) >= 1) {
        res = list.map(function (k) { var r = readBlock(k, list); return r ? { k: k, rank: r.rank, total: r.total } : { k: k, rank: null, total: null }; });
        break;
      }
      await sleep(1000);
    }
    if (!res) return { error: 'noresult', text: txt().slice(0, 1200) };
    var raw = '';
    if (res.some(function (x) { return x.rank == null; })) { var tt = txt(), ii = tt.indexOf('조회 결과'); raw = tt.slice(ii < 0 ? 0 : ii, (ii < 0 ? 0 : ii) + 1500); }
    if (op === 'rank') return { rank: res[0].rank, total: res[0].total, store: p.name, raw: raw };
    return { results: res, store: p.name, raw: raw };
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


// ───────── PostSync(무료) 순위 읽기 ─────────
function psRun(store) {
  function num(t) { var m = String(t || '').replace(/,/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : null; }
  function nk(t) { return String(t || '').replace(/\s|[()\[\]·\-_.]/g, '').toLowerCase(); }
  var rows = [];
  Array.prototype.slice.call(document.querySelectorAll('table tr')).forEach(function (tr) {
    var c = Array.prototype.slice.call(tr.querySelectorAll('td')).map(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim(); });
    if (c.length < 4 || !/^\d{1,2}$/.test(c[0])) return;
    var raw = c[1] || '';
    rows.push({ rank: parseInt(c[0], 10), name: raw.split(/\s*스마트플레이스/)[0].replace(/\s*내 매장$/, '').trim(), mine: /내 매장\s*$/.test(raw), vr: num(c[2]), br: num(c[3]), bk: c[4] ? !/미연동/.test(c[4]) && /연동/.test(c[4]) : false });
  });
  var txt = document.body ? document.body.innerText : '';
  var ready = rows.length >= 1 && /검색량|경쟁도/.test(txt) && /현재 전체|20위 밖|순위권/.test(txt) || (rows.length >= 10 && /경쟁도/.test(txt));
  if (rows.length && store && !rows.some(function (r) { return r.mine; })) {
    var s = nk(store);
    rows.forEach(function (r) { var n = nk(r.name); if (!r.mine && n && s && (n.indexOf(s) >= 0 || s.indexOf(n) >= 0)) r.mine = true; });
    var f = rows.filter(function (r) { return r.mine; })[0]; if (f) rows.forEach(function (r) { r.mine = (r === f); });
  }
  var mine = rows.filter(function (r) { return r.mine; })[0];
  var v = txt.match(/찾은 잠재 고객\s*([\d,]+)\s*회/), cp = txt.match(/경쟁도\s*[:：]\s*(\S+)/), it = txt.match(/현재\s*([\d,]+)\s*자/);
  var ov = txt.match(/현재 전체\s*(\d+)\s*위/);
  return { ready: ready, rows: rows.slice(0, 20), mine: mine ? mine.rank : (ov ? parseInt(ov[1], 10) : 0), vol: v ? parseInt(v[1].replace(/,/g, ''), 10) : 0, comp: cp ? cp[1] : '', intro: it ? parseInt(it[1].replace(/,/g, ''), 10) : 0 };
}
async function psOne(kw, store) {
  var tab = null;
  try {
    tab = await chrome.tabs.create({ url: 'https://www.postsyncapp.com/place?q=' + encodeURIComponent(kw) + '&target=' + encodeURIComponent(store), active: false });
    var last = null;
    for (var i = 0; i < 28; i++) {
      await sleep(1500);
      try {
        var r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: psRun, args: [store] });
        last = r && r[0] && r[0].result;
        if (last && last.ready) break;
      } catch (e) {}
    }
    if (!last || !last.rows || !last.rows.length) return { k: kw, error: 'norows' };
    last.k = kw;
    return last;
  } catch (e) { return { k: kw, error: String(e && e.message || e) }; }
  finally { try { if (tab) chrome.tabs.remove(tab.id); } catch (e2) {} }
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
  if (msg.type === 'psmulti') {
    var kl = (msg.kws || []).slice(0, 8);
    Promise.race([Promise.all(kl.map(function (k) { return psOne(k, msg.store || ''); })), new Promise(function (res) { setTimeout(function () { res(kl.map(function (k) { return { k: k, error: 'timeout' }; })); }, 70000); })]).then(function (r) { sendResponse({ results: r }); }, function (e) { sendResponse({ error: 'ext', detail: String(e && e.message || e) }); });
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
