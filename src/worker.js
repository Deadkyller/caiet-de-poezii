// Cloudflare Worker: serveste site-ul (folderul public) si API-ul /api/poems.
// Poeziile se salveaza in KV (binding: POEMS), sub cheia "poems".
// Oricine poate adauga, edita si sterge poezii.
// Protectii: limita de ritm per adresa si o copie de siguranta ("poems-backup")
// a starii dinaintea ultimei modificari.

const KEY = "poems";
const BACKUP_KEY = "poems-backup";
const MAX_POEMS = 1000;
const ADD_WAIT_MS = 60 * 1000;   // o poezie noua pe minut
const CHANGE_WAIT_MS = 5 * 1000; // edit/stergere la 5 secunde

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function loadRaw(env) {
  return (await env.POEMS.get(KEY)) || "[]";
}

function parse(raw) {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function clean(body) {
  const title = String(body.title || "").trim().slice(0, 120);
  const author = String(body.author || "").trim().slice(0, 60);
  const date = String(body.date || "").trim().slice(0, 40);
  const text = String(body.text || "").replace(/\r\n/g, "\n").replace(/\s+$/, "").slice(0, 8000);
  if (!title || !text.trim()) return null;
  return { title, author, date, text };
}

// Intoarce true daca adresa a facut deja o actiune de acest fel prea recent.
async function tooSoon(env, request, kind, waitMs) {
  const ip = request.headers.get("cf-connecting-ip") || "anon";
  const key = "rl:" + kind + ":" + ip;
  const last = Number(await env.POEMS.get(key)) || 0;
  if (Date.now() - last < waitMs) return true;
  await env.POEMS.put(key, String(Date.now()), { expirationTtl: 120 });
  return false;
}

async function handleApi(request, env) {
  if (!env.POEMS) return json({ error: "KV lipseste" }, 500);

  if (request.method === "GET") {
    const poems = parse(await loadRaw(env)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return json({ poems });
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "cerere invalida" }, 400); }
    body = body || {};
    if (body.website) return json({ error: "cerere invalida" }, 400); // camp ascuns pentru roboti

    const fields = clean(body);
    if (!fields) return json({ error: "titlu si poezie obligatorii" }, 400);

    const raw = await loadRaw(env);
    const poems = parse(raw);
    let poem;
    if (body.id) {
      poem = poems.find((p) => p.id === body.id);
      if (!poem) return json({ error: "poezia nu exista" }, 404);
      if (await tooSoon(env, request, "change", CHANGE_WAIT_MS)) return json({ error: "prea repede" }, 429);
      Object.assign(poem, fields);
    } else {
      if (poems.length >= MAX_POEMS) return json({ error: "caietul este plin" }, 400);
      if (await tooSoon(env, request, "add", ADD_WAIT_MS)) return json({ error: "prea repede" }, 429);
      poem = { id: crypto.randomUUID().slice(0, 8), ts: Date.now(), ...fields };
      poems.push(poem);
    }
    await env.POEMS.put(BACKUP_KEY, raw);
    await env.POEMS.put(KEY, JSON.stringify(poems));
    return json({ poem });
  }

  if (request.method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    if (await tooSoon(env, request, "change", CHANGE_WAIT_MS)) return json({ error: "prea repede" }, 429);
    const raw = await loadRaw(env);
    const poems = parse(raw);
    await env.POEMS.put(BACKUP_KEY, raw);
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
