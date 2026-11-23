import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import '../../../brand/themes/vitepress/smaltdb.css';
import './smaltui.css';
import { withSmaltworks } from '../../../brand/themes/vitepress/stage';
import { enablePlaygrounds } from '../../../brand/themes/vitepress/playground';
import { cypher, sql, ts } from './runners';

export default {
  extends: DefaultTheme,
  Layout: withSmaltworks(DefaultTheme, 'wip', '/badges/'),
  enhanceApp() {
    if (typeof window === 'undefined') return;
    // Every tested example runs where it stands (BRAND.md, Documentation, rule 7), as the workbench's tabs run it.
    // Open in smaltui: a SQL example opens as a query tab in the workbench (?sql= runs it there).
    enablePlaygrounds({
      runners: { sql, ts: ts(), cypher: cypher() },
      app: (lang, code) => (lang === 'sql' ? `${import.meta.env.BASE_URL}workbench/?sql=${encodeURIComponent(code)}` : undefined),
    });
    // The workbench (the Demo) and the console page follow the site's light / dark switch through
    // smaltui's own setting (smaltui.theme); the console listens for its storage event.
    const sync = () => {
      const mode = JSON.stringify(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
      try {
        if (localStorage.getItem('smaltui.theme') !== mode) localStorage.setItem('smaltui.theme', mode);
      } catch {}
    };
    sync();
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  },
} satisfies Theme;
