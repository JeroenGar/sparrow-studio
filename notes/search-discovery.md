# Search discovery

Implemented on 2026-09-07. The production canonical URL is `https://sparrowstudio.app/`, consistently used in the HTML canonical tag, Open Graph URL, and sitemap. Open Graph and large-image social-card metadata use the existing Studio screenshot from the upstream README.

The native "About 2D nesting" disclosure is present in the initial HTML outside the React root and collapsed by default. It describes textiles, garment cutting, woodworking, CNC routing, sheet metal, laser/plasma/waterjet layouts, printing and print-and-cut work, signs, packaging, foam, rubber, leather, composites, and research. It explains supported imports and exports, rectangular-strip packing, local processing, and the distinction between nesting outlines and preparing machine or print instructions.

The content is available to visitors without JavaScript and remains accessible after the editor mounts. Its closed summary uses 44 pixels at the bottom of the desktop editor. Opening it reveals a scrollable panel above the summary. No hidden SEO-only content, new rendering framework, or dependency was added.

## Screenshot provenance

- Source: https://github.com/user-attachments/assets/4d84bb67-ff98-4310-82de-5350baa02427
- Local copy: `web/public/sparrow-studio-preview.png`, unchanged PNG, 3680 by 2228 pixels, approximately 1.6 MB.
- The screenshot shows Studio with irregular parts in a checked layout. Metadata includes the actual image dimensions and descriptive alternative text. Social platforms may crop their previews differently.
- The editor does not request the sharing image. Browser tests check this so the image cannot silently add to startup downloads.

## Validation

From `web`:

- `rtk npm run typecheck`: passed.
- `rtk npm test`: 111 tests passed.
- `rtk npx vite build`: passed using existing compiled WASM assets.
- `rtk npx playwright test tests/discovery.spec.ts tests/backlog.spec.ts tests/startup.spec.ts`: 30 tests passed across Chromium, Firefox, and WebKit.

Tests inspect raw HTML, canonical/social URLs, PNG dimensions, robots.txt, and sitemap output. They also exercise native keyboard expansion without JavaScript, desktop/mobile layout, initial collapsed state, and existing startup behavior. Chromium screenshots at 1440 and 390 pixels were visually inspected.

## Publication and indexing

These changes have not been deployed or submitted to Google Search Console. Once published:

1. Fetch the production homepage, robots.txt, sitemap, and sharing image to confirm they are served successfully with the expected content and types.
2. In a verified Search Console property for sparrowstudio.app, inspect the homepage's live URL and rendered content, request indexing, and submit `https://sparrowstudio.app/sitemap.xml`. Account verification may require the domain owner's DNS access. No verification token or account access was supplied for this work.
3. Inspect the social preview in LinkedIn's Post Inspector, without publishing a post, to verify image cropping and refresh its cache.
4. Monitor impressions and queries such as "2D nesting", "online nesting", and "print and cut nesting". Metadata and a sitemap do not guarantee indexing or rankings.

The Studio README now links directly to the live editor. The sibling sparrow checkout has only its existing demo-callout wording changed to "Try 2D nesting with sparrow in your browser"; its unrelated changes were preserved. That README change needs publication separately through the sparrow repository.

References: [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Open Graph protocol](https://ogp.me/), and [Google's policy distinguishing expandable content from hidden-text abuse](https://developers.google.com/search/docs/essentials/spam-policies#hidden-text-and-link-abuse).
