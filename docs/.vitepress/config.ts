import { defineConfig } from 'vitepress';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smaltLight, smaltDark } from '../../brand/themes/vitepress/shiki';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'https://github.com/stenhoor/smaltui';
const WORKS = 'https://smaltworks.dev';
// Served at stenhoor.github.io/smaltui/. scripts/build.mjs builds the site with this base, and puts the workbench
// (workbench/) and the live console (console.html) beside it.
const base = process.env.DOCS_BASE ?? '/smaltui/';
const badge = (name: string, alt: string, href: string, h = 28) =>
  `<a href="${href}"><img class="sw-light" src="${base}badges/${name}.svg" alt="${alt}" height="${h}"><img class="sw-dark" src="${base}badges/${name}-on-dark.svg" alt="${alt}" height="${h}"></a>`;

export default defineConfig({
  title: 'smaltui',
  description: 'A SQL console for smaltdb that runs entirely in the browser.',
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
      { text: 'Guide', link: '/guide/' },
      { text: 'Workbench', link: '/workbench/?env=envs/demo/env.json', target: '_self' },
      {
        text: 'smaltworks',
        items: [
          { text: 'The family', link: `${WORKS}/` },
          { text: 'smaltdb: the engine', link: 'https://smaltdb.dev' },
          { text: 'smaltql: SQL', link: 'https://stenhoor.github.io/smaltql/' },
          { text: 'smaltdf: dataframes', link: 'https://stenhoor.github.io/smaltdf/' },
          { text: 'smaltbi: reports', link: 'https://stenhoor.github.io/smaltbi/' },
          { text: 'smaltnb: notebooks', link: 'https://stenhoor.github.io/smaltnb/' },
          { text: 'Work in progress', link: `${WORKS}/stability` },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/' },
          { text: 'Environments', link: '/guide/environments' },
          { text: 'Import and link data', link: '/guide/import' },
          { text: 'Engine and deploy', link: '/guide/engine' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: {
      message: [
        badge('powered-by-smaltdb', 'Powered by smaltdb', 'https://smaltdb.dev'),
        badge('powered-by-smaltql', 'Powered by smaltql', 'https://stenhoor.github.io/smaltql/'),
        badge('a-smaltworks-project', 'A smaltworks project', `${WORKS}/`),
      ].join(' '),
      copyright: 'MIT License · Stay smalty.',
    },
  },
});
