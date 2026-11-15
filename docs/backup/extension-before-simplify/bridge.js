// 진단서 페이지 <-> 확장 프로그램 연결. 페이지가 보낸 요청만 전달한다.
window.addEventListener('message', function (e) {
  var d = e.data;
  if (e.source !== window || !d || d.source !== 'lilo-page') return;
  if (d.type === 'ping') {
    window.postMessage({ source: 'lilo-ext', id: d.id, result: { ok: true } }, '*');
    return;
  }
  if (d.type === 'rank') {
    chrome.runtime.sendMessage({ type: 'rank', kw: String(d.kw || ''), link: String(d.link || '') }, function (res) {
      var err = chrome.runtime.lastError;
      window.postMessage({ source: 'lilo-ext', id: d.id, result: err ? { error: 'ext', detail: err.message } : res }, '*');
    });
  }
});
