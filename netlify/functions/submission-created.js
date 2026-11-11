// Netlify 폼 제출이 들어오면 자동으로 실행되어 대시보드 저장소에 문의를 쌓는다.
// 1차: 저장소에 직접 저장 / 실패하면 2차: 대시보드 API(ingest)로 전달
const { connectLambda, getStore } = require('@netlify/blobs');
const { leadFromSubmission, saveLeadIfNew } = require('../lib/leads');

async function viaApi(sub) {
  const pw = process.env.ADMIN_PASSWORD || '';
  const hosts = [process.env.DEPLOY_URL, process.env.URL, 'https://lillo-kr.netlify.app'].filter(Boolean);
  let lastErr = null;
  for (const h of hosts) {
    try {
      const res = await fetch(h.replace(/\/$/, '') + '/.netlify/functions/leads-api', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-password': pw },
        body: JSON.stringify({ action: 'ingest', submission: sub }),
      });
      if (res.ok) return true;
      lastErr = new Error('ingest ' + h + ' status ' + res.status);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no host');
}

exports.handler = async (event) => {
  let sub = null;
  try {
    const body = JSON.parse(event.body || '{}');
    sub = body.payload;
    if (!sub || !sub.id) { console.error('submission-created: no payload', event.body && event.body.slice(0, 200)); return { statusCode: 400, body: 'no payload' }; }
  } catch (e) {
    console.error('submission-created: bad body', e);
    return { statusCode: 400, body: 'bad body' };
  }
  try {
    connectLambda(event);
    await saveLeadIfNew(getStore('lilo-leads'), leadFromSubmission(sub));
    console.log('submission-created: saved directly', sub.id);
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('submission-created: direct save failed, trying api', e && e.message);
  }
  try {
    await viaApi(sub);
    console.log('submission-created: saved via api', sub.id);
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('submission-created: api fallback failed', e && e.message);
    return { statusCode: 500, body: 'error' };
  }
};
