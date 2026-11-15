export async function handleGuidance(request, response) {
  const send = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (request.method !== 'POST') return send(405, { error: 'Use POST.' });
  if (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host) {
    return send(403, { error: 'Use the local dashboard.' });
  }
  if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Use JSON.' });
  let input;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) return send(413, { error: 'Question is too long.' });
      chunks.push(Buffer.from(chunk));
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof input?.question !== 'string' || !input.question.trim() || input.question.length > 2000) {
      return send(400, { error: 'Supply a question of up to 2000 characters.' });
    }
  } catch { return send(400, { error: 'Invalid JSON.' }); }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.AETHER_API_KEY) headers.Authorization = 'Bearer ' + process.env.AETHER_API_KEY;
    const upstream = await fetch('http://127.0.0.1:8000/ask', {
      method: 'POST', headers, body: JSON.stringify({ question: input.question.trim() }),
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) return send(503, { error: 'AETHER is unavailable.' });
    const result = await upstream.json();
    if (typeof result.protocol_id !== 'string' || typeof result.matched_protocol !== 'string' ||
        !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1 ||
        !['NOMINAL_GREEN', 'CAUTION_AMBER', 'CRITICAL_RED'].includes(result.severity) ||
        !Array.isArray(result.crew_actions) || !result.crew_actions.length ||
        result.crew_actions.length > 20 || result.crew_actions.some(step => typeof step !== 'string' || !step.trim() || step.length > 2000)) {
      return send(502, { error: 'AETHER returned an invalid procedure.' });
    }
    return send(200, result);
  } catch { return send(503, { error: 'AETHER is unavailable.' }); }
}
