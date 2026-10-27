# Caiet de poezii (Cloudflare Workers)

```
caiet-worker/
  public/index.html     site-ul
  src/worker.js         salvarea poeziilor (/api/poems)
  wrangler.toml         configurare
```

## Pași

1. În Cloudflare: Storage & Databases, apoi KV, apoi Create. Numește-l `poezii`.
   Copiază `ID`-ul lui și pune-l în `wrangler.toml`, în locul textului `PUNE_AICI_ID_UL`.
2. Pune fișierele în repository-ul GitHub (înlocuiește tot ce era acolo, șterge folderul `functions`).
3. În Cloudflare, la ecranul „Set up your application", lasă comanda `npx wrangler deploy` și apasă Deploy.
4. După primul deploy: Workers & Pages, apoi `caiet-de-poezii`, apoi Settings, apoi Variables and Secrets, apoi Add.
   Tip: Secret. Nume: `ADMIN_PASSWORD`. Valoare: parola ta. Salvează și apasă Deploy.

## Folosire

Jos, în dreapta paginii, apeși „Administrator" și scrii parola. Apoi poți adăuga, edita și șterge poezii.
