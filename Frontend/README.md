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

Mascot sprites, the brand thumbnail, and the favicon are served from `assets/`.
Fonts load from Google Fonts. JavaScript uses GitHub's public Releases API for
installer links and the download count.

## Search visibility and hosting

Publish **this `Frontend/` folder** as the public website root. The repository's
root `npm run build` creates the Tauri desktop interface, not this landing page.
This site needs no build command. Keep `robots.txt` at the domain root.
For Vercel, set the project Root Directory to `Frontend`, Framework Preset to
Other, and serve this directory without a build step. The included `vercel.json`
permanently redirects `/index.html` to `/`; it does not add a catch-all rewrite,
so unknown URLs continue to return 404.

The page includes descriptive search metadata, Open Graph and Twitter card
metadata, and `SoftwareApplication` JSON-LD matching the visible product details.
Product text, FAQs, and download links are in the original HTML and work without
JavaScript. No reviews or ratings are claimed in structured data.

The canonical homepage is `https://chotoyou.tanvirahmodrafi.com/`. The canonical
link, `og:url`, social image URLs, structured data, and sitemap use this domain.
`robots.txt` allows crawling and points to the absolute sitemap URL. The sitemap
contains only the homepage; section anchors such as `#faq` belong to that page.
If the domain changes, update these URLs together. Social cards use the bundled
256×256 app icon with a square Twitter summary card.

After deploying:

- Check that `/`, `/robots.txt`, `/sitemap.xml`, and the social image return HTTP
  200 without authentication; missing paths should return HTTP 404.
- Redirect alternate domains and `/index.html` to the canonical homepage.
- Check that the host does not add an `X-Robots-Tag: noindex` response header.
- Verify the domain in Google Search Console, submit the sitemap, and inspect
  the homepage URL. Validate JSON-LD with Google's Rich Results Test and check
  social previews. Metadata and sitemaps do not guarantee indexing or rankings.

References: [Google's developer SEO guide](https://developers.google.com/search/docs/fundamentals/get-started-developers)
and [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

The macOS and Windows installers are **unsigned**, and operating systems may warn on the first launch. Include detailed installation guidance in documentation if desired.

If the GitHub API is blocked, download buttons still go to the official latest
release page and the download count stays hidden.

## Inspiration

Inspired by the playful demo interactions of Desktamer, the platform-first calls to action of Chibis, and the daily-life narrative of Furever Dock. Design, copy, layout, and implementation are original to this Choto You concept.
