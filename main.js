/* ====== ENV ====== */
const USE_BACKEND = true;
const API_BASE = "https://mini-forum-backend.20060303jjc.workers.dev"; // ← 改成你的
const FRONTEND_PROFILE_PREFIX = "#/user/"; // 简单 hash 路由

/* ====== State ====== */
const $ = {};
const session = {
  get(){ try{ return JSON.parse(localStorage.getItem("mini_forum_session")||"null"); }catch{ return null; } },
  set(v){ localStorage.setItem("mini_forum_session", JSON.stringify(v)); },
  clear(){ localStorage.removeItem("mini_forum_session"); }
};

// 统一缓存当前待发送的图片（来自选择、粘贴、拖拽）
$.images = [];

// —— 点赞并发锁：同一帖子同一时刻只发一个请求 —— //
$.likeLock = $.likeLock || new Set();

async function toggleLike(postId, btnEl){
  if (!postId || !btnEl) return;

  // 并发锁：同一贴同一时刻只允许一个请求
  if ($.likeLock.has(postId)) { toast("正在处理中…"); return; }
  $.likeLock.add(postId);
  btnEl.style.pointerEvents = "none";

  // 保险丝：最多 4 秒自动释放
  let released = false;
  const release = ()=>{
    if (released) return;
    released = true;
    $.likeLock.delete(postId);
    btnEl.style.pointerEvents = "";
  };
  const fuse = setTimeout(release, 4000);

  // 读取当前 UI 状态，用于在后端不回 liked/likes 时做兜底
  const wasLiked = btnEl.classList.contains("liked");
  const numEl = btnEl.querySelector("span");
  const currentCount = +((numEl && numEl.textContent) || 0) | 0;

  try{
    // 发请求
    const data = await api(`/posts/${postId}/like`, { method: wasLiked ? "DELETE" : "POST" });

    // 兼容：后端若返回 { liked, likes } 就用后端；否则用本地推算
    const nextLiked = (typeof data?.liked === "boolean") ? data.liked : !wasLiked;
    const nextLikes = (typeof data?.likes  === "number")  ? data.likes  : Math.max(0, currentCount + (wasLiked ? -1 : 1));

    // 一处更新，处处同步（列表多处副本 + 详情）
    updateLikeEverywhere(postId, nextLiked, nextLikes);

  }catch(e){
    toast(e.message || "失败");
  }finally{
    clearTimeout(fuse);
    release();
  }
}

/* ====== Utils ====== */
// tw-grid 图片网格（稳妥：每张图自带 onclick）
function buildPics(urls = []) {
  urls = (urls || []).filter(Boolean);
  if (urls.length === 0) return "";

  const resolved = urls.map(u => resolveMediaURL(u));
  const arr = `[${resolved.map(u => `'${esc(u)}'`).join(",")}]`;
  const n = Math.min(resolved.length, 4);
  const cls = `pics tw-grid n${n}`;

  const imgCell = (u, i, extraClass = "") => `
    <div class="cell ${extraClass}">
      <img src="${esc(u)}" alt="" loading="lazy"
           onclick="event.stopPropagation(); openImageViewer(${arr}, ${i})">
    </div>`;

  if (n === 1) {
    return `<div class="${cls}">
      <div class="cell a">
        <img src="${esc(resolveMediaURL(urls[0]))}" alt="" loading="lazy"
             onload="__setSinglePicRatio(this)"
             onclick="event.stopPropagation(); openImageViewer(${arr}, 0)">
      </div>
    </div>`;
  }
  if (n === 2)  return `<div class="${cls}">
    ${imgCell(resolved[0], 0, "a")}
    ${imgCell(resolved[1], 1, "b")}
  </div>`;
  if (n === 3)  return `<div class="${cls}">
    ${imgCell(resolved[0], 0, "a")}
    ${imgCell(resolved[1], 1, "b")}
    ${imgCell(resolved[2], 2, "c")}
  </div>`;

  return `<div class="${cls}">
    ${imgCell(resolved[0], 0, "a")}
    ${imgCell(resolved[1], 1, "b")}
    ${imgCell(resolved[2], 2, "c")}
    ${imgCell(resolved[3], 3, "d")}
  </div>`;
}

window.__setSinglePicRatio = function setSinglePicRatio(img){
  const wrap = img.closest('.pics.tw-grid.n1');
  if (!wrap) return;
  const cell = wrap.querySelector('.cell');
  if (!cell) return;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return;

  const r = w / h;                 // 宽高比
  cell.classList.remove('ratio-1x1','ratio-4x5'); // 清理旧标记

  // 判定阈值：1.1 以上当横图；0.9~1.1 当方图；小于 0.9 当竖图
  if (r >= 1.1) {
    // 横图：用默认 16:9（不加类）
  } else if (r > 0.9) {
    cell.classList.add('ratio-1x1');
  } else {
    cell.classList.add('ratio-4x5');
  }
};

// 统计一个帖子的“分享数”（转发+引用）
function getShareCount(p){
  return (p?.reposts_count || 0) + (p?.quotes_count || 0);
}

function resolveMediaURL(src=""){
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;            // 已是绝对 URL
  if (USE_BACKEND && src.startsWith("/media/")) {
    return API_BASE + src;                               // 指向 Worker
  }
  return src;                                            // 其它相对路径维持原样
}

// 同步整站内所有该 postId 的点赞显示（列表卡片 + 详情页）
function updateLikeEverywhere(postId, liked, likes){
  try {
    // 列表卡片
    document.querySelectorAll(`.card[data-id="${postId}"] .action.like`).forEach(el=>{
      el.classList.toggle("liked", !!liked);
      const s = el.querySelector("span");
      if (s) s.textContent = String(Math.max(0, likes|0));
    });
    // 详情页（如果在详情页上）
    const detailEl = document.querySelector(`.post-thread .action.like[data-id="${postId}"]`);
    if (detailEl){
      detailEl.classList.toggle("liked", !!liked);
      const s = detailEl.querySelector("span");
      if (s) s.textContent = String(Math.max(0, likes|0));
    }
  } catch (_) {}
}

function htm(strings,...vals){ return strings.map((s,i)=>s+(vals[i]??"")).join(""); }
function esc(s=""){ return s.replace(/[&<>"]/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }
function timeAgo(iso){
  if(!iso) return "";
  const t = new Date(iso).getTime();
  if(isNaN(t)) return "";
  const s = Math.floor((Date.now()-t)/1000);
  if (s<60) return `${s}s`;
  const m = Math.floor(s/60); if (m<60) return `${m}m`;
  const h = Math.floor(m/60); if (h<24) return `${h}h`;
  const d = Math.floor(h/24); if (d<7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}
function toast(msg, ms=1800){
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout($.toastT);
  $.toastT = setTimeout(()=> el.hidden = true, ms);
}
function fileToDataURL(f){ return new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(f); }); }

async function addImageFile(f){
  if (!f || !f.type?.startsWith("image/")) return;
  if ($.images.length >= 3) { toast("最多 3 张图片"); return; }

  const url = await fileToDataURL(f);
  $.images.push({ file: f, url });

  renderPreview();
}

function renderPreview(){
  if (!$.imgPreview) return;
  $.imgPreview.innerHTML = $.images.map((it, idx) => `
    <div class="img-wrap" data-idx="${idx}">
      <img src="${esc(it.url)}" alt="">
      <button class="remove" title="移除">×</button>
    </div>
  `).join("");

  // 删除按钮
  $.imgPreview.querySelectorAll(".remove").forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const box = btn.closest(".img-wrap");
      const i = +box.dataset.idx;
      $.images.splice(i, 1);
      renderPreview();
    };
  });

  // 预览图点击 => 放大查看
  $.imgPreview.querySelectorAll("img").forEach(img=>{
    img.onclick = ()=>{
      const urls = $.images.map(it=>it.url);
      const idx = [...$.imgPreview.querySelectorAll("img")].indexOf(img);
      openImageViewer(urls, idx);
    };
  });
}

// 简易图片查看器（支持组切换）
// ========= 修复版：图片查看器 =========
let _viewer = { urls: [], idx: 0 };

function openImageViewer(urls, startIdx = 0) {
  _viewer.urls = Array.isArray(urls) ? urls : [];
  _viewer.idx  = Math.min(Math.max(0, startIdx | 0), Math.max(0, _viewer.urls.length - 1));

  const box = document.getElementById('imgViewer');
  const img = document.getElementById('imgViewerImg');
  if (!box || !img || _viewer.urls.length === 0) return;

  const show  = () => { img.src = _viewer.urls[_viewer.idx]; box.hidden = false; };
  const close = () => { box.hidden = true; };
  const prev  = () => { if (_viewer.idx > 0)                   { _viewer.idx--; show(); } };
  const next  = () => { if (_viewer.idx < _viewer.urls.length-1){ _viewer.idx++; show(); } };

  show();

  // 覆盖式绑定（不会叠加）
  const btnClose = document.getElementById('imgViewerClose');
  const btnPrev  = document.getElementById('imgViewerPrev');
  const btnNext  = document.getElementById('imgViewerNext');

  if (btnClose) btnClose.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); close(); };
  if (btnPrev)  btnPrev.onclick  = (e)=>{ e.preventDefault(); e.stopPropagation(); prev();  };
  if (btnNext)  btnNext.onclick  = (e)=>{ e.preventDefault(); e.stopPropagation(); next();  };

  // 点击遮罩关闭
  box.onclick = (ev)=>{ if (ev.target === box) close(); };

  // 键盘监听：先卸旧的再挂新的（用全局引用保存旧函数）
  if (window.__viewerOnKey) window.removeEventListener('keydown', window.__viewerOnKey);
  window.__viewerOnKey = (ev)=>{
    if (box.hidden) return;
    if (ev.key === 'Escape')     close();
    if (ev.key === 'ArrowLeft')  prev();
    if (ev.key === 'ArrowRight') next();
  };
  window.addEventListener('keydown', window.__viewerOnKey);
}

/* ====== API ====== */
async function api(path, {method="GET", body=null, auth=true, raw=false, headers={}}={}){
  const url = USE_BACKEND ? API_BASE + path : path;
  const h = { ...headers };
  if(!(body instanceof FormData)) h["content-type"] = h["content-type"] || "application/json";
  if(auth && session.get()?.token) h["authorization"] = "Bearer " + session.get().token;

  const res = await fetch(url, {
    method, headers:h, body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
  });
  if(raw) return res;
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data.error || res.statusText || "请求失败");
  return data;
}

// 把 feed 里的每条帖子中，形如 string 的 repost_of / quote_of 先展开成对象
async function expandRefs(items){
  const authed = !!session.get();        // 已登录就带 token，避免私有帖 403
  if (!Array.isArray(items) || items.length===0) return items;

  // 1) 收集所有需要补拉的 id，去重
  const needIds = new Set();
  for (const p of items){
    if (typeof p.repost_of === 'string') needIds.add(p.repost_of);
    if (typeof p.original  === 'string') needIds.add(p.original);
    if (typeof p.quote_of  === 'string') needIds.add(p.quote_of);
  }
  if (needIds.size === 0) return items;

  // 2) 并发拉取，放进缓存
  const cache = new Map();
  await Promise.all([...needIds].map(async (id)=>{
    try{
      const obj = await api(`/posts/${id}`, { method:'GET', auth: authed });
      cache.set(id, obj);
    }catch(e){ /* 静默失败，保持原样 */ }
  }));

  // 3) 回填到原数组
  for (const p of items){
    if (typeof p.repost_of === 'string' && cache.has(p.repost_of)) p.repost_of = cache.get(p.repost_of);
    if (typeof p.original  === 'string' && cache.has(p.original))  p.original  = cache.get(p.original);
    if (typeof p.quote_of  === 'string' && cache.has(p.quote_of))  p.quote_of  = cache.get(p.quote_of);
  }
  return items;
}

// 展开“单条帖子”的引用（用在单帖页兜底）
async function expandOne(post){
  const authed = !!session.get();
  if (post && typeof post.repost_of === 'string') {
    try{ post.repost_of = await api(`/posts/${post.repost_of}`, { method:'GET', auth: authed }); }catch{}
  }
  if (post && typeof post.quote_of === 'string') {
    try{ post.quote_of = await api(`/posts/${post.quote_of}`, { method:'GET', auth: authed }); }catch{}
  }
  return post;
}

/* ====== Boot ====== */
window.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  initRepostDialogs();
  bindNav();
  bindComposer();
  bindAuth();
  renderMeBlock();
  applyTheme();
  handleRoute();                 // ← 用路由决定是首页还是单帖页
  window.addEventListener("hashchange", handleRoute);
});

// 让所有 .pics 内的图片点开全屏查看
(function bindGlobalImageZoom(){
  const root = document.body;
  root.addEventListener('click', (e)=>{
    const img = e.target.closest('.pics img');
    if (!img) return;

    const pics = img.closest('.pics');
    const all = [...pics.querySelectorAll('img')].map(i => i.src);
    const idx = [...pics.querySelectorAll('img')].indexOf(img);
    openImageViewer(all, idx);
  });
})();

/* ====== DOM cache ====== */
function cacheDom(){
  $.replyDialog = document.getElementById("replyDialog");
  $.replyHost   = document.getElementById("replyHost");
  $.replyText   = document.getElementById("replyText");
  $.btnReply    = document.getElementById("btnReply");
  $.replyAvatar = document.getElementById("replyAvatar");
  $.feed = document.getElementById("feed");
  $.loading = document.getElementById("loading");
  $.empty = document.getElementById("emptyHint");
  $.tabs = document.querySelectorAll(".topbar .tab");
  $.postText = document.getElementById("postText");
  $.postImages = document.getElementById("postImages");
  $.imgPreview = document.getElementById("imgPreview");
  $.btnPublish = document.getElementById("btnPublish");
  $.meAvatar = document.getElementById("meAvatar");
  $.authDialog = document.getElementById("authDialog");
  $.btnSendOtp = document.getElementById("btnSendOtp");
  $.btnPhoneLogin = document.getElementById("btnPhoneLogin");
  $.btnPasswordLogin = document.getElementById("btnPasswordLogin");
  $.toggleTheme = document.getElementById("toggleTheme");
  document.getElementById("openComposer").onclick = () => $.postText?.focus();
  document.getElementById("btnSearch").onclick = doSearch;
  $.toggleTheme.onclick = toggleTheme;
}

// ===== 初始化：转发/引用弹窗 =====
function initRepostDialogs(){
  // 缓存 DOM
  $.repostChoiceDialog = document.getElementById("repostChoiceDialog");
  $.quoteDialog        = document.getElementById("quoteDialog");
  $.btnRepostNow       = document.getElementById("btnRepostNow");
  $.btnQuote           = document.getElementById("btnQuote");
  $.btnQuoteSend       = document.getElementById("btnQuoteSend");
  $.quoteText          = document.getElementById("quoteText");
  $.quoteCounter       = document.getElementById("quoteCounter");
  $.quotePreview       = document.getElementById("quotePreview");

  // 当前操作的原帖 id
  $.repostTargetId = null;

  // 打开选择弹窗（供卡片按钮调用）
  $.openRepostChoice = (postId)=>{
    $.repostTargetId = postId;
    if ($.repostChoiceDialog) $.repostChoiceDialog.showModal();
  };

  // 直接转发
  if ($.btnRepostNow) {
    $.btnRepostNow.onclick = async ()=>{
      const me = await ensureLogin(); if(!me) return;
      const id = $.repostTargetId; if(!id) return $.repostChoiceDialog?.close();
      try{
        const fd1 = new FormData();
        fd1.append('repost_of', id);
        await api('/posts', { method:'POST', body: fd1 });
        $.repostChoiceDialog?.close();
        toast("已转发"); loadFeed(getCurrentTab());
      }catch(e){ toast(e.message||"转发失败"); }
    };
  }

  // 选择“引用”
  if ($.btnQuote) {
    $.btnQuote.onclick = async () => {
      const id = $.repostTargetId; 
      if (!id) return $.repostChoiceDialog?.close();
      $.repostChoiceDialog?.close();
      // 直接用回复弹窗样式打开“引用模式”
      $.openQuote(id);
    };
  }

  // 发布引用
  if ($.btnQuoteSend) {
    $.btnQuoteSend.onclick = async ()=>{
      const me = await ensureLogin(); if(!me) return;
      const id = $.repostTargetId; if(!id) return $.quoteDialog?.close();
      const text = ($.quoteText?.value||"").trim();
      if (text.length>280) { toast("超出 280 字"); return; }
      try{
          const fd2 = new FormData();
          fd2.append('text', text);
          fd2.append('quote_of', id);
          await api('/posts', { method:'POST', body: fd2 });
        $.quoteDialog?.close();
        toast("已发布引用"); loadFeed(getCurrentTab());
      }catch(e){ toast(e.message||"发布失败"); }
    };
  }

  // 计数器
  function updateQuoteCounter(){
    if (!$.quoteCounter) return;
    const remain = 280 - ($.quoteText?.value||"").length;
    $.quoteCounter.textContent = remain;
    $.quoteCounter.classList.toggle("over", remain < 0);
  }
  $.updateQuoteCounter = updateQuoteCounter; // 如果别处要用
  $.quoteText?.addEventListener("input", updateQuoteCounter);

  // 引用预览
  $.buildQuotePreview = async function(postId){
    const p = await api(`/posts/${postId}`, { method:"GET", auth: !!session.get() });
    const html = `
      <div class="quote-embed">
        <img class="avatar" src="${esc(p.author?.avatar || 'data:,')}" alt="">
        <div class="q-content">
          <div class="q-head">${esc(p.author?.nickname||p.author?.username||"用户")}
            <span class="meta">· ${timeAgo(p.created_at)}</span></div>
          <div class="q-text clamped">${nl2brSafe(p.text||"")}</div>
          <div class="show-more"
               onclick="this.previousElementSibling.classList.remove('clamped'); this.remove()">Show more</div>
        </div>
      </div>`;
    if ($.quotePreview){
      $.quotePreview.innerHTML = html;
      $.quotePreview.onclick = ()=> goToPost(postId);
    }
  };
}

/* ====== Theme ====== */
function applyTheme(){
  const saved = localStorage.getItem("theme") || (matchMedia('(prefers-color-scheme: dark)').matches ? "dark":"light");
  document.documentElement.classList.toggle("dark", saved==="dark");
}
function toggleTheme(){
  const dark = !document.documentElement.classList.contains("dark");
  localStorage.setItem("theme", dark?"dark":"light"); applyTheme();
}

/* ====== Nav / Tabs ====== */
function bindNav(){
  document.querySelectorAll(".left-nav .nav-item").forEach(a=>{
    a.onclick = ()=>{
      document.querySelectorAll(".left-nav .nav-item").forEach(n=>n.classList.remove("is-active"));
      a.classList.add("is-active");
      const link = a.getAttribute("data-link");
      
      // 统一：回到首页路由；如果本来就在首页，就直接刷新当前 Tab
      const goHomeRoute = () => {
        if (location.hash !== "") {
          location.hash = "";              // 触发 handleRoute -> 恢复 UI + loadFeed
        } else {
          // 已经在首页，手动刷新列表 & 确保 UI 可见
          document.getElementById("composeInline").style.display = "";
          document.querySelector(".topbar .tabs").style.display = "";
          loadFeed(getCurrentTab());
          // 可选：回到顶部
          // window.scrollTo({ top: 0, behavior: "instant" });
        }
      };

      if (link === "home") {
        setActiveTab("for_you");
        goHomeRoute();
        // 不再手动 loadFeed，交给 handleRoute 处理，避免重复加载
        return;
      }

      if (link === "following") {
        setActiveTab("following");
        goHomeRoute();
        return;
      }

      if (link === "profile") { gotoMyProfile(); return; }
      if (link === "search")  { document.getElementById("q").focus(); return; }
    };
  });

  $.tabs.forEach(t=>{
    t.onclick = ()=>{
      setActiveTab(t.dataset.tab);
      // 在单帖页点顶部 Tab 时，也要回到根，避免“返回”跳回旧帖子
      if (location.hash !== "") location.hash = "";
      else loadFeed(t.dataset.tab);
    };
  });
}

function setActiveTab(tab){
  $.tabs.forEach(t=>t.classList.toggle("is-active", t.dataset.tab===tab));
}

/* ====== Composer ====== */
function bindComposer(){
  // 文件选择（input）
  $.postImages.onchange = async ()=>{
    const files = [...$.postImages.files];
    for (const f of files) await addImageFile(f);
    $.postImages.value = ""; // 清空，便于再次选择同名文件
  };

  // 在发帖文本框中粘贴图片（支持从剪贴板直接粘贴）
  $.postText.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items || [];
    let added = false;
    for (const it of items) {
      if (it.kind === 'file' && it.type?.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) { await addImageFile(f); added = true; }
      }
    }
    // 如果只粘贴了图片（没有文字），阻止默认，避免插入奇怪占位
    const hasText = !!(e.clipboardData && e.clipboardData.getData('text/plain'));
    if (added && !hasText) e.preventDefault();
  });

  // 拖拽图片到输入框或预览区
  [$.postText, $.imgPreview].forEach(el=>{
    el.addEventListener('dragover', (e)=>{ e.preventDefault(); });
    el.addEventListener('drop', async (e)=>{
      e.preventDefault();
      const files = [...(e.dataTransfer?.files||[])];
      for (const f of files) await addImageFile(f);
    });
  });

  $.btnPublish.onclick = publish;
}

async function publish(){
  const me = await ensureLogin(); if(!me) return;
  const text = ($.postText.value||"").trim();

  if(!text && ($.images?.length||0)===0) return toast("写点什么吧");

  const fd = new FormData();
  fd.append("text", text.slice(0,500));
  for (const it of ($.images||[])) fd.append("images", it.file);

  try{
    await api("/posts", { method:"POST", body: fd });
    $.postText.value = "";
    $.postImages.value = "";
    $.images = [];
    renderPreview();          // 清空预览
    toast("发布成功");
    loadFeed(getCurrentTab());
  }catch(e){
    toast(e.message || "发布失败");
  }
}

/* ====== Feed ====== */
function getCurrentTab(){ return [...$.tabs].find(t=>t.classList.contains("is-active"))?.dataset.tab || "for_you"; }
async function loadFeed(tab="for_you"){
  if ($.likeLock) $.likeLock.clear();
  $.loading.hidden=false; $.empty.hidden=true; $.feed.innerHTML="";

  try{
    const authed = !!session.get();  // ★ 已登录就带上 Authorization
    const data = await api(`/feed?tab=${encodeURIComponent(tab)}`, {
      method: "GET",
      auth: authed
    });

    let items = data.items || [];
    items = await expandRefs(items);  // expandRefs 里本来也会根据是否登录去带 token
    if(items.length===0){ $.empty.hidden=false; }
    $.feed.innerHTML = items.map(renderCard).join("");
    bindCardEvents();
    hydrateSuggestions(items);
  }catch(e){
    toast(e.message || "加载失败");
  }finally{
    $.loading.hidden = true;
    applyClamp();
  }
}

function applyClamp(){
  document.querySelectorAll(".text.clamped").forEach(el=>{
    // 这里 el.clientHeight 是 5 行的高度，el.scrollHeight 是全文高度
    if(el.scrollHeight > el.clientHeight + 2){  // 加 2 防止精度问题
      const btn = el.nextElementSibling;
      if(btn && btn.classList.contains("show-more")){
        btn.style.display = "inline-block";
      }
    }
  });
}

function renderCard(p){
  // —— 归一化：三类情况 —— 
  // A. 普通：没有 repost_of/quote_of
  // B. 转发： { repost_of: <原帖对象或原帖id>, reposter: <用户> } 或 { kind:'repost', original:{}, actor:{} }
  // C. 引用： { quote_of: <原帖对象或原帖id> }
  const isRepost = !!(p.repost_of || p.original || p.kind==='repost');
  const isQuote  = !!p.quote_of;

  if (isRepost) {
    const orig = p.repost_of?.id ? p.repost_of : (p.original || p.repost_of);
    const originalPost = orig?.id ? orig : p.repost_of;
    const reposter = p.reposter || p.actor || p.author || {};
    const me = session.get()?.user;
    const canDeleteRepost = me && me.id === (p.author?.id); // 你自己发的这条“转发”
  
    const badge = `
      <div class="repost-badge">
        <span class="icon">🔁</span>${esc(reposter.nickname||reposter.username||"用户")} 转发了
      </div>
    `;
  
    // 仍然复用原帖的可视卡片，但把外层包一个 data-repost-id
    const cardHtml = renderOriginalCard(originalPost);
  
    return `
      <div class="repost-wrap" data-repost-id="${esc(p.id)}">
        ${badge}
        ${cardHtml}
      </div>
    `;
  }

  if (isQuote) {
    const me = session.get()?.user;
    const deletable = me && me.id===p.author.id;
    const quote = p.quote_of; // 对象

    // —— 图片渲染：使用 tw-grid —— //
    const renderPics = (imgs = []) => buildPics(imgs);
  
    const quoteHtml = quote ? `
      <div class="quote-embed" role="button"
           onclick="event.stopPropagation(); goToPost('${esc(quote.id)}')">
        <img class="avatar" src="${esc(quote.author?.avatar || 'data:,')}" alt="">
        <div class="q-content">
          <div class="q-head">
            <span class="name">${esc(quote.author?.nickname || quote.author?.username || "用户")}</span>
            <span class="meta">· ${timeAgo(quote.created_at)}</span>
          </div>
          <div class="q-text clamped">${nl2brSafe(quote.text || "")}</div>
          <div class="show-more"
               onclick="event.stopPropagation();
                        this.previousElementSibling.classList.remove('clamped');
                        this.remove()">Show more</div>
        </div>
      </div>
    ` : "";
  
    return htm`
      <article class="card clickable" data-id="${esc(p.id)}">
        <img class="avatar" src="${esc(p.author.avatar||'data:,')}" alt="">
        <div class="content">
          <div class="head">
            <span class="name">${esc(p.author.nickname || p.author.username || "用户")}</span>
            <span class="meta">· ${timeAgo(p.created_at)}</span>
          </div>
          ${renderTextWithClamp(p.text, p.id)}
          ${quoteHtml}
          ${renderPics(p.images)}
          <div class="actions">
            <div class="action open">💬 <span>${p.comments_count||0}</span></div>
            <div class="action repost" title="转发">🔁 <span>${getShareCount(p)}</span></div>
            <div class="action like ${p.liked?'liked':''}">❤️ <span>${p.likes||0}</span></div>
            ${deletable ? `<div class="action del" title="删除">🗑️</div>` : ""}
          </div>
        </div>
      </article>`;
  }

  // —— 默认：普通原帖（保持你原来的实现） —— //
  return renderOriginalCard(p);
}

// 把“普通原帖卡片”抽出来（给转发复用）
// ① 普通原帖卡片（给转发复用）
function renderOriginalCard(p){
  const me = session.get()?.user;
  const deletable = me && me.id===p.author.id;

  // 用通用 tw-grid 渲染图片
  const renderPics = (imgs = []) => buildPics(imgs);

  return htm`
  <article class="card clickable" data-id="${esc(p.id)}">
    <img class="avatar" src="${esc(p.author.avatar||'data:,')}" alt="">
    <div class="content">
      <div class="head">
        <span class="name">${esc(p.author.nickname || p.author.username || "用户")}</span>
        <span class="meta">· ${timeAgo(p.created_at)}</span>
      </div>
      ${renderTextWithClamp(p.text, p.id)}
      ${renderPics(p.images)}
      <div class="actions">
        <div class="action open">💬 <span>${p.comments_count||0}</span></div>
        <div class="action like ${p.liked?'liked':''}">❤️ <span>${p.likes||0}</span></div>
        <div class="action repost" title="转发">🔁 <span>${getShareCount(p)}</span></div>
        ${deletable ? `<div class="action del" title="删除">🗑️</div>` : ""}
      </div>
    </div>
  </article>`;
}

function bindCardEvents(){
  // —— 转发按钮 —— //
  document.querySelectorAll(".card .repost").forEach(b=>{
    b.onclick = async (e)=>{
      e.stopPropagation();
      const me = await ensureLogin(); if(!me) return;
      const card = e.target.closest(".card");
      const id = card.dataset.id;               // 原帖 id
      $.openRepostChoice(id);                   // 打开选择弹窗
    };
  });

  // 整卡点击进入详情
  document.querySelectorAll(".card.clickable").forEach(card=>{
    card.onclick = (e)=>{
      // 如果点的是动作区里的按钮，则不跳转
      if (e.target.closest(".action")) return;
      const id = card.dataset.id;
      goToPost(id);
    };
  });

  // 原有动作绑定，同时阻止冒泡
  document.querySelectorAll(".card .open").forEach(b=>{
    b.onclick = (e)=>{
      e.stopPropagation();
      const id = e.target.closest(".card").dataset.id;
      $.openReply(id);   // ← 原来是 goToPost(id)
    };
  });

  document.querySelectorAll(".card .like").forEach(b=>{
    b.onclick = async (e)=>{
      e.stopPropagation();
      const me = await ensureLogin(); if(!me) return;
      const card = e.currentTarget.closest(".card");   // 用 currentTarget 更稳
      const id   = card?.dataset.id;
      if (!id) return;
      toggleLike(id, b);
    };
  });
  
  document.querySelectorAll(".card .del, .repost-wrap .del").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
  
      // 先看是否在转发包裹里，如果是，就删这条“转发”的 id
      const wrap = e.target.closest('.repost-wrap');
      let id = wrap?.dataset.repostId;
  
      // 否则按原逻辑：删这张卡自身的 id（普通帖 / 引用帖）
      if (!id) {
        const card = e.target.closest(".card");
        id = card?.dataset.id;
      }
  
      if (!id || id==='null' || id==='undefined' || id.length !== 24) {
        toast("这条帖子数据异常，已过滤"); 
        return;
      }
  
      if (!confirm("确定删除这条帖子吗？")) return;
  
      try {
        await api(`/posts/${id}`, { method: "DELETE" });
        toast("已删除");
        loadFeed(getCurrentTab());
      } catch (err) {
        toast(err.message || "删除失败");
      }
    };
  });
}

//-----回复弹窗-----//
$.closeReply = ()=> $.replyDialog.close();

function renderQuoted(p){
  const name = esc(p.author?.nickname || p.author?.username || "用户");
  return `
    <div class="head">${name} <span class="meta">· ${timeAgo(p.created_at)}</span></div>
    ${renderTextWithClamp(p.text, p.id)}
  `;
}

// 通用：打开编辑弹窗（reply/quote 共用 UI）
$.openComposer = async (postId, mode = "reply") => {
  const me = await ensureLogin(); if (!me) return;
  try {
    const d = await api(`/posts/${postId}`, { method: "GET", auth: true });

    // 顶部标题、按钮、占位语切换
    const titleEl = $.replyDialog.querySelector('.mf-modal-topbar div');
    const btnEl   = document.getElementById("btnReply");
    const ta      = document.getElementById("replyText");

    if (mode === "quote") {
      titleEl.textContent = "引用帖子";
      btnEl.textContent   = "发布";
      ta.placeholder      = "写点你的看法（可选）";
    } else {
      titleEl.textContent = "Reply";
      btnEl.textContent   = "Reply";
      ta.placeholder      = "Post your reply";
    }

    // 原帖显示（沿用你已有的渲染）
    $.replyHost.innerHTML = renderQuoted(d);

    // 两侧头像
    document.getElementById("replyAuthorAvatar").src = esc(d.author?.avatar || "data:,");
    document.getElementById("replyMyAvatar").src     = esc(session.get()?.user?.avatar || "data:,");

    // 清空输入
    if (ta) ta.value = "";

    // 打开弹窗
    $.replyDialog.showModal();

    requestAnimationFrame(layoutSpine);

    // 计数/自适应（保留原逻辑）
    const LIMIT   = 280;
    const counter = document.getElementById("replyModalCounter");
    const upsell  = document.getElementById("replyModalUpsell");
    const autosize = () => {
      ta.style.height = "auto";
      ta.style.overflowY = "hidden";
      ta.style.height = Math.min(ta.scrollHeight, 1000) + "px";
    };
    const update = () => {
      autosize();
      const remain = LIMIT - (ta?.value.length || 0);
      if (counter) {
        counter.textContent = remain;
        counter.classList.toggle("over", remain < 0);
      }
      if (upsell) upsell.classList.toggle("show", remain < 0);
    };
    if (ta) {
      ta.oninput = ta.onfocus = update;
      ta.onkeydown = (ev) => {
        if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
          ev.preventDefault(); btnEl?.click();
        }
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          const s = ta.selectionStart, v = ta.value;
          ta.value = v.slice(0, s) + "\n" + v.slice(s);
          ta.selectionStart = ta.selectionEnd = s + 1;
          update();
        }
      };
    }
    update();

    // 关闭时清理
    const handleResize = () => autosize();
    window.addEventListener("resize", handleResize, { passive: true });
    $.replyDialog.addEventListener("close", () => {
      window.removeEventListener("resize", handleResize);
      if (ta) ta.oninput = ta.onfocus = ta.onkeydown = null;
    }, { once: true });

    // 发送（按模式分流）
    btnEl.onclick = async () => {
      const text = (ta?.value || "").trim();
      if (mode === "reply") {
        if (!text) return toast("回复不能为空");
        if (text.length > LIMIT) { upsell?.classList.add("show"); return toast("超出 280 字，精简后再发"); }
        try {
          await api(`/posts/${postId}/comments`, { method: "POST", body: { text } });
          $.closeReply();
          if (location.hash === `#/post/${postId}`) { showPostPage(postId); }
          else { goToPost(postId); }
          toast("已回复");
        } catch (e) { toast(e.message || "发送失败"); }
      } else {
        // quote 模式：text 可空；提交 quote_of
        if (text.length > LIMIT) { upsell?.classList.add("show"); return toast("超出 280 字，精简后再发"); }
        try {
          const fd = new FormData();
          if (text) fd.append('text', text);
          fd.append('quote_of', postId);
          await api('/posts', { method:'POST', body: fd });
          $.closeReply();
          toast("已发布引用");
          loadFeed(getCurrentTab());
        } catch (e) { toast(e.message || "发布失败"); }
      }
    };

  } catch (e) {
    toast(e.message || "打开失败");
  }
};

// 兼容旧名字：保留调用点
$.openReply = (postId) => $.openComposer(postId, "reply");
$.openQuote = (postId) => $.openComposer(postId, "quote");


/* ====== Router ====== */
function handleRoute(){
  if ($.likeLock) $.likeLock.clear();

  const m = location.hash.match(/^#\/post\/([A-Za-z0-9_-]{8,64})$/);
  if (m) {
    showPostPage(m[1]);
  } else {
    // 默认首页（恢复 UI）
    document.getElementById("composeInline").style.display = "";
    document.querySelector(".topbar .tabs").style.display = "";
    loadFeed(getCurrentTab());
  }
}

function goToPost(id){
  location.hash = `#/post/${id}`;
}

/* ====== Auth ====== */
function bindAuth(){
  // 打开登录面板（若未登录时点发帖/点赞等）
  $.openAuth = ()=> $.authDialog.showModal();
  $.closeAuth = ()=> $.authDialog.close();
  // 切换手机/密码 Tab
  document.querySelectorAll("#authDialog .tab").forEach(t=>{
    t.onclick = ()=>{
      document.querySelectorAll("#authDialog .tab").forEach(x=>x.classList.remove("is-active"));
      t.classList.add("is-active");
      const mode = t.dataset.auth;
      document.getElementById("phonePane").hidden = mode!=="phone";
      document.getElementById("passPane").hidden = mode!=="password";
    };
  });
  // 发送验证码
  $.btnSendOtp.onclick = async ()=>{
    const phone = document.getElementById("phone").value.trim();
    if(!phone) return toast("请输入手机号");
    try{
      const res = await api("/auth/send_otp",{method:"POST", body:{phone}, auth:false});
      toast(res?.dev_code ? `开发验证码：${res.dev_code}` : "验证码已发送");
    }catch(e){ toast(e.message || "发送失败"); }
  };
  // 手机登录/注册
  $.btnPhoneLogin.onclick = async ()=>{
    const phone = document.getElementById("phone").value.trim();
    const code = document.getElementById("otp").value.trim();
    const nickname = document.getElementById("nickname").value.trim();
    if(!phone || !code) return toast("请填写手机号和验证码");
    try{
      // 尝试直接用 login_phone；若用户不存在且后端未自动创建则 fallback signup
      let data;
      try{
        data = await api("/auth/login_phone",{method:"POST", body:{phone, code}, auth:false});
      }catch{
        data = await api("/auth/signup",{method:"POST", body:{phone, code, nickname, password: (Math.random()+1).toString(36).slice(2)} , auth:false});
      }
      session.set(data); renderMeBlock(); $.closeAuth(); toast("登录成功");
      loadFeed(getCurrentTab());
    }catch(e){ toast(e.message || "登录失败"); }
  };
  // 账号密码登录
  $.btnPasswordLogin.onclick = async ()=>{
    const account = document.getElementById("account").value.trim();
    const password = document.getElementById("password").value;
    if(!account || !password) return toast("请填写账号与密码");
    try{
      const data = await api("/auth/login",{method:"POST", body:{account, password}, auth:false});
      session.set(data); renderMeBlock(); $.closeAuth(); toast("登录成功");
      loadFeed(getCurrentTab());
    }catch(e){ toast(e.message || "登录失败"); }
  };
}
async function ensureLogin(){
  const s = session.get();
  if(s?.token) return s.user;
  $.openAuth(); return null;
}
function renderMeBlock(){
  const me = session.get()?.user;
  const box = document.getElementById("meBlock");
  const avatar = me?.avatar || "data:,";
  if(me){
    box.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center;">
        <img class="avatar" src="${esc(avatar)}" style="width:40px;height:40px;border-radius:50%;background:#ddd;" alt="">
        <div>
          <div><b>${esc(me.nickname || me.username || "用户")}</b></div>
          <div class="small">${esc(me.phone || "")}</div>
        </div>
      </div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn" onclick="$.logout()">退出</button>
      </div>`;
  }else{
    box.innerHTML = `<button class="btn btn-full" onclick="$.openAuth()">登录 / 注册</button>`;
  }
  $.logout = ()=>{ session.clear(); location.reload(); };
}

/* ====== User Profile / Suggestions / Search ====== */
async function gotoMyProfile(){
  const me = session.get()?.user;
  if(!me) { $.openAuth(); return; }
  openUser(me.id);
}

async function openUser(uid){
  // 清理点赞并发锁，避免“第一次点没反应”
  if ($.likeLock) $.likeLock.clear();

  // 简单的加载状态（可选）
  $.loading.hidden = false; $.empty.hidden = true; $.feed.innerHTML = "";

  try{
    const d = await api(`/users/${uid}`, { method:"GET", auth: !!session.get() });
    d.posts = await expandRefs(d.posts || []);

    // 渲染页面
    $.feed.innerHTML = renderProfile(d);

    // 先绑定“关注/取关”
    bindProfileActions(d);

    // ⭐ 关键：给帖子卡片重新绑定交互（点赞/转发/删除/进详情…）
    bindCardEvents();

    // ⭐ 关键：计算是否展示“Show more”
    applyClamp();

    // 若没有帖子给个空态
    if (!d.posts || d.posts.length === 0) $.empty.hidden = false;
  }catch(e){
    toast(e.message||"打开失败");
    $.feed.innerHTML = `<div class="empty">加载失败：${esc(e.message||'')}</div>`;
  }finally{
    $.loading.hidden = true;
  }
}

function renderProfile(d){
  const u = d.user;
  const me = session.get()?.user;
  const followed = u.following;
  const isMe = me && me.id===u.id;
  const followBtn = isMe ? "" : `<button id="btnFollow" class="btn ${followed?'':'btn-primary'}">${followed?'已关注':'关注'}</button>`;

  const posts = (d.posts||[]).map(renderCard).join("");
  return `
  <div class="panel" style="margin:12px;">
    <div style="display:flex; gap:12px; align-items:center;">
      <img class="avatar" src="${esc(u.avatar||'data:,')}" style="width:64px;height:64px;border-radius:50%;" alt="">
      <div style="flex:1;">
        <div style="font-weight:800; font-size:20px;">${esc(u.nickname || u.username || "用户")}</div>
        <div class="muted">@${esc(u.username||'')}</div>
        <div class="muted" style="margin-top:6px;">${esc(u.bio||'')}</div>
        <div style="margin-top:8px; color:var(--muted);">
          <b>${u.following_count||0}</b> 关注 · <b>${u.followers_count||0}</b> 粉丝
        </div>
      </div>
      ${followBtn}
    </div>
  </div>
  ${posts || `<div class="empty">还没有发布内容</div>`}
  `;
}

function bindProfileActions(d){
  const btn = document.getElementById("btnFollow");
  if(!btn) return;

  btn.onclick = async ()=>{
    const me = await ensureLogin(); if(!me) return;
    const uid = d.user.id;
    const followed = d.user.following;

    try{
      await api(`/users/${uid}/follow`, { method: followed ? "DELETE" : "POST" });

      // 1) 立刻刷新对方主页（其粉丝数实时变）
      await openUser(uid);

      // 2) 如果此刻看的就是“我的主页”，顺带刷新我自己（我的关注数实时变）
      if (me && uid === me.id) {
        await openUser(me.id);
      }

      // 3) 若顶部 tab 在 following，刷新关注流帖子
      if (getCurrentTab() === "following") {
        loadFeed("following");
      }

      toast(followed ? "已取关" : "已关注");
    }catch(e){
      toast(e.message||"失败");
    }
  };
}

function hydrateSuggestions(items){
  const sug = document.getElementById("suggestions");
  const set = new Map();
  for(const p of items){
    if(!set.has(p.author.id)) set.set(p.author.id, p.author);
    if(set.size>=5) break;
  }
  sug.innerHTML = [...set.values()].map(u=>`
    <div class="who">
      <img class="avatar" src="${esc(u.avatar||'data:,')}" alt="">
      <div style="flex:1;">
        <div><b>${esc(u.nickname||u.username||"用户")}</b></div>
        <div class="meta">@${esc(u.username||"")}</div>
      </div>
      <button class="btn btn-primary" onclick="openUser('${u.id}')">查看</button>
    </div>
  `).join("") || `<div class="muted">暂无推荐</div>`;
}

async function doSearch(){
  const q = document.getElementById("q").value.trim();
  if(!q) return;
  try{
    const data = await api(`/search?q=${encodeURIComponent(q)}`, { method:"GET", auth: !!session.get() });
    let items = data.items || [];
    items = await expandRefs(items);
    $.feed.innerHTML = items.map(renderCard).join("") || `<div class="empty">未找到相关内容</div>`;
    bindCardEvents();
  }catch(e){ toast(e.message || "搜索失败"); }
}


/* ====== Small helpers ====== */
function getAvatarPlaceholder(name=""){ return "data:,"; }

async function showPostPage(id){
  document.getElementById("composeInline").style.display = "none";
  document.querySelector(".topbar .tabs").style.display = "none";
  $.loading.hidden = false; $.empty.hidden = true; $.feed.innerHTML = "";
  try{
    const d = await api(`/posts/${id}`, { method:"GET", auth: !!session.get() });
    await expandOne(d);
    $.feed.innerHTML = renderPostPage(d);
    bindPostPageEvents(d);
    bindCardEvents();   // ★ 让评论卡片也有点赞/转发/删除/进详情
    applyClamp();       // ★ 再跑一次 clamp 计算
  }catch(e){
    // 如果是 not found，直接回首页并提示
    if (String(e.message||"").toLowerCase().includes("not found")) {
      toast("该帖子不存在或已被删除");
      // 回根，触发 handleRoute -> 恢复首页
      location.hash = "";
      return;
    }
    $.feed.innerHTML = `<div class="empty">加载失败：${esc(e.message||'')}</div>`;
  }finally{
    $.loading.hidden = true;
    applyClamp();
  }
}

function formatFullTime(iso){
  // e.g. "1:15 AM · Sep 29, 2025"
  if(!iso) return "";
  const dt = new Date(iso);
  const time = dt.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  const date = dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  return `${time} · ${date}`;
}

// ③ 单帖页（详情）
function renderPostPage(p){
  const me = session.get()?.user;
  const meAvatar = esc(me?.avatar || "data:,");
  const deletable = me && me.id === p.author.id;

  // 详情页图片：使用 tw-grid
  const renderPics = (imgs = []) => buildPics(imgs);

  // 可选：转发/引用块简化
  let repostBlock = "";
  if (p.kind === "repost" && p.repost_of) {
    repostBlock = htm`
      <div class="repost-block">
        <div class="repost-author">${esc(p.repost_of.author.nickname||p.repost_of.author.username||"用户")}</div>
        <div class="repost-text">${esc(p.repost_of.text||"")}</div>
      </div>`;
  }
  let quoteBlock = "";
  if (p.quote_of) {
    quoteBlock = htm`
      <div class="quote-block" onclick="goToPost('${esc(p.quote_of.id)}')" style="cursor:pointer">
        <div class="quote-author">${esc(p.quote_of.author.nickname||p.quote_of.author.username||"用户")}</div>
        <div class="quote-text">${esc(p.quote_of.text||"")}</div>
      </div>`;
  }

  // 直接复用帖子卡片渲染，让评论也拥有 点赞/转发/删除/进详情 能力
  const comments = (p.comments || []).map(renderCard).join("");

  return htm`
  <div class="post-topbar">
    <button class="icon-btn" id="btnBackTop" title="返回">←</button>
    <div class="title">Post</div>
    <button class="btn-ghost" id="btnReplyTop">Reply</button>
  </div>

  <div class="post-thread">
    <div class="row detail">
      <img class="rail avatar" src="${esc(p.author.avatar||'data:,')}" alt="">
      <div class="body">
        <div class="head">
          <span class="name">${esc(p.author.nickname||p.author.username||"用户")}</span>
          <span class="meta">· ${timeAgo(p.created_at)}</span>
        </div>
        <div class="text">${esc(p.text||"")}</div>

        ${renderPics(p.images)}
        ${repostBlock}
        ${quoteBlock}

        <div class="actions">
          <div class="action like ${p.liked?'liked':''}" data-id="${esc(p.id)}">❤️ <span>${p.likes||0}</span></div>
          <div class="action repost" title="转发" data-id="${esc(p.id)}">🔁 <span>${getShareCount(p)}</span></div>
          ${deletable ? `<div class="action del" title="删除" data-id="${esc(p.id)}">🗑️</div>` : ""}
          <div class="action open" onclick="$.openReply('${p.id}')">💬 回复</div>
        </div>
      </div>
    </div>

    <div class="meta-row">
      <div></div>
      <div class="timestamp">${esc(formatFullTime(p.created_at))}</div>
    </div>

    <div class="row composer">
      <img class="rail avatar" src="${meAvatar}" alt="">
      <div class="body">
        <div class="reply-inline">
          <img class="avatar" src="${meAvatar}" alt="" style="display:none">
          <div class="reply-editor">
            <textarea id="commentTextPage" rows="1" placeholder="Post your reply"></textarea>
            <div class="reply-tools">
              <div class="char-counter" id="replyCounter">280</div>
              <button type="button" id="btnCommentPage" class="btn btn-primary">评论</button>
            </div>
            <div class="upsell" id="replyUpsell">
              Upgrade to <b>Premium+</b> to write longer posts and Articles.
              <a class="link" href="javascript:;">Learn more</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${comments || `<div class="row"><div class="body"><div class="empty">暂无评论</div></div></div>`}
  </div>`;
}

function bindPostPageEvents(p){
  // 顶部栏：返回 & 右侧“回复”按钮
  const backTop = document.getElementById("btnBackTop");
  if (backTop) backTop.onclick = () => history.back();

  const replyTop = document.getElementById("btnReplyTop");
  if (replyTop) replyTop.onclick = () => $.openReply(p.id);

  // —— 正文点赞（单帖页）——
  const likeEl = document.querySelector(".post-thread .row.detail .action.like");
  if (likeEl) {
    likeEl.onclick = async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const me = await ensureLogin(); if (!me) return;
      toggleLike(p.id, likeEl);
    };
  }

  const repostEl = document.querySelector(".post-thread .row.detail .action.repost");
  if (repostEl) {
    repostEl.onclick = async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const me = await ensureLogin(); if (!me) return;
      $.openRepostChoice(p.id);
    };
  }

  // —— 删除（详情页，仅作者显示）—— //
  const delEl = document.querySelector(".post-thread .row.detail .action.del");
  if (delEl) {
    delEl.onclick = async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if (!confirm("确定删除这条帖子吗？")) return;
      try{
        await api(`/posts/${p.id}`, { method:"DELETE" });
        toast("已删除");
        // 删除后返回首页（或根据需要回个人页）
        location.hash = "";
      }catch(err){
        toast(err.message || "删除失败");
      }
    };
  }

  // —— 无边框回复框：自动增高 + 字数计数 + 超限 Upsell —— //
  setupExpandableComposer('#commentTextPage', '#replyCounter', '#replyUpsell', 280);

  // Enter 发送（Ctrl/Cmd/Shift+Enter 换行）
  const ta = document.getElementById('commentTextPage');
  if (ta) {
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        ev.preventDefault();
        const btn = document.getElementById('btnCommentPage');
        if (btn) btn.click();
      }
    });
  }

  // —— Reply 按钮：事件委托（避免重渲染失效）——
  if (!$.postDelegationBound) {
    $.postDelegationBound = true;

    $.feed.addEventListener('click', async (e) => {
      const replyBtn = e.target.closest('#btnCommentPage');
      if (!replyBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const me = await ensureLogin(); if (!me) return;

      const textEl = document.getElementById('commentTextPage');
      if (!textEl) return;

      const text = (textEl.value || '').trim();
      if (text.length === 0) { toast('回复不能为空'); return; }

      // 超限处理
      if (text.length > 280) {
        document.getElementById('replyUpsell')?.classList.add('show');
        toast('超出 280 字，精简后再发');
        return;
      }

      // 当前帖子 id 从路由取，最稳
      const match = location.hash.match(/^#\/post\/([0-9a-f]{24})$/i);
      const postId = match ? match[1] : p?.id;
      if (!postId) { toast('未找到帖子 ID'); return; }

      try{
        await api(`/posts/${postId}/comments`, { method:'POST', body:{ text } });
        textEl.value = '';
        toast('已回复');
        showPostPage(postId); // 刷新评论列表
      }catch(err){ toast(err.message || '评论失败'); }
    });
  }

  // ===== 内部工具：无边框编辑框自适应 =====
  function setupExpandableComposer(textSel, counterSel, upsellSel, limit = 280){
    const ta = document.querySelector(textSel);
    const counter = document.querySelector(counterSel);
    const upsell = document.querySelector(upsellSel);
    if(!ta) return;

    const autosize = ()=>{
      ta.style.height = 'auto';
      ta.style.overflowY = 'hidden';
      ta.style.height = Math.min(ta.scrollHeight, 1000) + 'px';
    };

    const update = ()=>{
      autosize();
      const len = ta.value.length;
      const remain = limit - len;
      if (counter){
        counter.textContent = remain;
        counter.classList.toggle('over', remain < 0);
      }
      if (upsell){
        upsell.classList.toggle('show', remain < 0);
      }
    };

    ta.addEventListener('input', update);
    ta.addEventListener('focus', update);
    window.addEventListener('resize', autosize, { passive: true });

    // 初次执行
    update();
  }
}

// 保留换行：先转义，再把 \n 变成 <br>
function nl2brSafe(s = "") {
  return esc(s).replace(/\n/g, "<br>");
}

// 如果你不想再“压缩空行”，把 cleanText 改成只做最小清洗：
function cleanText(s = "") {
  return String(s).replace(/\r\n/g, "\n"); // 仅统一换行符，别再合并空行
}

function renderTextWithClamp(text) {
  const html = nl2brSafe(cleanText(text || ""));
  return `
    <div class="text clamped">${html}</div>
    <div class="show-more"
         onclick="event.stopPropagation();
                  this.previousElementSibling.classList.remove('clamped');
                  this.remove()">Show more</div>
  `;
}

// ===== 计算并布置“脊柱”灰线 =====
function layoutSpine() {
  const dlg     = document.getElementById('replyDialog');
  if (!dlg || !dlg.open) return;               // 没开就不算

  const thread  = dlg.querySelector('.mf-thread');
  if (!thread) return;

  // 确保有一个 .mf-spine 元素
  let spine = thread.querySelector('.mf-spine');
  if (!spine) {
    spine = document.createElement('div');
    spine.className = 'mf-spine';
    thread.appendChild(spine);
  }

  // 关键节点
  const topAvatar = thread.querySelector('.mf-rail:not(.me) .avatar');
  const meAvatar  = thread.querySelector('.mf-rail.me .avatar');
  if (!topAvatar || !meAvatar) return;

  // 统一坐标系：把窗口坐标换算成 thread 内部坐标
  const tb = thread.getBoundingClientRect();
  const a  = topAvatar.getBoundingClientRect();
  const b  = meAvatar.getBoundingClientRect();

  const left   = (a.left + a.width / 2) - tb.left; // 中线
  const startY = (a.bottom - tb.top) + 8;          // 上头像底下 8px
  const endY   = (b.top    - tb.top) - 12;         // 下头像上方 12px

  const height = Math.max(0, endY - startY);

  // 写样式
  spine.style.left   = left + 'px';
  spine.style.top    = startY + 'px';
  spine.style.height = height + 'px';
}

// ===== 在合适时机绑定/解绑：窗口变化、输入变化、内容重排 =====
(function setupSpineObservers(){
  const dlg = document.getElementById('replyDialog');
  if (!dlg) return;

  // 关闭时移除监听
  dlg.addEventListener('close', () => {
    window.removeEventListener('resize', layoutSpine);
    if (window.__mfSpineRO) { window.__mfSpineRO.disconnect(); window.__mfSpineRO = null; }
  });

  // 打开时做一次，并挂监听（openReply 里也会主动 call 一次，双保险）
  dlg.addEventListener('toggle', () => { if (dlg.open) afterOpenSpineSetup(); });

  function afterOpenSpineSetup(){
    // 窗口尺寸变化
    window.addEventListener('resize', layoutSpine, { passive: true });

    // 容器尺寸变化（正文展开/折叠、图片加载、字体渲染等）
    const thread = dlg.querySelector('.mf-thread');
    if (thread) {
      // 复用全局 ResizeObserver，避免重复创建
      if (!window.__mfSpineRO) window.__mfSpineRO = new ResizeObserver(() => layoutSpine());
      window.__mfSpineRO.observe(thread);
    }

    // 输入框变化也触发布局（高度在自增）
    const ta = dlg.querySelector('#replyText');
    if (ta) {
      ta.addEventListener('input', layoutSpine);
      // 如果你有 autosize 的逻辑（设置 textarea.style.height），那块里也顺便调一次 layoutSpine()
    }

    // 等一帧，等 DOM 都渲染好了再算（包括 show-more 初始状态）
    requestAnimationFrame(() => {
      // 如果引用有图片，onload 后也重算
      dlg.querySelectorAll('.mf-quote img').forEach(img => {
        if (!img.complete) img.addEventListener('load', layoutSpine, { once:true });
      });
      layoutSpine();
    });
  }
})();
