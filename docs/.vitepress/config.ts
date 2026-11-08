import { defineConfig } from 'vitepress';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smaltLight, smaltDark } from '../../brand/themes/vitepress/shiki';
import { smaltworksMenu, smaltworksFooter } from '../../brand/themes/vitepress/smaltworks';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'https://github.com/stenhoor/smaltui';
// Served at stenhoor.github.io/smaltui/. scripts/build.mjs builds the site with this base, and puts the workbench
// (workbench/, the Demo) and the standalone live console (console.html) beside it.
const base = process.env.DOCS_BASE ?? '/smaltui/';

export default defineConfig({
  title: 'smaltui',
  description: 'A query workbench for smaltdb that runs entirely in the browser.',
  base,
  cleanUrls: true,
  lastUpdated: false,
  // brand/ (copies from stenhoor/smalt-brand) is served from the site root: logos/, badges/, tokens/.
  vite: { publicDir: path.resolve(here, '../../brand') },
  // The workbench and the console are deployed beside the site (scripts/build.mjs).
  ignoreDeadLinks: [/workbench\//, /console\.html/],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logos/smaltui/favicon-32.svg` }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=Martian+Mono:wght@400;600&display=swap' }],
    // Links made for the workbench (?env=…, ?db=…, ?sql=…) used to point at the site root: forward them.
    ['script', {}, `if (location.pathname === ${JSON.stringify(base)} && /[?&](env|db|engine|storage|sql)=/.test(location.search)) location.replace(${JSON.stringify(base)} + 'workbench/' + location.search + location.hash);`],
  ],
  markdown: { theme: { light: smaltLight, dark: smaltDark } },
  themeConfig: {
    logo: { light: '/logos/smaltui/lockup.svg', dark: '/logos/smaltui/lockup-on-dark.svg', alt: 'smaltui' },
    siteTitle: false,
    nav: [
      { text: 'Demo', link: '/workbench/?env=envs/demo/env.json', target: '_self' },
      { text: 'Guide', link: '/guide/' },
      smaltworksMenu(),
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/' },
          { text: 'TypeScript tabs (smaltdf)', link: '/guide/typescript' },
          { text: 'Environments', link: '/guide/environments' },
          { text: 'Import and link data', link: '/guide/import' },
          { text: 'Engine and deploy', link: '/guide/engine' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: smaltworksFooter(base, 'badges/'),
  },
});
