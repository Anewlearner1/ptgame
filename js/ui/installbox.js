// 📲 安裝與全螢幕: the install-as-app + fullscreen controls, shared by the cover screen and 系統 → 設定.
// installBox() -> [noteEl, rowEl] or null when this device has nothing to offer (desktop without an install prompt; {always:true} skips that check).
import { bus } from '../core/bus.js';
import { h, setText } from './dom.js';
import { layout } from './layout.js';
import { canFullscreen, isFullscreen, toggleFullscreen, canPromptInstall, promptInstall, isStandalone, isIOS } from './pwa.js';

export function installBox(o = {}) {
  if (!(o.always || layout.mobile || layout.touch || canPromptInstall())) return null;
  const fs = h('button', { class: 'btn small', type: 'button', onclick: () => toggleFullscreen() });
  const inst = h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
    const ok = await promptInstall();
    bus.emit('toast', ok ? { text: '已加入主畫面', kind: 'good' } : { text: '已取消安裝', kind: 'info' });
  } }, '📲 安裝成 App');
  const note = h('p', { class: 'muted u-p u-small' });
  const row = h('div', { class: 'row' }, fs, inst);
  const refresh = force => {
    if (force !== true && !note.isConnected) { off(); return; }
    const fsOk = canFullscreen();
    fs.hidden = !fsOk; setText(fs, isFullscreen() ? '⛶ 離開全螢幕' : '⛶ 全螢幕');
    const standalone = isStandalone(), can = canPromptInstall(), ios = isIOS();
    inst.hidden = !can;
    note.textContent = standalone ? '✅ 目前已用 App 模式（全螢幕）執行。'
      : can ? '安裝後會有主畫面圖示，以全螢幕開啟，沒有網址列，離線也能玩。'
        : ios ? '在 iPhone / iPad：點 Safari 的「分享」按鈕 → 「加入主畫面」，就能以全螢幕開啟，沒有網址列。'
          : '想要全螢幕：用瀏覽器選單的「安裝應用程式」或「加入主畫面」；也可以按下面的全螢幕按鈕。';
    row.hidden = !fsOk && !can;
  };
  const off = bus.on('pwa:changed', () => refresh(false));
  refresh(true);
  return [note, row];
}
