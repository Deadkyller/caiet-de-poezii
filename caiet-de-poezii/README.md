# Caiet de poezii (Cloudflare Workers)

```
caiet-worker/
  public/index.html     site-ul
  src/worker.js         salvarea poeziilor (/api/poems)
  wrangler.toml         configurare (conține ID-ul KV)
```

## Cum funcționează

Oricine deschide site-ul poate adăuga, edita și șterge poezii. Nu există parolă.

Protecții:
- o poezie nouă pe minut de la aceeași adresă;
- edit și ștergere la câteva secunde distanță;
- serverul păstrează în KV, sub cheia `poems-backup`, o copie a stării de dinainte de ultima modificare.

## Imagini de fundal

La fiecare poezie se poate alege o imagine, iar textul apare peste ea (alb sau negru).
Imaginea se micșorează în browser (maxim 1600 px, JPEG) și se salvează în KV, sub cheile `img:<id>`.
O imagine încărcată dar nefolosită dispare după 24 de ore. La ștergerea unei poezii, imaginea mai rămâne 7 zile.

## Dacă cineva șterge poezii

În Cloudflare: Storage & databases, apoi Workers KV, apoi `poezii`, apoi KV Pairs.
Copiază conținutul cheii `poems-backup` și pune-l în cheia `poems` (Edit).
Se poate reface doar ultima stare, nu mai multe modificări în urmă.

## Publicare

Fișierele sunt în repository-ul GitHub conectat la Cloudflare.
Orice commit nou pornește singur un build și publică site-ul.
