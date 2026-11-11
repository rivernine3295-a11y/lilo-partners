// Netlify 폼 제출이 들어오면 자동으로 실행되어 대시보드 저장소에 문의를 쌓는다.
const { connectLambda, getStore } = require('@netlify/blobs');
const { leadFromSubmission, saveLead } = require('../lib/leads');

exports.handler = async (event) => {
  try {
    connectLambda(event);
    const body = JSON.parse(event.body || '{}');
    const sub = body.payload;
    if (!sub || !sub.id) return { statusCode: 400, body: 'no payload' };
    const store = getStore('lilo-leads');
    await saveLead(store, leadFromSubmission(sub));
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('submission-created error', e);
    return { statusCode: 500, body: 'error' };
  }
};
