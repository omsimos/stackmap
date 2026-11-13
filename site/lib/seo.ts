import type { MetadataRoute } from 'next';
import { DIAGRAM_KINDS } from '@stackmap/core';
import { EXAMPLES, exampleHref } from './catalog';
import { kindHref } from './docs-nav';
import { REPO } from './package';

type Env = Record<string, string | undefined>;

export const SITE_NAME = 'stackmap';
export const DESCRIPTION = 'Interactive system diagrams your coding agent writes, as one offline HTML file.';

// Next merges metadata shallowly: a page that sets openGraph replaces the layout's, and with it the root's
// opengraph-image file, so pages spread this and it names the image (and its alt.txt) again.
export const OPEN_GRAPH = {
  type: 'website' as const,
  siteName: SITE_NAME,
  locale: 'en_US',
  images: [{ url: '/opengraph-image.png', width: 1200, height: 630, alt: 'stackmap: every layer of your stack, on one map. The viewer, open on a Commerce API diagram with a route lit' }],
};

/** Every static page; the sitemap test fails when a page.tsx is added without its route here. */
export const ROUTES = ['/', '/docs', '/docs/viewer', '/docs/cli', '/docs/schema', '/docs/brands', '/examples'] as const;

// Pinned rather than read from VERCEL_PROJECT_PRODUCTION_URL: Vercel reports the project's vercel.app domain there
// even with the custom domain attached, and canonical, OG and sitemap URLs must all name the one real address.
export const SITE_URL = 'https://stackmap.omsimos.com';
export const siteUrl = (): URL => new URL(SITE_URL);

export function robotsFor(env: Env = process.env): MetadataRoute.Robots {
  if (env.VERCEL_ENV !== 'production') return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/' }, sitemap: new URL('/sitemap.xml', siteUrl()).href };
}

export function sitemapFor(base: URL = siteUrl()): MetadataRoute.Sitemap {
  return [...ROUTES, ...DIAGRAM_KINDS.map(kindHref), ...EXAMPLES.map(exampleHref)].map((route) => ({ url: new URL(route, base).href }));
}

export function softwareApplication(base: URL, version: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    description: DESCRIPTION,
    url: base.href,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS, Linux, Windows',
    softwareVersion: version,
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: REPO,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}
