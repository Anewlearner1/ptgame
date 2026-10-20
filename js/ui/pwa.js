// PWA helpers: service-worker registration (https / localhost only), install prompt, fullscreen toggle.
import { bus } from '../core/bus.js';

let deferredPrompt = null;

export function initPwa() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; bus.emit('pwa:changed', {}); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; bus.emit('pwa:changed', {}); });
  document.addEventListener('fullscreenchange', () => bus.emit('pwa:changed', {}));
  document.addEventListener('webkitfullscreenchange', () => bus.emit('pwa:changed', {}));

  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) {
    const reg = () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(err => console.warn('[sw] register failed', err && err.message));
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg, { once: true });
  }
}

export function isStandalone() {
  try {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  } catch (e) { return false; }
}
export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function canPromptInstall() { return !!deferredPrompt; }
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const p = deferredPrompt; deferredPrompt = null;
  try { p.prompt(); const r = await p.userChoice; bus.emit('pwa:changed', {}); return r && r.outcome === 'accepted'; } catch (e) { return false; }
}

const fsEl = () => document.documentElement;
export function canFullscreen() {
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(fsEl().requestFullscreen || fsEl().webkitRequestFullscreen);
}
export function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
export async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) { /* ignore */ }
    } else if (canFullscreen()) {
      await (fsEl().requestFullscreen || fsEl().webkitRequestFullscreen).call(fsEl(), { navigationUI: 'hide' });
    } else {
      bus.emit('toast', { text: '這個瀏覽器不支援全螢幕；請用「加入主畫面」以全螢幕開啟', kind: 'info' });
    }
  } catch (e) { bus.emit('toast', { text: '無法切換全螢幕', kind: 'bad' }); }
}
