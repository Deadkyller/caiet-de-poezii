// Cloudflare Worker: serveste site-ul (folderul public) si API-ul /api/poems.
// Poeziile se salveaza in KV (binding: POEMS), sub cheia "poems".
// Parola de administrator vine din secretul ADMIN_PASSWORD.

const KEY = "poems";
const MAX_POEMS = 500;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function isAdmin(request, env) {
  const secret = env.ADMIN_PASSWORD;
  if (!secret) return false;
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

async function load(env) {
  const raw = await env.POEMS.get(KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function clean(body) {
  const title = String(body.title || "").trim().slice(0, 120);
  const date = String(body.date || "").trim().slice(0, 40);
  const text = String(body.text || "").replace(/\r\n/g, "\n").replace(/\s+$/, "").slice(0, 20000);
  if (!title || !text.trim()) return null;
  return { title, date, text };
}

async function handleApi(request, env) {
  if (!env.POEMS) return json({ error: "KV lipseste" }, 500);

  if (request.method === "GET") {
    const poems = (await load(env)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return json({ poems, admin: isAdmin(request, env) });
  }

  if (!isAdmin(request, env)) return json({ error: "parola gresita" }, 401);

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "cerere invalida" }, 400); }
    const fields = clean(body || {});
    if (!fields) return json({ error: "titlu si poezie obligatorii" }, 400);

    const poems = await load(env);
    let poem;
    if (body.id) {
      poem = poems.find((p) => p.id === body.id);
      if (!poem) return json({ error: "poezia nu exista" }, 404);
      Object.assign(poem, fields);
    } else {
      if (poems.length >= MAX_POEMS) return json({ error: "prea multe poezii" }, 400);
      poem = { id: crypto.randomUUID().slice(0, 8), ts: Date.now(), ...fields };
      poems.push(poem);
    }
    await env.POEMS.put(KEY, JSON.stringify(poems));
    return json({ poem });
  }

  if (request.method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    const poems = await load(env);
    await env.POEMS.put(KEY, JSON.stringify(poems.filter((p) => p.id !== id)));
    return json({ ok: true });
  }

  return json({ error: "metoda nepermisa" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/poems") return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
