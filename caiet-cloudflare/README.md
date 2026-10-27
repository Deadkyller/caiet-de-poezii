# Caiet de poezii pe Cloudflare Pages

Structura proiectului:

```
caiet-cloudflare/
  public/index.html          site-ul
  functions/api/poems.js     salvarea poeziilor (Cloudflare Function)
  wrangler.toml              configurare
```

## Pași (o singură dată)

Ai nevoie de Node.js instalat. În terminalul din VS Code, în folderul proiectului:

1. Autentificare în Cloudflare:
   `npx wrangler login`

2. Creează spațiul unde se salvează poeziile (KV):
   `npx wrangler kv namespace create POEMS`
   Comanda afișează un `id`. Copiază-l în `wrangler.toml`, în locul textului `PUNE_AICI_ID_UL`.

3. Creează proiectul Pages:
   `npx wrangler pages project create caiet-de-poezii --production-branch main`

4. Pune parola de administrator (o alegi tu, nu o scrie în fișiere):
   `npx wrangler pages secret put ADMIN_PASSWORD --project-name caiet-de-poezii`

5. Publică site-ul:
   `npx wrangler pages deploy public --project-name caiet-de-poezii`

Site-ul apare la `https://caiet-de-poezii.pages.dev`.

## Folosire

Jos, în dreapta paginii, apasă „Administrator" și scrie parola. Apar butoanele „Adaugă poezie", „Editează" și „Șterge". Vizitatorii văd doar poeziile.

## Dacă ceva nu merge

- Dacă la pasul 5 apare o eroare despre KV, verifică ca `id` din `wrangler.toml` să fie cel de la pasul 2.
- După ce schimbi ceva în fișiere, rulează din nou comanda de la pasul 5.
- Dacă ai încărcat folderul `public` prin drag and drop în panoul Cloudflare, salvarea nu va funcționa. Funcțiile se publică doar cu `wrangler` sau prin GitHub.
