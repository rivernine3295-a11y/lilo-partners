// 진단서 페이지 <-> 확장 프로그램 연결. 페이지가 보낸 요청만 전달한다.
window.addEventListener('message', function (e) {
  var d = e.data;
  if (e.source !== window || !d || d.source !== 'lilo-page') return;
  if (d.type === 'ping') {
    window.postMessage({ source: 'lilo-ext', id: d.id, result: { ok: true } }, '*');
    return;
  }
  if (d.type === 'rank' || d.type === 'place' || d.type === 'recommend') {
    chrome.runtime.sendMessage({ type: d.type, kw: String(d.kw || ''), link: String(d.link || ''), region: String(d.region || '') }, function (res) {
      var err = chrome.runtime.lastError;
      window.postMessage({ source: 'lilo-ext', id: d.id, result: err ? { error: 'ext', detail: err.message } : res }, '*');
    });
  }
});
