async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export async function sendMessage(message) {
  try {
    const { ok, data } = await post("/api/chat", { message });
    if (ok) return { answer: data.answer, sources: data.sources || [] };
    return { error: data.error || "Something went wrong. Try again." };
  } catch {
    return { error: "Could not reach the server. Check that the app is still running." };
  }
}

export const resetChat = () => post("/api/reset").catch(() => {});

export const getConfig = () =>
  fetch("/api/config").then((r) => r.json()).catch(() => ({ orgName: "Your Company" }));
