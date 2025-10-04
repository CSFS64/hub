// loader.js — FreeLand loader v3 (clean CCW pie sweep + right bite)
// 用法：import { playLoader } from './loader.js'; await playLoader();

let STYLE_READY = false;

function injectStyle() {
  if (STYLE_READY) return;
  const css = `
  .fl-loader{
    position:fixed; inset:0; z-index:9999;
    display:grid; place-items:center;
    background:var(--fl-bg,#fff);
  }
  .fl-logo{ display:flex; align-items:center; gap:10px; }
  .fl-word{ font: var(--fl-font, 600 28px/1.1 system-ui,-apple-system,"Segoe UI",Arial); color:#111; opacity:0; }

  .fl-mark-wrap{ display:inline-block; }
  .fl-mark-sweep{
    width:var(--fl-size,54px); height:var(--fl-size,54px);
    display:block; color:var(--fl-brand,#2da7ff);
  }

  /* 第一阶段：只动画 dasharray 的首段，从 0% → 100%，形成单端“扇形” */
  .fl-mark-sweep .sweep{
    stroke-dasharray: 0 100;    /* 起始：只有一条半径线 */
    stroke-dashoffset: 0;       /* 固定，不再移动，避免双端伪影 */
    animation: fl-sweep var(--fl-dur-spin,1200ms) cubic-bezier(.17,.84,.44,1) both;
    .fl-mark-sweep{ width:var(--fl-size,54px); height:var(--fl-size,54px); display:block; color:var(--fl-brand,#2da7ff); overflow:visible; }
  }

  /* 第二阶段：图案向左、文字从中心向右并渐显 */
  .fl-mark-wrap{ animation: fl-left var(--fl-dur-merge,600ms) ease-out var(--fl-dur-spin,1200ms) both; }
  .fl-word     { animation: fl-wordin var(--fl-dur-merge,600ms) ease-out var(--fl-dur-spin,1200ms) both; }

  @keyframes fl-sweep{
    0%   { stroke-dasharray: 0 100; }
    100% { stroke-dasharray: 100 0; }
  }
  @keyframes fl-left  { from{ transform:translateX(0) } to{ transform:translateX(var(--fl-shift-left,-12px)) } }
  @keyframes fl-wordin{ from{ transform:translateX(0); opacity:0 } to{ transform:translateX(var(--fl-word-right,18px)); opacity:1 } }

  .fl-loader.is-done{ animation: fl-hide .35s ease both; }
  @keyframes fl-hide{ to{ opacity:0; visibility:hidden } }

  @media (prefers-reduced-motion: reduce){
    .fl-mark-sweep .sweep, .fl-mark-wrap, .fl-word{ animation:none !important; }
    .fl-word{ opacity:1 }
    .fl-loader{ display:none }
  }
  `;
  const el = document.createElement('style');
  el.setAttribute('data-fl-loader', '');
  el.textContent = css;
  document.head.appendChild(el);
  STYLE_READY = true;
}

function escapeHtml(s=''){
  return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}

/**
 * 播放一次加载动画
 * @param {Object} opts
 * @param {number} [opts.durSpin=1200]   第一段时长 (ms)
 * @param {number} [opts.durMerge=600]   第二段时长 (ms)
 * @param {string} [opts.brand='#2da7ff'] 圆盘颜色
 * @param {string} [opts.text='FreeLand'] 文字
 * @param {string} [opts.background='#fff'] 覆盖层背景
 * @param {number} [opts.zIndex=9999] z-index
 * @param {boolean} [opts.fadeOut=true] 结束淡出
 * @param {HTMLElement} [opts.mount=document.body] 挂载点
 * @param {number} [opts.size=54] 直径（px）
 * @param {string} [opts.font='600 28px/1.1 system-ui,-apple-system,"Segoe UI",Arial'] 字体
 * @param {string|number} [opts.shiftLeft='-12px'] 图案左移
 * @param {string|number} [opts.wordRight='18px'] 文字右移
 * @param {number} [opts.radius=16] 圆半径（viewBox=64 配套）
 * @param {number} [opts.strokeWidth=32] 描边厚度（建议=2*radius）
 * @param {{x:number,y1:number,y2:number}} [opts.bite] 右侧缺口三角 {x,y1,y2}
 * @param {number} [opts.startDeg=0] 起始角（度，0=指向右，逆时针为正）
 * @returns {Promise<void>}
 */
export function playLoader(opts = {}) {
  injectStyle();

  const {
    durSpin = 1200,
    durMerge = 600,
    brand = '#2da7ff',
    text = 'FreeLand',
    background = '#fff',
    zIndex = 9999,
    fadeOut = true,
    mount = document.body,
    size = 54,
    font = '600 28px/1.1 system-ui,-apple-system,"Segoe UI",Arial',
    shiftLeft = '-12px',
    wordRight = '18px',
    radius = 16,
    strokeWidth = 32,
    bite = { x:64, y1:18, y2:46 },
    startDeg = 0,
  } = opts;

  const existing = mount.querySelector('.fl-loader');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'fl-loader';
  overlay.style.setProperty('--fl-bg', background);
  overlay.style.zIndex = String(zIndex);
  overlay.style.setProperty('--fl-brand', brand);
  overlay.style.setProperty('--fl-dur-spin', durSpin + 'ms');
  overlay.style.setProperty('--fl-dur-merge', durMerge + 'ms');
  overlay.style.setProperty('--fl-size', size + 'px');
  overlay.style.setProperty('--fl-font', font);
  overlay.style.setProperty('--fl-shift-left', typeof shiftLeft === 'number' ? shiftLeft + 'px' : String(shiftLeft));
  overlay.style.setProperty('--fl-word-right', typeof wordRight === 'number' ? wordRight + 'px' : String(wordRight));

  const biteX  = Number(bite?.x ?? 64);
  const biteY1 = Number(bite?.y1 ?? 18);
  const biteY2 = Number(bite?.y2 ?? 46);

  // 组装 SVG：纯圆 + 超粗描边（扇形），mask 掏右侧缺口；通过旋转设定起始角
  overlay.innerHTML = `
    <div class="fl-logo" aria-label="${escapeHtml(text)}">
      <span class="fl-mark-wrap">
        <svg class="fl-mark-sweep" viewBox="0 0 64 64" role="img" aria-hidden="true">
          <defs>
            <!-- 修复点 ①：使用用户坐标系，避免 mask 把边缘裁成方块 -->
            <mask id="fl-bite-mask" maskUnits="userSpaceOnUse">
              <rect fill="white" x="0" y="0" width="64" height="64"/>
              <polygon fill="black" points="32,32 ${biteX},${biteY1} ${biteX},${biteY2}"/>
            </mask>
          </defs>
  
          <!-- 修复点 ②：给外圈留边距，外半径 < 32。建议 r=15，strokeWidth=30 -->
          <g mask="url(#fl-bite-mask)" transform="rotate(${startDeg} 32 32)">
            <circle class="sweep"
              cx="32" cy="32"
              r="${radius ?? 15}"                 <!-- 建议默认 15 -->
              fill="none" stroke="${brand}"
              stroke-linecap="butt"
              stroke-width="${strokeWidth ?? 30}" <!-- 建议默认 30 -->
              pathLength="100" />
          </g>
        </svg>
      </span>
      <span class="fl-word">${escapeHtml(text)}</span>
    </div>
  `;

  mount.appendChild(overlay);

  const total = durSpin + durMerge;
  return new Promise((resolve) => {
    const finish = () => {
      if (fadeOut) {
        overlay.classList.add('is-done');
        setTimeout(() => { overlay.remove(); resolve(); }, 350);
      } else {
        overlay.remove(); resolve();
      }
    };
    const timer = setTimeout(finish, total + 80);
    overlay.addEventListener('animationend', (e) => {
      if (e.animationName === 'fl-wordin') {
        clearTimeout(timer);
        finish();
      }
    }, { once:true });
  });
}
