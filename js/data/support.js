// 支持作者 (donation page) config. The game never handles payments: the page only links out to an external sponsor page.
// Fill `url` with the sponsor page address (https://…); while it is empty, every 支持作者 entry point stays hidden.
export const SUPPORT = {
  url: '',
  title: '☕ 支持作者',
  lead: '《餐廳物語》是免費、沒有廣告、沒有內購的小遊戲。',
  points: [
    '捐款完全自願，不影響遊戲內容與進度，不捐也能玩到最後。',
    '你的支持會用在修正錯誤、新增菜色與專區、改善手機體驗。',
    '付款在外部贊助頁完成，遊戲本身不會收集任何付款或個人資料。',
  ],
  thanks: '謝謝你陪餐廳一起成長！',
  button: '前往贊助頁',
};

export function supportUrl() {
  const u = String(SUPPORT.url || '').trim();
  return /^https:\/\/[^\s]+$/i.test(u) ? u : '';
}
