# @lesmenuires/web

Front public Next.js (App Router) — tunnel de réservation **L'Adret**, porté depuis les
maquettes Claude Design (`L'Adret - Prototype Desktop.dc.html` + `L'Adret - Prototype.dc.html`).

## Lancer

```bash
npm install
npm run dev      # http://localhost:3000  (→ redirige vers /reserver)
```

Autres scripts : `npm run build` (build standalone, self-host), `npm start`, `npm run typecheck`.

## Structure

- `app/reserver/page.tsx` — point d'entrée du tunnel.
- `components/booking/BookingFunnel.tsx` — bascule **responsive** : layout desktop ≥ 980px,
  wizard mobile en dessous.
- `components/booking/DesktopFunnel.tsx` — écrans `booking → checkout → done` (2 colonnes,
  récap sticky).
- `components/booking/MobileFunnel.tsx` — wizard `home → semaine → options → contrat →
  paiement → done` avec stepper.
- `components/booking/SignaturePad.tsx` — signature électronique au `<canvas>` (souris/tactile).
- `components/booking/data.ts` — semaines, prestations, caution, calcul acompte/solde
  (données figées du prototype, remplacées plus tard par l'API Rust).
- `components/booking/css.ts` — helper qui parse les styles inline du prototype → objets React
  (portage fidèle au pixel).

## Notes de fidélité / écarts assumés

- **Un seul point d'entrée responsive** au lieu de deux pages séparées desktop/mobile.
- Cadre navigateur / iPhone des `.dc.html` retiré (c'était l'habillage de preview) ; l'app
  occupe la vraie fenêtre. Padding haut mobile ramené de 62px (encoche iOS) à 26px.
- Polices chargées via Google Fonts `<link>` (noms `Marcellus` / `Hanken Grotesk` référencés
  tels quels). À terme : auto-hébergement via `next/font` pour supprimer la dépendance externe.
- Données et paiement **mockés** (pas encore branchés sur l'API/Stripe/DocuSeal).
