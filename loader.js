// loader.js — FreeLand loader v2 (right bite, true circle, CCW sweep)
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

  /* 第一阶段：从“半径线”开始，逆时针扫满圆盘（由快到慢） */
  .fl-mark-sweep .sweep{
    /* pathLength=100 方便用百分比思维 */
    stroke-dasharray: 0 100;
    stroke-dashoffset: 0;
    animation: fl-sweep var(--fl-dur-spin,1200ms) cubic-bezier(.17,.84,.44,1) both;
  }

  /* 第二阶段：图案向左、文字从中心向右并渐显 */
  .fl-mark-wrap{ animation: fl-left var(--fl-dur-merge,600ms) ease-out var(--fl-dur-spin,1200ms) both; }
  .fl-word     { animation: fl-wordin var(--fl-dur-merge,600ms) ease-out var(--fl-dur-spin,1200ms) both; }

  /* 关键帧：dasharray 从 0->100，同时 dashoffset 0->-100，形成“逆时针”生长感 */
  @keyframes fl-sweep{
    0%   { stroke-dasharray:0 100;   stroke-dashoffset:   0; }
    100% { stroke-dasharray:100 0;   stroke-dashoffset:-100; }
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
 * 播放一次加载动画（返回 Promise，动画完成后 resolve）
 * @param {Object} opts
 * @param {number} [opts.durSpin=1200]   第一段逆时针扫出的时长 (ms)
 * @param {number} [opts.durMerge=600]   第二段左右合拢时长 (ms)
 * @param {string} [opts.brand='#2da7ff'] 蓝色
 * @param {string} [opts.text='FreeLand'] 右侧文字
 * @param {string} [opts.background='#fff'] 覆盖层背景色
 * @param {number} [opts.zIndex=9999] 覆盖层 z-index
 * @param {boolean} [opts.fadeOut=true] 结束是否淡出覆盖层
 * @param {HTMLElement} [opts.mount=document.body] 覆盖层挂载处
 * @param {number} [opts.size=54] SVG 显示尺寸（px）
 * @param {string} [opts.font='600 28px/1.1 system-ui,-apple-system,"Segoe UI",Arial'] 文字字体
 * @param {string|number} [opts.shiftLeft='-12px'] 图案向左位移
 * @param {string|number} [opts.wordRight='18px'] 文字向右位移
 * @param {number} [opts.radius=16] 圆半径（与 viewBox=64 配套）
 * @param {number} [opts.strokeWidth=32] 扇形厚度（建议 = 2*radius）
 * @param {{x:number,y1:number,y2:number}} [opts.bite] 右侧缺口三角（默认 {x:64,y1:18,y2:46}）
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
    radius = 16,         // 圆半径（配合 64×64 viewBox）
    strokeWidth = 32,    // = 直径，模拟“实心扇形”
    bite = { x:64, y1:18, y2:46 }, // 右侧缺口三角（>）
  } = opts;

  // 防重复：同一时刻只保留一个 overlay
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

  // 缺口三角参数（在右侧）
  const biteX = Number(bite?.x ?? 64);
  const biteY1 = Number(bite?.y1 ?? 18);
  const biteY2 = Number(bite?.y2 ?? 46);

  // 组装 SVG：不再镜像；通过 dashoffset 负向推进实现逆时针视觉
  overlay.innerHTML = `
    <div class="fl-logo" aria-label="${escapeHtml(text)}">
      <span class="fl-mark-wrap">
        <svg class="fl-mark-sweep" viewBox="0 0 64 64" role="img" aria-hidden="true">
          <defs>
            <mask id="fl-bite-mask">
              <rect fill="white" x="0" y="0" width="64" height="64"/>
              <!-- 右侧缺口（>） -->
              <polygon fill="black" points="32,32 ${biteX},${biteY1} ${biteX},${biteY2}"/>
            </mask>
          </defs>

          <!-- 纯圆：circle + 超粗 stroke = 实心圆盘；mask 挖掉右侧缺口 -->
          <g mask="url(#fl-bite-mask)">
            <circle class="sweep"
              cx="32" cy="32" r="${radius}"
              fill="none" stroke="${brand}"
              stroke-linecap="butt" stroke-width="${strokeWidth}"
              pathLength="100" />
          </g>
        </svg>
      </span>
      <span class="fl-word">${escapeHtml(text)}</span>
    </div>
  `;

  mount.appendChild(overlay);

  // 完成以“文字进入”动画为准；加保险定时器
  const total = durSpin + durMerge;
  return new Promise((resolve) => {
    const finish = () => {
      if (fadeOut) {
        overlay.classList.add('is-done');
        setTimeout(() => { overlay.remove(); resolve(); }, 350);
      } else {
        overlay.remove();
        resolve();
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
