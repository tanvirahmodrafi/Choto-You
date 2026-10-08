# Choto You — playful official landing page

A responsive, animated, single-page website built for the Choto You desktop companion.

## Launch

Open `index.html` in a browser or serve this folder from any static host (GitHub Pages, Cloudflare Pages, Netlify, Vercel). No Node dependencies or build step required.

For local development:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## What works

- Separate Windows installer (`.exe`) and macOS installer (`.dmg`) download buttons.
- Looks up the **latest public GitHub release** to find real download asset URLs. Falls back to the official release page when unavailable.
- The real Choto Rafi artwork and animated 8x4 sprite sheet from your public GitHub repository.
- Interactive live playground: wave, run, drink water, nap, celebrate; drag the companion around.
- Responsive mobile layout, reduced-motion support, FAQ, accessible navigation.
- No cookies, analytics, or website backend.

## Notes before launch

The website currently loads the mascot sprites from `raw.githubusercontent.com` and fonts from Google Fonts. If you want the landing page fully self-hosted, copy the following files from your public Choto-You repository into `assets/` and update the URLs in HTML/CSS:

- `docs/images/avatar-sheet.png`
- `docs/images/thumbnail.png`
- `docs/images/app-icon.png`

The macOS and Windows installers are **unsigned**, and operating systems may warn on the first launch. Include detailed installation guidance in documentation if desired.

The only third-party runtime HTTP request in the JavaScript is to GitHub's public Releases API for current installers. If it is blocked, buttons go to the official latest release page.

## Inspiration

Inspired by the playful demo interactions of Desktamer, the platform-first calls to action of Chibis, and the daily-life narrative of Furever Dock. Design, copy, layout, and implementation are original to this Choto You concept.
