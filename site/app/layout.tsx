import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { tokens } from '@stackmap/core';
import { DocsFooter, Footer } from '@/components/site/Footer';
import { FooterFor } from '@/components/site/FooterFor';
import { Nav } from '@/components/site/Nav';
import { DESCRIPTION, OPEN_GRAPH, SITE_NAME, siteUrl } from '@/lib/seo';
import { SETTLED_SCRIPT, THEME_SCRIPT, themeCss } from '@/lib/theme';
import './globals.css';
import './site.css';

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `${SITE_NAME} · Interactive system diagrams your coding agent writes`, template: `%s · ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'hyamero', url: 'https://github.com/hyamero' }],
  openGraph: OPEN_GRAPH,
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: tokens.light.page },
    { media: '(prefers-color-scheme: dark)', color: tokens.dark.page },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The head script sets data-theme from the reader's stored choice before React hydrates. data-scroll-behavior
    // has the router land on a new page at once instead of gliding there (the CSS glide is for moves within a page).
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `${THEME_SCRIPT};${SETTLED_SCRIPT}` }} />
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body>
        <Nav />
        {children}
        <FooterFor full={<Footer />} docs={<DocsFooter />} />
      </body>
    </html>
  );
}
