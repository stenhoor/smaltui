import DefaultTheme from 'vitepress/theme';
import { withBase, type Theme } from 'vitepress';
import { h } from 'vue';
import '../../../brand/themes/vitepress/smaltdb.css';
import './smaltui.css';

// The work-in-progress badge under the hero's title, as on every smaltworks product page (smalt-brand BRAND.md,
// "Before 1.0"): linked to the stability page.
const stage = () =>
  h('div', { class: 'su-stage' }, [
    h('a', { href: 'https://smaltworks.dev/stability' }, [
      h('img', { class: 'sw-light', src: withBase('/badges/work-in-progress.svg'), alt: 'Work in progress. Come build with us.', height: 56 }),
      h('img', { class: 'sw-dark', src: withBase('/badges/work-in-progress-on-dark.svg'), alt: 'Work in progress. Come build with us.', height: 56 }),
    ]),
  ]);

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-info-after': stage }),
  enhanceApp() {
    if (typeof window === 'undefined') return;
    // The embedded console (console.html, and the workbench) follow the site's light / dark switch through
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
