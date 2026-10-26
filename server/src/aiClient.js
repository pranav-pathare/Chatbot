// Talks to the internal Python RAG service.
// Timeout: the Python side makes at most 2 model calls x 2 attempts x 25 s, so 120 s covers it.
export function createAiClient({ baseUrl, token = "", timeoutMs = 120000, fetchImpl = fetch }) {
  return async function callAi(route, sid, body) {
    const get = body === "GET";
    const res = await fetchImpl(`${baseUrl}${route}`, {
      method: get ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Session-Id": sid ?? "", "X-Service-Token": token },
      body: get ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(get ? 5000 : timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };
}
