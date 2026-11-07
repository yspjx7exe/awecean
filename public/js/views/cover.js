import { session } from '../state.js';
import { html } from '../utils.js';
import { brand } from '../ui.js';
import { icon } from '../icons.js';
import { COVER_QUOTES } from '../quotes.js';

export function coverView() {
  const me = session.me;
  const respected = Boolean(me?.cover?.hasRespectedToday);
  const status = me && respected ? '今天，你已敬畏' : '你今天忘敬畏了';
  const href = me ? '/explore' : '/auth?mode=login';
  const first = COVER_QUOTES[0];

  return {
    title: 'Awecean',
    bare: true,
    html: html`<div class="landing">
      <div class="landing__bg" aria-hidden="true"></div>
      <div class="landing__scrim" aria-hidden="true"></div>

      <header class="landing__top">${brand()}</header>

      <main class="landing__main">
        <p class="landing__status">${status}</p>
        <figure class="landing__quote-box" data-cover-quote title="换一句">
          <blockquote class="landing__quote" data-cover-quote-text>“${first.text}”</blockquote>
          <figcaption class="landing__quote-source" data-cover-quote-source>— ${first.source}</figcaption>
        </figure>
        <a class="landing__button" href="${href}">
          发现 ${icon('arrow-right', { size: 16 })}
        </a>
      </main>
    </div>`,
    mount(root) {
      const box = root.querySelector('[data-cover-quote]');
      const text = root.querySelector('[data-cover-quote-text]');
      const source = root.querySelector('[data-cover-quote-source]');
      if (!box || !text || !source) return null;

      let index = 0;
      let timer = null;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

      const show = (next, animate = true) => {
        index = (next + COVER_QUOTES.length) % COVER_QUOTES.length;
        const quote = COVER_QUOTES[index];
        if (animate && !reduced) {
          text.animate(
            [
              { opacity: 0, transform: 'translateY(5px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 420, easing: 'ease-out' }
          );
          source.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
        }
        text.textContent = `“${quote.text}”`;
        source.textContent = `— ${quote.source}`;
      };

      const start = () => {
        if (reduced) return;
        clearInterval(timer);
        timer = setInterval(() => show(index + 1, false), 8000);
      };

      box.addEventListener('click', () => {
        show(index + 1);
        start();
      });
      start();
      return () => clearInterval(timer);
    },
  };
}
