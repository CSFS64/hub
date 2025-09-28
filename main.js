/* =========================
 * 切换：后端/本地
 * ========================= */
const USE_BACKEND = false; // 后端写好前，可设为 false 先演示
const API_BASE = "https://mini-forum-backend.20060303jjc.workers.dev"; // ← 改成你的 Worker 域名
const MAX_IMAGES = 3;

/* =========================
 * 全局状态（简单 SPA ）
 * ========================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  me: null,          // 当前已登录用户
  token: null,       // JWT
  feed: [],          // 首页“推荐”
  followingFeed: [], // “关注”流
  viewing: "home",   // home | following | me | post
  postDetail: null,  // 当前查看的帖子
  profileUser: null, // 当前查看的个人主页用户
};

/* =========================
 * 工具
 * ========================= */
function toast(msg, ms = 1800) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), ms);
}

function setAuthVisible(isAuthed) {
  $("#btnAuth").classList.toggle("hidden", isAuthed);
  $("#btnLogout").classList.toggle("hidden", !isAuthed);
}

function saveSession() {
  localStorage.setItem("mini_forum_session", JSON.stringify({
    token: state.token,
    me: state.me,
  }));
}
function loadSession() {
  try {
    const raw = localStorage.getItem("mini_forum_session");
    if (!raw) return;
    const { token, me } = JSON.parse(raw);
    state.token = token; state.me = me;
    setAuthVisible(!!token);
  } catch {}
}

async function api(path, { method = "GET", body, formData, auth = true } = {}) {
  if (!USE_BACKEND) return mockApi(path, { method, body, formData });
  const headers = new Headers();
  if (!formData) headers.set("content-type", "application/json; charset=utf-8");
  if (auth && state.token) headers.set("authorization", `Bearer ${state.token}`);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: formData ? formData : (body ? JSON.stringify(body) : undefined),
    credentials: "omit",
  });
  if (!res.ok) {
    const detail = await safeJson(res);
    throw new Error(detail?.error || `HTTP ${res.status}`);
  }
  return safeJson(res);
}
async function safeJson(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok: true, text }; }
}

/* =========================
 * 事件绑定
 * ========================= */
window.addEventListener("DOMContentLoaded", () => {
  bindTopbar();
  bindDialogs();
  loadSession();
  routeTo("home"); // 默认进首页
});

function bindTopbar() {
  $("#btnHome").onclick = () => routeTo("home");
  $("#btnFollowing").onclick = () => routeTo("following");
  $("#btnProfile").onclick = () => {
    if (!state.me) return openAuth();
    openProfile(state.me.id);
  };
  $("#btnNewPost").onclick = () => openPostDialog();
  $("#btnAuth").onclick = () => openAuth();
  $("#btnLogout").onclick = () => logout();
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch(e.target.value.trim());
  });
}

function bindDialogs() {
  const authDialog = $("#authDialog");
  // 切换标签
  $$(".tab", authDialog).forEach(btn => {
    btn.onclick = () => {
      $$(".tab", authDialog).forEach(b => b.classList.toggle("active", b===btn));
      const key = btn.dataset.tab;
      $$(".tabpanel", authDialog).forEach(p => p.classList.toggle("active", p.dataset.panel === key));
    };
  });

  $("#btnLogin").onclick = async (e) => {
    e.preventDefault();
    try {
      const account = $("#loginAccount").value.trim();
      const password = $("#loginPassword").value;
      const data = await api("/auth/login", { method:"POST", body: { account, password }, auth:false });
      onAuthSuccess(data);
      authDialog.close();
      toast("登录成功");
    } catch (err) { toast(err.message || "登录失败"); }
  };
  $("#btnSendOtpLogin").onclick = () => sendOtp($("#phoneLoginNumber").value.trim());
  $("#btnPhoneLogin").onclick = async (e) => {
    e.preventDefault();
    try {
      const phone = $("#phoneLoginNumber").value.trim();
      const code = $("#phoneLoginCode").value.trim();
      const data = await api("/auth/login_phone", { method:"POST", body: { phone, code }, auth:false });
      onAuthSuccess(data);
      authDialog.close();
      toast("登录成功");
    } catch (err) { toast(err.message || "登录失败"); }
  };

  $("#btnSendOtpSignup").onclick = () => sendOtp($("#signupPhone").value.trim());
  $("#btnSignup").onclick = async (e) => {
    e.preventDefault();
    try {
      const phone = $("#signupPhone").value.trim();
      const code = $("#signupCode").value.trim();
      const nickname = $("#signupNickname").value.trim();
      const password = $("#signupPassword").value;
      const data = await api("/auth/signup", { method:"POST", body: { phone, code, nickname, password }, auth:false });
      onAuthSuccess(data);
      authDialog.close();
      toast("注册成功");
    } catch (err) { toast(err.message || "注册失败"); }
  };

  // 发帖
  const postDialog = $("#postDialog");
  $("#postSubmit").onclick = async (e) => {
    e.preventDefault();
    try {
      if (!state.me) { openAuth(); return; }
      const text = $("#postText").value.trim();
      if (!text && !filesSelected()) { toast("内容或图片至少一项"); return; }
      const fd = new FormData();
      fd.append("text", text);
      for (const id of ["postImg1","postImg2","postImg3"]) {
        const f = $("#"+id).files?.[0];
        if (f) fd.append("images", f, f.name);
      }
      await api("/posts", { method:"POST", formData: fd });
      toast("发布成功");
      postDialog.close();
      clearPostDialog();
      refreshFeed();
    } catch (err) { toast(err.message || "发布失败"); }
  };
}

function filesSelected() {
  return ["postImg1","postImg2","postImg3"].some(id => $("#"+id).files?.length);
}

/* =========================
 * 视图路由
 * ========================= */
async function routeTo(view) {
  state.viewing = view;
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view || (view==="home" && b.id==="btnHome")));
  $("#feedView").classList.add("hidden");
  $("#profileView").classList.add("hidden");
  $("#postDetailView").classList.add("hidden");

  if (view === "home") {
    $("#feedView").classList.remove("hidden");
    await refreshFeed();
  } else if (view === "following") {
    $("#feedView").classList.remove("hidden");
    await refreshFollowing();
  }
}

async function refreshFeed() {
  const data = await api("/feed?tab=for_you", { method:"GET", auth:falseIfNoToken() });
  state.feed = data.items || [];
  renderFeed("#feedView", state.feed);
}
async function refreshFollowing() {
  const data = await api("/feed?tab=following", { method:"GET", auth:falseIfNoToken() });
  state.followingFeed = data.items || [];
  renderFeed("#feedView", state.followingFeed);
}
function falseIfNoToken() {
  return !!state.token;
}

/* =========================
 * 渲染
 * ========================= */
function renderFeed(containerSel, list){
  const el = $(containerSel);
  el.innerHTML = `<h2>${state.viewing==="following"?"关注":"推荐"}</h2>` +
    list.map(renderPostCard).join("") || "<div class='card'>暂无内容</div>";
  bindPostActionButtons(el);
}

function renderPostCard(p){
  const me = state.me;
  const liked = !!p.liked;
  const canDelete = me && me.id === p.author.id;
  const imgs = (p.images||[]).map(src => `<img src="${src}" alt="" style="max-width:100%; border:1px solid var(--border); border-radius:12px; margin-top:8px">`).join("");
  return `
  <article class="card" data-post="${p.id}">
    <div class="row">
      <img class="avatar" src="${p.author.avatar || 'https://avatar.iran.liara.run/public'}" alt="">
      <div class="content">
        <div><strong class="link" data-user="${p.author.id}" style="cursor:pointer">${escapeHtml(p.author.nickname || p.author.username)}</strong>
          <span class="meta"> · @${escapeHtml(p.author.username)} · ${timeAgo(p.created_at)}</span></div>
        ${p.text ? `<blockquote>${escapeHtml(p.text)}</blockquote>` : ""}
        ${imgs}
        <div class="actions">
          <button class="btn-detail" data-id="${p.id}">评论(${p.comments_count||0})</button>
          <button class="btn-like ${liked?'liked':''}" data-id="${p.id}">赞(${p.likes||0})</button>
          <button class="btn-follow" data-user="${p.author.id}">${p.author.following ? "已关注" : "关注"}</button>
          ${canDelete ? `<button class="btn-delete danger" data-id="${p.id}">删除</button>` : ""}
        </div>
      </div>
    </div>
  </article>`;
}

function bindPostActionButtons(root=document){
  // 进入详情
  $$(".btn-detail", root).forEach(b => b.onclick = () => openPostDetail(b.dataset.id));
  // 点赞
  $$(".btn-like", root).forEach(b => b.onclick = () => toggleLike(b.dataset.id, b));
  // 删除
  $$(".btn-delete", root).forEach(b => b.onclick = () => deletePost(b.dataset.id));
  // 关注
  $$(".btn-follow", root).forEach(b => b.onclick = () => toggleFollow(b.dataset.user, b));
  // 点击用户名进入主页
  $$(".link[data-user]", root).forEach(a => a.onclick = () => openProfile(a.dataset.user));
}

/* =========================
 * 详情页 & 评论
 * ========================= */
async function openPostDetail(id){
  const data = await api(`/posts/${id}`, { method:"GET", auth:falseIfNoToken() });
  state.postDetail = data;
  $("#feedView").classList.add("hidden");
  $("#profileView").classList.add("hidden");
  const v = $("#postDetailView");
  v.classList.remove("hidden");
  v.innerHTML = `
    <div class="card">${renderPostCard(data)}</div>
    <div class="card">
      <h3>评论 · ${data.comments?.length||0}</h3>
      <div id="comments">${(data.comments||[]).map(renderComment).join("") || "<div class='meta'>还没有评论</div>"}</div>
      <div class="row" style="margin-top:8px">
        <img class="avatar" src="${state.me?.avatar || 'https://avatar.iran.liara.run/public'}" alt="">
        <div class="content">
          <textarea id="replyText" placeholder="发表你的看法…"></textarea>
          <div class="actions" style="justify-content:flex-end">
            <button class="primary" id="sendReply">回复</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bindPostActionButtons(v);
  $("#sendReply").onclick = async () => {
    if (!state.me) return openAuth();
    const text = $("#replyText").value.trim();
    if (!text) return toast("请输入内容");
    await api(`/posts/${id}/comments`, { method:"POST", body:{ text } });
    toast("已发布评论");
    openPostDetail(id); // 重新拉取
  };
}

function renderComment(c){
  return `
    <div class="row" style="margin:10px 0">
      <img class="avatar" src="${c.author.avatar || 'https://avatar.iran.liara.run/public'}">
      <div class="content">
        <div><strong class="link" data-user="${c.author.id}" style="cursor:pointer">${escapeHtml(c.author.nickname || c.author.username)}</strong>
          <span class="meta"> · @${escapeHtml(c.author.username)} · ${timeAgo(c.created_at)}</span></div>
        ${c.text ? `<blockquote>${escapeHtml(c.text)}</blockquote>` : ""}
      </div>
    </div>
  `;
}

/* =========================
 * 个人主页
 * ========================= */
async function openProfile(userId){
  const data = await api(`/users/${userId}`, { method:"GET", auth:falseIfNoToken() });
  state.profileUser = data.user;
  state.viewing = "me";
  $("#feedView").classList.add("hidden");
  $("#postDetailView").classList.add("hidden");
  const el = $("#profileView");
  el.classList.remove("hidden");
  const u = data.user;
  el.innerHTML = `
    <section class="card">
      <div class="row">
        <img class="avatar" src="${u.avatar || 'https://avatar.iran.liara.run/public'}">
        <div class="content">
          <div><strong>${escapeHtml(u.nickname || u.username)}</strong> <span class="meta"> @${escapeHtml(u.username)}</span></div>
          ${u.bio ? `<div class="meta" style="margin-top:4px">${escapeHtml(u.bio)}</div>` : ""}
          <div class="grid-2" style="margin-top:8px">
            <div class="stat">关注 ${u.following_count||0}</div>
            <div class="stat">粉丝 ${u.followers_count||0}</div>
          </div>
          ${ state.me && state.me.id !== u.id
              ? `<div class="actions" style="margin-top:8px">
                    <button class="btn-follow" data-user="${u.id}">${u.following ? "已关注" : "关注"}</button>
                 </div>`
              : "" }
        </div>
      </div>
    </section>
    <section>
      <h2>帖子</h2>
      ${ (data.posts||[]).map(renderPostCard).join("") || "<div class='card'>暂无帖子</div>" }
    </section>
  `;
  bindPostActionButtons(el);
}

/* =========================
 * 动作：发帖/删帖/点赞/关注
 * ========================= */
function openPostDialog(){
  if (!state.me) return openAuth();
  clearPostDialog();
  $("#postDialog").showModal();
}
function clearPostDialog(){
  $("#postText").value = "";
  ["postImg1","postImg2","postImg3"].forEach(id => $("#"+id).value = "");
}
async function deletePost(postId){
  if (!confirm("确定删除这条帖子？")) return;
  await api(`/posts/${postId}`, { method:"DELETE" });
  toast("已删除");
  // 刷新当前视图
  if (!$("#feedView").classList.contains("hidden")) {
    state.viewing === "following" ? refreshFollowing() : refreshFeed();
  } else if (!$("#profileView").classList.contains("hidden")) {
    openProfile(state.profileUser.id);
  } else if (!$("#postDetailView").classList.contains("hidden")) {
    routeTo("home");
  }
}
async function toggleLike(postId, btn){
  if (!state.me) return openAuth();
  const liked = btn.classList.contains("liked");
  await api(`/posts/${postId}/like`, { method: liked ? "DELETE" : "POST" });
  // 简单前端更新
  const text = btn.textContent;
  const num = (text.match(/\d+/)||[0])[0]|0;
  btn.textContent = `赞(${liked? num-1: num+1})`;
  btn.classList.toggle("liked", !liked);
}
async function toggleFollow(userId, btn){
  if (!state.me) return openAuth();
  const followed = btn.textContent.includes("已关注");
  await api(`/users/${userId}/follow`, { method: followed ? "DELETE":"POST" });
  btn.textContent = followed ? "关注" : "已关注";
}

/* =========================
 * 搜索（非常简单：交由后端）
 * ========================= */
async function doSearch(q){
  if (!q) return;
  const res = await api(`/search?q=${encodeURIComponent(q)}`, { method:"GET", auth:falseIfNoToken() });
  // 简单把结果渲染成 feed 样式
  $("#feedView").classList.remove("hidden");
  $("#profileView").classList.add("hidden");
  $("#postDetailView").classList.add("hidden");
  $("#feedView").innerHTML = `<h2>搜索结果</h2>` + (res.items||[]).map(renderPostCard).join("") || "<div class='card'>没有找到</div>";
  bindPostActionButtons($("#feedView"));
}

/* =========================
 * 认证
 * ========================= */
function openAuth(){ $("#authDialog").showModal(); }
async function sendOtp(phone){
  if (!phone) return toast("请输入手机号");
  try{
    await api("/auth/send_otp", { method:"POST", body:{ phone }, auth:false });
    toast("验证码已发送");
  }catch(err){ toast(err.message || "发送失败"); }
}
function onAuthSuccess(data){
  state.token = data.token;
  state.me = data.user;
  setAuthVisible(true);
  saveSession();
  refreshFeed();
}
function logout(){
  state.token = null; state.me = null;
  saveSession();
  setAuthVisible(false);
  toast("已退出");
  routeTo("home");
}

/* =========================
 * 小工具
 * ========================= */
function timeAgo(iso){
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now()-t)/1000);
  if (s<60) return `${s}秒前`;
  const m = Math.floor(s/60); if (m<60) return `${m}分钟前`;
  const h = Math.floor(m/60); if (h<24) return `${h}小时前`;
  const d = Math.floor(h/24); if (d<7) return `${d}天前`;
  return new Date(iso).toLocaleString();
}
function escapeHtml(s=""){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =========================
 * 本地演示 mock（后端未就绪时）
 * ========================= */
async function mockApi(path, { method="GET", body, formData }={}){
  // 极简模拟，数据落在 localStorage
  const store = JSON.parse(localStorage.getItem("mf_mock") || `{"users":[],"posts":[],"seq":1}`);
  const save = ()=>localStorage.setItem("mf_mock", JSON.stringify(store));
  const ok = (d)=>Promise.resolve(d);

  // 认证
  if (path==="/auth/send_otp" && method==="POST") return ok({ ok:true });
  if (path==="/auth/signup" && method==="POST"){
    const id = String(store.seq++);
    const username = "u"+id;
    const user = { id, username, nickname: body.nickname, phone: body.phone };
    store.users.push(user); save();
    state.token = "mock."+id; state.me = user; saveSession();
    return ok({ token: state.token, user });
  }
  if (path==="/auth/login" && method==="POST"){
    const user = store.users.find(u => u.username===body.account || u.phone===body.account);
    if (!user) throw new Error("账号不存在");
    state.token = "mock."+user.id; state.me = user; saveSession();
    return ok({ token: state.token, user });
  }
  if (path==="/auth/login_phone" && method==="POST"){
    const user = store.users.find(u => u.phone===body.phone) || (() => {
      const id = String(store.seq++); const username="u"+id;
      const u = { id, username, nickname:"用户"+id, phone: body.phone }; store.users.push(u); return u;
    })();
    save(); state.token = "mock."+user.id; state.me = user; saveSession();
    return ok({ token: state.token, user });
  }

  // Feed
  if (path.startsWith("/feed")) {
    const items = store.posts.slice().reverse();
    return ok({ items });
  }

  // 发帖
  if (path==="/posts" && method==="POST"){
    const id = String(store.seq++);
    const text = formData ? (formData.get("text")||"").toString() : (body?.text||"");
    const images = [];
    const p = { id, text, images, author: state.me, created_at: new Date().toISOString(), likes:0, comments_count:0 };
    store.posts.push(p); save();
    return ok(p);
  }

  if (path.startsWith("/posts/") && method==="DELETE"){
    const id = path.split("/")[2];
    const idx = store.posts.findIndex(x=>x.id===id);
    if (idx>=0) store.posts.splice(idx,1); save();
    return ok({ ok:true });
  }

  if (path.startsWith("/posts/") && path.endsWith("/like")){
    const id = path.split("/")[2];
    const p = store.posts.find(x=>x.id===id); if (!p) throw new Error("not found");
    if (method==="POST") p.likes++; else p.likes=Math.max(0, p.likes-1);
    save(); return ok({ ok:true });
  }

  if (path.startsWith("/posts/") && method==="GET"){
    const id = path.split("/")[2];
    const p = store.posts.find(x=>x.id===id);
    return ok({ ...p, comments: p.comments||[] });
  }

  if (path.startsWith("/posts/") && path.endsWith("/comments") && method==="POST"){
    const id = path.split("/")[2];
    const p = store.posts.find(x=>x.id===id); if (!p) throw new Error("not found");
    p.comments = p.comments || [];
    p.comments.push({ id:String(store.seq++), text: body.text, created_at:new Date().toISOString(), author: state.me });
    p.comments_count = p.comments.length; save();
    return ok({ ok:true });
  }

  if (path.startsWith("/users/") && path.endsWith("/follow")){
    return ok({ ok:true });
  }

  if (path.startsWith("/users/") && method==="GET"){
    const id = path.split("/")[2];
    const user = store.users.find(u=>u.id===id) || store.users[0];
    const posts = store.posts.filter(p=>p.author.id===user.id).slice().reverse();
    return ok({ user: { ...user, followers_count: 0, following_count: 0, following:false }, posts });
  }

  if (path.startsWith("/search")) {
    const q = decodeURIComponent(path.split("?q=")[1]||"").toLowerCase();
    const items = store.posts.filter(p => p.text?.toLowerCase().includes(q)).slice().reverse();
    return ok({ items });
  }

  throw new Error("Mock 未实现的接口: " + method + " " + path);
}

/* =========================
 * 与后端对齐的接口（建议）
 * =========================
  POST   /auth/send_otp            { phone }
  POST   /auth/signup              { phone, code, nickname, password }
  POST   /auth/login               { account, password }           // account 可是 username 或 phone
  POST   /auth/login_phone         { phone, code }
  GET    /me
  GET    /feed?tab=for_you|following
  POST   /posts                    multipart/form-data: text, images[]
  GET    /posts/:id
  DELETE /posts/:id
  POST   /posts/:id/like
  DELETE /posts/:id/like
  POST   /posts/:id/comments       { text }
  GET    /users/:id
  POST   /users/:id/follow
  DELETE /users/:id/follow
*/
