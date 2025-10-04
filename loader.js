// loader.js — FreeLand loader v4 (center draw → icon left, text from center to right)

let STYLE_READY = false;

function injectStyle() {
  if (STYLE_READY) return;
  const css = `
  .fl-loader{
    position:fixed; inset:0; z-index:9999;
    display:grid; place-items:center;
    background:var(--fl-bg,#fff);
  }
  /* 容器本身保持居中；阶段1只有图标可见 */
  .fl-logo{
    position:relative;
    display:flex; align-items:center; justify-content:center;
  }
  .fl-word{
    position:absolute; left:50%; top:50%;
    transform: translate(-50%, -50%); /* 起点 = 居中（与图标一致） */
    font: var(--fl-font, 600 28px/1.1 system-ui,-apple-system,"Segoe UI",Arial);
    color:#111; opacity:0;
    pointer-events:none;
  }

  .fl-mark-wrap{ display:inline-block; }
  .fl-mark-sweep{
    width:var(--fl-size,54px); height:var(--fl-size,54px);
    display:block; color:var(--fl-brand,#2da7ff);
    overflow: visible;
  }

  /* 阶段1：只动画 dasharray 的首段，从 0% → 100%，形成单端“扇形”（由快到慢） */
  .fl-mark-sweep .sweep{
    stroke-dasharray: 0 100;    /* 起始：只有一条半径线 */
    stroke-dashoffset: 0;       /* 固定，避免双端伪影 */
    animation: fl-sweep var(--fl-dur-spin,1200ms) cubic-bezier(.17,.84,.44,1) both;
  }

  /* 阶段2：图标左移；文字从“中心点”向右滑出且渐显（都延迟到阶段1结束） */
  .fl-mark-wrap{
    animation: fl-left var(--fl-dur-merge,600ms) ease-out var(--fl-dur-spin,1200ms) both;
  }
  .fl-word{
    animation: fl-wordin var(--fl-dur-merge,600ms) ease-out var(--fl-dur-spin,1200ms) both;
  }

  @keyframes fl-sweep{
    0%   { stroke-dasharray: 0 100; }
    100% { stroke-dasharray: 100 0; }
  }
  @keyframes fl-left  {
    from{ transform:translateX(0) }
    to  { transform:translateX(var(--fl-shift-left,-12px)) }
  }
  /* 终点 = 图标左移绝对值 + 目标字距（保持最终间隔与比例） */
  @keyframes fl-wordin{
    from{ transform: translate(-50%, -50%); opacity:0; }
    to  { transform: translate(
            calc(-50% + (var(--fl-shift-abs,12px)) + var(--fl-word-right,18px)),
            -50%
          ); opacity:1; }
  }

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
 * @param {string} [opts.text='FreeLand'] 右侧文字
 * @param {string} [opts.background='#fff'] 覆盖层背景
 * @param {number} [opts.zIndex=9999] z-index
 * @param {boolean} [opts.fadeOut=true] 结束淡出
 * @param {HTMLElement} [opts.mount=document.body] 挂载点
 * @param {number} [opts.size=54] 图标显示尺寸（px）
 * @param {string} [opts.font='600 28px/1.1 system-ui,-apple-system,"Segoe UI",Arial'] 字体
 * @param {string|number} [opts.shiftLeft='-12px'] 图案左移距离（负值向左）
 * @param {string|number} [opts.wordRight='18px'] 文本目标相对图标的右侧距离
 * @param {number} [opts.radius=15] 圆半径（viewBox=64 配套；留边避免触边变方）
 * @param {number} [opts.strokeWidth=30] 描边厚度（建议=2*radius）
 * @param {{x:number,y1:number,y2:number}} [opts.bite] 右侧缺口三角 {x,y1,y2}
 * @param {number} [opts.startDeg=0] 扫描起始角（0°=向右，上方=-90°）
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
    radius = 15,
    strokeWidth = 30,
    bite = { x:64, y1:18, y2:46 },
    startDeg = 0,
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

  // 位移相关变量（文字终点会用到“绝对值”）
  const shiftLeftStr = typeof shiftLeft === 'number' ? `${shiftLeft}px` : String(shiftLeft);
  overlay.style.setProperty('--fl-shift-left', shiftLeftStr);
  overlay.style.setProperty('--fl-shift-abs', `${Math.abs(parseFloat(shiftLeftStr))}px`);
  overlay.style.setProperty('--fl-word-right', typeof wordRight === 'number' ? wordRight + 'px' : String(wordRight));

  const biteX  = Number(bite?.x ?? 64);
  const biteY1 = Number(bite?.y1 ?? 18);
  const biteY2 = Number(bite?.y2 ?? 46);

  overlay.innerHTML = `
    <div class="fl-logo" aria-label="${escapeHtml(text)}">
      <span class="fl-mark-wrap">
        <svg class="fl-mark-sweep" viewBox="0 0 64 64" role="img" aria-hidden="true">
          <defs>
            <!-- 用用户坐标系，避免 mask 把边缘裁成方块 -->
            <mask id="fl-bite-mask" maskUnits="userSpaceOnUse">
              <rect fill="white" x="0" y="0" width="64" height="64"/>
              <!-- 右侧缺口（>） -->
              <polygon fill="black" points="32,32 ${biteX},${biteY1} ${biteX},${biteY2}"/>
            </mask>
          </defs>

          <g mask="url(#fl-bite-mask)" transform="rotate(${startDeg} 32 32)">
            <circle class="sweep"
              cx="32" cy="32"
              r="${radius}"
              fill="none" stroke="${brand}"
              stroke-linecap="butt"
              stroke-width="${strokeWidth}"
              pathLength="100" />
          </g>
        </svg>
      </span>
      <span class="fl-word">${escapeHtml(text)}</span>
    </div>
  `;

  mount.appendChild(overlay);

  // 以“文字进入”动画结束为准；保险定时器兜底
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
