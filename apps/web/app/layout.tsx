import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { I18nProvider } from '../src/i18n';
import { AnalyticsProvider } from '../src/analytics/provider';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/noto-serif-sc/700.css';
import '../src/index.css';
import '../src/styles/home/index.css';

export const metadata: Metadata = {
  title: 'OpenPixo',
  description: 'A local coding-agent workbench for independent game developers.',
  icons: {
    icon: '/openpixo-icon.svg',
    apple: '/openpixo-icon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

/**
 * Inline script that runs before React hydrates so the first paint already
 * carries the app's appearance — no flash of unstyled content.
 *
 * `data-theme` is pinned to `light` unconditionally, and deliberately OUTSIDE
 * the try/catch: OpenPixo ships light-only (product removed the theme
 * setting), and a stored `dark` / `system` from the old picker must never reach
 * the document. Every dark CSS rule is gated on the attribute being absent, so
 * a storage read that throws must still leave the attribute stamped.
 * Keep the accent aliases and mix ratios in sync with `accentVars()` in
 * `src/state/appearance.ts`; this script cannot import application modules.
 */
const themeInitScript = `(function(){document.documentElement.setAttribute('data-theme','light');try{var c=JSON.parse(localStorage.getItem('pixo:config')||'{}');var a=typeof c.accentColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(c.accentColor.trim())?c.accentColor.trim().toLowerCase():'#6c4bff';var v=typeof c.configMigrationVersion==='number'?c.configMigrationVersion:0;if((v<3&&(a==='#87ea5c'||a==='#c96442'))||(v<4&&a==='#353535'))a='#6c4bff';var s=document.documentElement.style;var d=a==='#6c4bff';s.setProperty('--accent',d?'var(--violet)':a);s.setProperty('--accent-strong',d?'var(--violet-strong)':'color-mix(in srgb, '+a+' 82%, var(--text-strong))');s.setProperty('--accent-soft',d?'var(--violet-soft)':'color-mix(in srgb, '+a+' 12%, var(--bg-subtle))');s.setProperty('--accent-tint',d?'color-mix(in srgb, var(--violet) 6%, var(--bg-panel))':'color-mix(in srgb, '+a+' 6%, var(--bg-panel))');s.setProperty('--accent-hover',d?'var(--violet-strong)':'color-mix(in srgb, '+a+' 86%, var(--text-strong))');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: intentional theme-init inline script to prevent FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
