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

/* ====== Utils ====== */
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

/* ====== Boot ====== */
/* ====== Boot ====== */
window.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  bindNav();
  bindComposer();
  bindAuth();
  renderMeBlock();
  applyTheme();
  handleRoute();                 // ← 用路由决定是首页还是单帖页
  window.addEventListener("hashchange", handleRoute);
});

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
      if(link==="home"){ setActiveTab("for_you"); loadFeed("for_you"); }
      if(link==="following"){ setActiveTab("following"); loadFeed("following"); }
      if(link==="profile"){ gotoMyProfile(); }
      if(link==="search"){ document.getElementById("q").focus(); }
    };
  });
  $.tabs.forEach(t=>{
    t.onclick = ()=>{ setActiveTab(t.dataset.tab); loadFeed(t.dataset.tab); };
  });
}
function setActiveTab(tab){
  $.tabs.forEach(t=>t.classList.toggle("is-active", t.dataset.tab===tab));
}

/* ====== Composer ====== */
function bindComposer(){
  $.postImages.onchange = async ()=>{
    $.imgPreview.innerHTML = "";
    const files = [...$.postImages.files].slice(0,3);
    for(const f of files){ const url = await fileToDataURL(f); const img = new Image(); img.src=url; $.imgPreview.append(img); }
  };
  $.btnPublish.onclick = publish;
}
async function publish(){
  const me = await ensureLogin(); if(!me) return;
  const text = ($.postText.value||"").trim();
  if(!text && $.postImages.files.length===0) return toast("写点什么吧");
  const fd = new FormData();
  fd.append("text", text.slice(0,500));
  [...$.postImages.files].slice(0,3).forEach(f=> fd.append("images", f));
  try{
    await api("/posts", { method:"POST", body: fd });
    $.postText.value=""; $.postImages.value=""; $.imgPreview.innerHTML="";
    toast("发布成功"); loadFeed(getCurrentTab());
  }catch(e){ toast(e.message || "发布失败"); }
}

/* ====== Feed ====== */
function getCurrentTab(){ return [...$.tabs].find(t=>t.classList.contains("is-active"))?.dataset.tab || "for_you"; }
async function loadFeed(tab="for_you"){
  $.loading.hidden=false; $.empty.hidden=true; $.feed.innerHTML="";
  try{
    const data = await api(`/feed?tab=${encodeURIComponent(tab)}`, { method:"GET", auth:false });
    const items = data.items || [];
    if(items.length===0){ $.empty.hidden=false; }
    $.feed.innerHTML = items.map(renderCard).join("");
    bindCardEvents();
    hydrateSuggestions(items);
  }catch(e){ toast(e.message || "加载失败"); }
  finally{ $.loading.hidden=true; }
}
function renderCard(p){
  const imgs = (p.images||[]).map(src=>`<img src="${esc(src)}" loading="lazy" alt="">`).join("");
  const me = session.get()?.user;
  const deletable = me && me.id===p.author.id;
  return htm`
  <article class="card clickable" data-id="${esc(p.id)}">
    <img class="avatar" src="${esc(p.author.avatar||'data:,')}" alt="">
    <div class="content">
      <div class="head">
        <span class="name">${esc(p.author.nickname || p.author.username || "用户")}</span>
        <span class="meta">· ${timeAgo(p.created_at)}</span>
      </div>
      <div class="text">${esc(p.text||"")}</div>
      <div class="pics">${imgs}</div>
      <div class="actions">
        <div class="action open">💬 <span>${p.comments_count||0}</span></div>
        <div class="action like ${p.liked?'liked':''}">❤️ <span>${p.likes||0}</span></div>
        ${deletable ? `<div class="action del" title="删除">🗑️</div>` : ""}
      </div>
    </div>
  </article>`;
}

function bindCardEvents(){
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
      const card = e.target.closest(".card");
      const id = card.dataset.id;
      const liked = b.classList.contains("liked");
      try{
        await api(`/posts/${id}/like`, { method: liked?"DELETE":"POST" });
        b.classList.toggle("liked");
        const num = b.querySelector("span"); num.textContent = (+num.textContent || 0) + (liked?-1:1);
      }catch(err){ toast(err.message || "失败"); }
    };
  });
  document.querySelectorAll(".card .del").forEach(b=>{
    b.onclick = async (e)=>{
      e.stopPropagation();
      const id = e.target.closest(".card").dataset.id;
      if(!id || id==='null' || id==='undefined' || id.length!==24){ toast("这条帖子数据异常，已过滤"); return; }
      if(!confirm("确定删除这条帖子吗？")) return;
      try{
        await api(`/posts/${id}`, { method:"DELETE" });
        toast("已删除"); loadFeed(getCurrentTab());
      }catch(err){ toast(err.message || "删除失败"); }
    };
  });
}

//-----回复弹窗-----//
$.closeReply = ()=> $.replyDialog.close();

function renderQuoted(p){
  const name = esc(p.author?.nickname || p.author?.username || "用户");
  return `
    <div class="head">${name} <span class="meta">· ${timeAgo(p.created_at)}</span></div>
    <div class="text">${esc(p.text || "")}</div>
  `;
}

/** 打开回复弹窗并绑定提交 */
$.openReply = async (postId)=>{
  const me = await ensureLogin(); if(!me) return;
  try{
    const d = await api(`/posts/${postId}`, { method:"GET", auth:true });
    $.replyHost.innerHTML = renderQuoted(d);
    $.replyAvatar.src = esc(session.get()?.user?.avatar || "data:,");
    $.replyText.value = "";
    $.replyDialog.showModal();

    // 提交
    $.btnReply.onclick = async ()=>{
      const text = ($.replyText.value||"").trim();
      if(!text) return toast("回复不能为空");
      try{
        await api(`/posts/${postId}/comments`, { method:"POST", body:{ text } });
        $.closeReply();
        // 刷新当前视图
        if (location.hash === `#/post/${postId}`) { showPostPage(postId); }
        else { goToPost(postId); } // 发送后跳到该帖页面
        toast("已回复");
      }catch(e){ toast(e.message || "发送失败"); }
    };

    // Enter 发送，Ctrl+Enter 换行
    $.replyText.onkeydown = (ev)=>{
      if(ev.key==="Enter" && !ev.ctrlKey && !ev.shiftKey){
        ev.preventDefault(); $.btnReply.click();
      }
      if(ev.key==="Enter" && (ev.ctrlKey || ev.metaKey)){
        ev.preventDefault();
        const t = $.replyText, s = t.selectionStart, v = t.value;
        t.value = v.slice(0,s) + "\n" + v.slice(s);
        t.selectionStart = t.selectionEnd = s+1;
      }
    };

  }catch(e){ toast(e.message || "打开失败"); }
};

/* ====== Router ====== */
function handleRoute(){
  const m = location.hash.match(/^#\/post\/([0-9a-f]{24})$/i);
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
  try{
    const d = await api(`/users/${uid}`, { method:"GET", auth: !!session.get() });
    $.feed.innerHTML = renderProfile(d);
    bindProfileActions(d);
  }catch(e){ toast(e.message||"打开失败"); }
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
      await api(`/users/${uid}/follow`, { method: followed?"DELETE":"POST" });
      toast(followed?"已取关":"已关注");
      openUser(uid);
    }catch(e){ toast(e.message||"失败"); }
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
    $.feed.innerHTML = data.items.map(renderCard).join("") || `<div class="empty">未找到相关内容</div>`;
    bindCardEvents();
  }catch(e){ toast(e.message || "搜索失败"); }
}

/* ====== Small helpers ====== */
function getAvatarPlaceholder(name=""){ return "data:,"; }

async function showPostPage(id){
  // 单帖页隐藏顶部 tabs / 发帖栏
  document.getElementById("composeInline").style.display = "none";
  document.querySelector(".topbar .tabs").style.display = "none";
  $.loading.hidden = false; $.empty.hidden = true; $.feed.innerHTML = "";
  try{
    const d = await api(`/posts/${id}`, { method:"GET", auth: !!session.get() });
    $.feed.innerHTML = renderPostPage(d);
    bindPostPageEvents(d);
  }catch(e){
    $.feed.innerHTML = `<div class="empty">加载失败：${esc(e.message||'')}</div>`;
  }finally{
    $.loading.hidden = true;
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

function renderPostPage(p){
  const imgs = (p.images||[]).map(src=>`<img src="${esc(src)}" loading="lazy" alt="">`).join("");
  const meAvatar = esc(session.get()?.user?.avatar || "data:,");
  const comments = (p.comments||[]).map(c=>htm`
    <div class="row comment">
      <img class="rail avatar" src="${esc(c.author.avatar||'data:,')}" alt="">
      <div class="body">
        <div class="head">
          <span class="name">${esc(c.author.nickname||c.author.username||"用户")}</span>
          <span class="meta">· ${timeAgo(c.created_at)}</span>
        </div>
        <div class="text">${esc(c.text||"")}</div>
      </div>
    </div>
  `).join("");

  return htm`
  <!-- 顶部栏：左返回，右回复 -->
  <div class="post-topbar">
    <button class="icon-btn" id="btnBackTop" title="返回">←</button>
    <div class="title">Post</div>
    <button class="btn-ghost" id="btnReplyTop">Reply</button>
  </div>

  <div class="post-thread">
    <!-- 原帖 -->
    <div class="row detail">
      <img class="rail avatar" src="${esc(p.author.avatar||'data:,')}" alt="">
      <div class="body">
        <div class="head">
          <span class="name">${esc(p.author.nickname||p.author.username||"用户")}</span>
          <span class="meta">· ${timeAgo(p.created_at)}</span>
        </div>
        <div class="text">${esc(p.text||"")}</div>
        <div class="pics">${imgs}</div>
        <div class="actions">
          <div class="action like ${p.liked?'liked':''}" data-id="${esc(p.id)}">❤️ <span>${p.likes||0}</span></div>
          <div class="action open" onclick="$.openReply('${p.id}')">💬 回复</div>
        </div>
      </div>
    </div>

    <!-- 时间行（和推特一样在正文下单独一行） -->
    <div class="meta-row">
      <div></div>
      <div class="timestamp">${esc(formatFullTime(p.created_at))}</div>
    </div>

    <!-- 回复输入行：无边框 + 展开动画 + 计数 + Upsell -->
    <div class="row composer">
      <img class="rail avatar" src="${meAvatar}" alt="">
      <div class="body">
        <div class="reply-inline">
          <img class="avatar" src="${meAvatar}" alt="" style="display:none"> <!-- 兼容保留，不显示 -->
          <div class="reply-editor">
            <textarea id="commentTextPage" rows="1" placeholder="Post your reply"></textarea>

            <div class="reply-tools">
              <div class="char-counter" id="replyCounter">280</div>
              <button id="btnCommentPage" class="btn btn-primary">Reply</button>
            </div>

            <div class="upsell" id="replyUpsell">
              Upgrade to <b>Premium+</b> to write longer posts and Articles.
              <a class="link" href="javascript:;">Learn more</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 评论列表 -->
    ${comments || `<div class="row"><div class="body"><div class="empty">暂无评论</div></div></div>`}
  </div>`;
}

function bindPostPageEvents(p){
  // 顶部栏：返回 & 右侧“回复”按钮
  const backTop = document.getElementById("btnBackTop");
  if(backTop) backTop.onclick = ()=> history.back();
  const replyTop = document.getElementById("btnReplyTop");
  if(replyTop) replyTop.onclick = ()=> $.openReply(p.id);

  // 原有点赞
  const likeEl = document.querySelector(".post-page .action.like") 
              || document.querySelector(".post-thread .action.like");
  if(likeEl){
    likeEl.onclick = async ()=>{
      const me = await ensureLogin(); if(!me) return;
      const liked = likeEl.classList.contains("liked");
      try{
        await api(`/posts/${p.id}/like`, { method: liked?"DELETE":"POST" });
        likeEl.classList.toggle("liked");
        const num = likeEl.querySelector("span");
        num.textContent = (+num.textContent || 0) + (liked?-1:1);
      }catch(e){ toast(e.message||"失败"); }
    };
  }

  // 底部“回复”按钮（页面内直接发）
  const btn = document.getElementById("btnCommentPage");
  const ta  = document.getElementById("commentTextPage");
  if(btn && ta){
    btn.onclick = async ()=>{
      const me = await ensureLogin(); if(!me) return;
      const text = (ta.value||"").trim();
  
      // 280 超限检查
      if(text.length === 0) return toast("回复不能为空");
      if(text.length > 280){
        document.getElementById('replyUpsell')?.classList.add('show');
        toast("超出 280 字，精简后再发");
        return;
      }
  
      try{
        await api(`/posts/${p.id}/comments`, { method:"POST", body:{ text } });
        ta.value = "";
        showPostPage(p.id); // 刷新
      }catch(e){ toast(e.message||"评论失败"); }
    };
  }


// 启用无边框编辑框的自动增高与计数
setupExpandableComposer('#commentTextPage', '#replyCounter', '#replyUpsell', 280);

function setupExpandableComposer(textSel, counterSel, upsellSel, limit=280){
  const ta = document.querySelector(textSel);
  const counter = document.querySelector(counterSel);
  const upsell = document.querySelector(upsellSel);
  if(!ta) return;

  const autosize = ()=>{
    ta.style.height = 'auto';
    // 上限防止无限拉长，可按需调整（600px ~ 8~10行）
    ta.style.height = Math.min(ta.scrollHeight, 600) + 'px';
  };

  const update = ()=>{
    autosize();
    const len = ta.value.length;
    const remain = limit - len;
    if(counter){
      counter.textContent = remain;
      counter.classList.toggle('over', remain < 0);
    }
    if(upsell){
      upsell.classList.toggle('show', remain < 0);
    }
  };

  ta.addEventListener('input', update);
  ta.addEventListener('focus', update);
  // 初次渲染
  update();
}
}
