// Cloudflare Worker: serveste site-ul (folderul public) si API-urile:
//   /api/poems  - lista, adaugare, editare, stergere de poezii
//   /api/image  - incarcare si afisare imagini de fundal (JPEG)
// Totul se salveaza in KV (binding: POEMS).
// Oricine poate adauga, edita si sterge. Protectii: limita de ritm per adresa,
// o copie de siguranta a poeziilor ("poems-backup") si imagini limitate ca marime.

const KEY = "poems";
const BACKUP_KEY = "poems-backup";
const MAX_POEMS = 1000;
const MAX_IMAGE_BYTES = 1500 * 1024;
const ADD_WAIT_MS = 60 * 1000;     // o poezie noua pe minut
const CHANGE_WAIT_MS = 5 * 1000;   // edit/stergere la 5 secunde
const IMAGE_WAIT_MS = 10 * 1000;   // o imagine la 10 secunde
const UPLOAD_TTL = 24 * 60 * 60;   // imaginea neasociata unei poezii dispare dupa 24 de ore
const RETIRE_TTL = 7 * 24 * 60 * 60; // imaginea unei poezii sterse mai ramane 7 zile
const IMAGE_ID = /^[a-f0-9]{16}$/;

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
  const tone = body.tone === "dark" ? "dark" : "light";
  if (!title || !text.trim()) return null;
  return { title, author, date, text, tone };
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

// Imaginea devine permanenta (se scoate expirarea).
async function keepImage(env, id) {
  const buf = await env.POEMS.get("img:" + id, { type: "arrayBuffer" });
  if (!buf) return false;
  await env.POEMS.put("img:" + id, buf);
  return true;
}

// Imaginea nu mai e folosita: ramane 7 zile (ca sa se poata reface din copia de siguranta), apoi dispare.
async function retireImage(env, id) {
  if (!id || !IMAGE_ID.test(id)) return;
  const buf = await env.POEMS.get("img:" + id, { type: "arrayBuffer" });
  if (buf) await env.POEMS.put("img:" + id, buf, { expirationTtl: RETIRE_TTL });
}

async function handlePoems(request, env) {
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
    const wantImage = IMAGE_ID.test(String(body.image || "")) ? String(body.image) : "";

    const raw = await loadRaw(env);
    const poems = parse(raw);
    let poem;
    if (body.id) {
      poem = poems.find((p) => p.id === body.id);
      if (!poem) return json({ error: "poezia nu exista" }, 404);
      if (await tooSoon(env, request, "change", CHANGE_WAIT_MS)) return json({ error: "prea repede" }, 429);
      const oldImage = poem.image || "";
      if (wantImage && wantImage !== oldImage && !(await keepImage(env, wantImage))) {
        return json({ error: "imaginea nu mai exista" }, 400);
      }
      Object.assign(poem, fields);
      poem.image = wantImage;
      if (oldImage && oldImage !== wantImage) await retireImage(env, oldImage);
    } else {
      if (poems.length >= MAX_POEMS) return json({ error: "caietul este plin" }, 400);
      if (await tooSoon(env, request, "add", ADD_WAIT_MS)) return json({ error: "prea repede" }, 429);
      if (wantImage && !(await keepImage(env, wantImage))) return json({ error: "imaginea nu mai exista" }, 400);
      poem = { id: crypto.randomUUID().slice(0, 8), ts: Date.now(), ...fields, image: wantImage };
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
    const gone = poems.find((p) => p.id === id);
    await env.POEMS.put(BACKUP_KEY, raw);
    await env.POEMS.put(KEY, JSON.stringify(poems.filter((p) => p.id !== id)));
    if (gone && gone.image) await retireImage(env, gone.image);
    return json({ ok: true });
  }

  return json({ error: "metoda nepermisa" }, 405);
}

async function handleImage(request, env, ctx) {
  if (request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!IMAGE_ID.test(id)) return new Response("nu exista", { status: 404 });

    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(request.url);
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }
    const buf = await env.POEMS.get("img:" + id, { type: "arrayBuffer" });
    if (!buf) return new Response("nu exista", { status: 404 });
    const res = new Response(buf, {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
    if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  if (request.method === "POST") {
    if (await tooSoon(env, request, "img", IMAGE_WAIT_MS)) return json({ error: "prea repede" }, 429);
    const buf = await request.arrayBuffer();
    if (buf.byteLength < 100 || buf.byteLength > MAX_IMAGE_BYTES) return json({ error: "imagine prea mare" }, 413);
    const b = new Uint8Array(buf, 0, 3);
    if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return json({ error: "doar JPEG" }, 400);
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
    await env.POEMS.put("img:" + id, buf, { expirationTtl: UPLOAD_TTL });
    return json({ id });
  }

  return json({ error: "metoda nepermisa" }, 405);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/poems" || url.pathname === "/api/image") {
      if (!env.POEMS) return json({ error: "KV lipseste" }, 500);
      return url.pathname === "/api/poems" ? handlePoems(request, env) : handleImage(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
