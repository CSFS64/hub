// loader.js
// 用法：import { playLoader } from './loader.js'; await playLoader();
let STYLE_READY = false;

function injectStyle() {
  if (STYLE_READY) return;
  const css = `
  .fl-loader{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#fff}
  .fl-logo{display:flex;align-items:center;gap:10px}
  .fl-word{font:600 28px/1.1 system-ui,-apple-system,"Segoe UI",Arial;color:#111;opacity:0}
  .fl-mark{width:54px;height:54px;display:block}
  .fl-mark path{fill:none;stroke:var(--brand,#2da7ff);stroke-width:14;stroke-linecap:round;
    stroke-dasharray:200;stroke-dashoffset:200}
  .fl-mark-shifter,.fl-mark-rotator{display:inline-block}
  /* 第一段：逆时针旋转 + 画线（ease-out） */
  .fl-mark-rotator{animation:fl-spin-ccw var(--dur-spin,1.2s) cubic-bezier(.17,.84,.44,1) both}
  .fl-mark path{animation:fl-draw var(--dur-spin,1.2s) cubic-bezier(.17,.84,.44,1) both}
  /* 第二段：图案左移 + 文字右移淡入（延迟为第一段时长） */
  .fl-mark-shifter{animation:fl-left var(--dur-merge,.6s) ease-out var(--dur-spin,1.2s) both}
  .fl-word{animation:fl-wordin var(--dur-merge,.6s) ease-out var(--dur-spin,1.2s) both}
  @keyframes fl-spin-ccw{from{transform:rotate(0)}to{transform:rotate(-540deg)}}
  @keyframes fl-draw{from{stroke-dashoffset:200}to{stroke-dashoffset:0}}
  @keyframes fl-left{from{transform:translateX(0)}to{transform:translateX(-12px)}}
  @keyframes fl-wordin{from{transform:translateX(18px);opacity:0}to{transform:translateX(0);opacity:1}}
  .fl-loader.is-done{animation:fl-hide .35s ease both}
  @keyframes fl-hide{to{opacity:0;visibility:hidden}}
  @media (prefers-reduced-motion: reduce){
    .fl-mark-rotator,.fl-mark path,.fl-mark-shifter,.fl-word{animation:none !important}
    .fl-word{opacity:1}
    .fl-loader{display:none}
  }`;
  const el = document.createElement('style');
  el.setAttribute('data-fl-loader', '');
  el.textContent = css;
  document.head.appendChild(el);
  STYLE_READY = true;
}

/**
 * 播放一次加载动画
 * @param {Object} opts
 * @param {number} [opts.durSpin=1200] 第一段旋转+画线时长（ms）
 * @param {number} [opts.durMerge=600]  第二段左右合拢时长（ms）
 * @param {string} [opts.brand='#2da7ff'] 蓝色
 * @param {string} [opts.text='FreeLand'] 右侧文字
 * @param {string} [opts.pathD='M 46 12 A 22 22 0 1 0 46 52'] SVG 路径（蓝色“C”）
 * @param {string} [opts.background='#fff'] 覆盖层背景色
 * @param {number} [opts.zIndex=9999] 覆盖层 z-index
 * @param {boolean} [opts.fadeOut=true] 是否在结尾淡出后移除
 * @param {HTMLElement} [opts.mount=document.body] 覆盖层挂载处
 * @returns {Promise<void>} 动画结束后 resolve
 */
export function playLoader(opts = {}) {
  injectStyle();
  const {
    durSpin = 1200,
    durMerge = 600,
    brand = '#2da7ff',
    text = 'FreeLand',
    pathD = 'M 46 12 A 22 22 0 1 0 46 52',
    background = '#fff',
    zIndex = 9999,
    fadeOut = true,
    mount = document.body,
  } = opts;

  // 建立 DOM
  const overlay = document.createElement('div');
  overlay.className = 'fl-loader';
  overlay.style.setProperty('--brand', brand);
  overlay.style.setProperty('--dur-spin', `${durSpin}ms`);
  overlay.style.setProperty('--dur-merge', `${durMerge}ms`);
  overlay.style.background = background;
  overlay.style.zIndex = String(zIndex);

  overlay.innerHTML = `
    <div class="fl-logo" aria-label="${escapeHtml(text)}">
      <span class="fl-mark-shifter">
        <span class="fl-mark-rotator" aria-hidden="true">
          <svg class="fl-mark" viewBox="0 0 64 64" role="img" aria-hidden="true">
            <path d="${pathD}"></path>
          </svg>
        </span>
      </span>
      <span class="fl-word">${escapeHtml(text)}</span>
    </div>
  `;

  // 防重复：同一时刻最多一个 overlay
  const existing = mount.querySelector('.fl-loader');
  if (existing) existing.remove();

  mount.appendChild(overlay);

  // 结束时序：两段动画 + 可选淡出
  const total = durSpin + durMerge;
  return new Promise((resolve) => {
    const finish = () => {
      if (fadeOut) {
        overlay.classList.add('is-done');
        setTimeout(() => {
          overlay.remove();
          resolve();
        }, 350);
      } else {
        overlay.remove();
        resolve();
      }
    };
    // 保险：若页面很快卸载/切路由，仍能清理
    const t = setTimeout(finish, total);
    // 也监听最后一段动画结束（更鲁棒）
    overlay.addEventListener('animationend', (e) => {
      // 文字进入是最后触发的动画
      if (e.animationName === 'fl-wordin') {
        clearTimeout(t);
        finish();
      }
    }, { once: true });
  });
}

function escapeHtml(s=''){
  return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}
