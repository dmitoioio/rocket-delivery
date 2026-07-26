/**
 * Іконки — інлайнові SVG, узяті з макета CSTL LIFE.
 *
 * Інлайн, а не шрифт і не спрайт: набір маленький, а зайвий мережевий
 * запит у селі коштує дорожче за кілька кілобайт у бандлі.
 * Усі успадковують currentColor, тож фарбуються стилем батька.
 */

const wrap = (size, body, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
     ${extra}>${body}</svg>`;

export const icons = {
  queue: (s = 21) => wrap(s, '<path d="M4 6h16M4 12h16M4 18h10"/>'),

  active: (s = 21) =>
    wrap(
      s,
      '<path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>'
    ),

  history: (s = 21) => wrap(s, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),

  profile: (s = 21) =>
    wrap(
      s,
      '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>'
    ),

  dashboard: (s = 21) =>
    wrap(
      s,
      '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'
    ),

  couriers: (s = 21) =>
    wrap(
      s,
      '<circle cx="18" cy="17" r="3"/><circle cx="6" cy="17" r="3"/><path d="M9 17h6l-2-8H8"/>'
    ),

  cash: (s = 21) =>
    wrap(
      s,
      '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>'
    ),

  chart: (s = 21) => wrap(s, '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),

  payroll: (s = 21) =>
    wrap(s, '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9.5 8h5M9.5 12h5"/>'),

  photo: (s = 21) =>
    wrap(
      s,
      '<path d="M3 8.5A2.5 2.5 0 015.5 6h1.7l1.1-1.8h6.4L15.8 6h2.7A2.5 2.5 0 0121 8.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z"/><circle cx="12" cy="13" r="3.6"/>'
    ),

  journal: (s = 21) =>
    wrap(
      s,
      '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v18H6.5A2.5 2.5 0 014 18.5z"/><path d="M8 8h7M8 12h7"/>'
    ),

  back: (s = 17) => wrap(s, '<path d="M15 18l-6-6 6-6"/>'),

  refresh: (s = 18) => wrap(s, '<path d="M20 11a8 8 0 10-1.6 5.4"/><path d="M20 4v6h-6"/>'),

  chevron: (s = 16) => wrap(s, '<path d="M9 6l6 6-6 6"/>'),

  /** Телефонна трубка — залита, не обведена: вона на кольоровому крузі */
  phone: (s = 20) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
       <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C11.6 21 3 12.4 3 1.9c0-.5.4-.9 1-.9h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z"/>
     </svg>`,

  check: (s = 22) => wrap(s, '<path d="M20 6L9 17l-5-5"/>'),

  offline: (s = 16) =>
    wrap(
      s,
      '<path d="M2 2l20 20"/><path d="M8.5 16.4a5 5 0 016.9 0"/><path d="M5 13a10 10 0 013.5-2.3M19 13a10 10 0 00-4.6-2.6"/><path d="M1.8 9.5A15 15 0 016 6.8M22.2 9.5a15 15 0 00-9.6-3.7"/>'
    ),

  clock: (s = 16) => wrap(s, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};

/** Ініціали для аватара: «Олег Ткачук» → «ОТ» */
export function initials(fullName = '') {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}
