import { defineConfig } from 'vitepress';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smaltLight, smaltDark } from '../../brand/themes/vitepress/shiki';
import { smaltworksMenu, smaltworksFooter } from '../../brand/themes/vitepress/smaltworks';
import { playgroundPlugin } from '../../brand/themes/vitepress/playground';
import { agentDocs, packageVersion } from '../../brand/themes/vitepress/agents';

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
  // Markdown for AI agents beside the pages: a twin of each page, /llms.txt and /agents.md (BRAND.md, Documentation,
  // rule 9). The agent guide is the page for agents, then the reference, then the guide's pages on each tab.
  buildEnd: (config) => {
    agentDocs(config, {
      product: 'smaltui',
      version: packageVersion(path.resolve(here, '../../package.json')),
      url: `https://stenhoor.github.io${base}`,
      intro: 'guide/agents.md',
      guide: ['reference/', 'guide/queries', 'guide/typescript', 'guide/cypher', 'guide/import', 'guide/environments', 'guide/databases'],
    });
  },
  vite: {
    // brand/ (copies from stenhoor/smalt-brand) is served from the site root: logos/, badges/, tokens/.
    publicDir: path.resolve(here, '../../brand'),
    // The playgrounds load the site's own builds of smaltql, smaltdf and smaltcy, in workers (theme/runners.ts).
    optimizeDeps: { exclude: ['@smaltworks/smaltql', '@smaltworks/smaltcy', '@smaltdb/df', 'smaltdb', 'smaltkit'] },
    worker: { format: 'es' },
  },
  // The workbench and the console are deployed beside the site (scripts/build.mjs).
  ignoreDeadLinks: [/workbench\//, /console\.html/],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logos/smaltui/favicon-32.svg` }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=Martian+Mono:wght@400;600&display=swap' }],
    ['meta', { property: 'og:title', content: 'smaltui' }],
    ['meta', { property: 'og:description', content: 'A query workbench for smaltdb that runs entirely in the browser.' }],
    ['meta', { property: 'og:image', content: 'https://stenhoor.github.io/smaltui/logos/smaltui/app-icon.svg' }],
    // Links made for the workbench (?env=…, ?db=…, ?sql=…) used to point at the site root: forward them.
    ['script', {}, `if (location.pathname === ${JSON.stringify(base)} && /[?&](env|db|engine|storage|sql)=/.test(location.search)) location.replace(${JSON.stringify(base)} + 'workbench/' + location.search + location.hash);`],
  ],
  markdown: {
    theme: { light: smaltLight, dark: smaltDark },
    languageAlias: { cypher: 'sql' },
    // Every tested SQL, TypeScript and Cypher example runs where it stands (BRAND.md, Documentation, rule 7):
    // theme/runners.ts. A TypeScript example runs only with a result under it (one without is code for a page).
    config: (md) => md.use(playgroundPlugin, { languages: ['sql', 'ts', 'cypher'], onlyWithResult: ['ts'] }),
  },
  themeConfig: {
    logo: { light: '/logos/smaltui/lockup.svg', dark: '/logos/smaltui/lockup-on-dark.svg', alt: 'smaltui' },
    siteTitle: false,
    // The four sections of every smalt site, the app's Demo first (BRAND.md, Documentation, rule 1; Sites and READMEs,
    // rule 12).
    nav: [
      { text: 'Demo', link: '/workbench/?env=envs/demo/env.json', target: '_self' },
      { text: 'Quick start', link: '/guide/quick-start' },
      { text: 'Guide', link: '/guide/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Playground', link: '/playground' },
      smaltworksMenu(),
    ],
    sidebar: [
      { text: 'Quick start', items: [{ text: 'Quick start', link: '/guide/quick-start' }] },
      {
        text: 'Getting started',
        items: [
          { text: 'Getting started', link: '/guide/' },
          { text: 'For AI agents', link: '/guide/agents' },
        ],
      },
      {
        text: 'User guide',
        items: [
          { text: 'Query tabs (SQL)', link: '/guide/queries' },
          { text: 'Explorer and tables', link: '/guide/explorer' },
          { text: 'TypeScript tabs (smaltdf)', link: '/guide/typescript' },
          { text: 'Cypher tabs (smaltcy)', link: '/guide/cypher' },
          { text: 'Import and link data', link: '/guide/import' },
          { text: 'Environments', link: '/guide/environments' },
          { text: 'Databases and storage', link: '/guide/databases' },
          { text: 'Engine and deploy', link: '/guide/engine' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Reference', link: '/reference/' },
          { text: 'Environment manifest', link: '/reference/environment' },
          { text: 'URL parameters', link: '/reference/urls' },
          { text: 'Files', link: '/reference/files' },
          { text: 'Keyboard shortcuts', link: '/reference/shortcuts' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: smaltworksFooter(base, 'badges/'),
  },
});
