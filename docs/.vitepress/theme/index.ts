import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import '../../../brand/themes/vitepress/smaltdb.css';
import './smaltui.css';
import { withSmaltworks } from '../../../brand/themes/vitepress/stage';

export default {
  extends: DefaultTheme,
  Layout: withSmaltworks(DefaultTheme, 'wip', '/badges/'),
  enhanceApp() {
    if (typeof window === 'undefined') return;
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
