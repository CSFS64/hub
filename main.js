/* main.js（已接入 Cloudflare Worker 后端）
 * - 首页推荐/关注流
 * - 发帖（文字 + 最多 3 张图，先上传到 R2）
 * - 个人主页（头像/封面/简介从后端读写），关注/取关
 * - 帖子详情 + “线程”逻辑（与后端保持一致）
 * - 未登录时弹出手机号/验证码对话框完成登录（验证码看 wrangler tail 日志）
 *
 * 切换数据源：
 *   USE_BACKEND = true  -> 使用后端 API（生产）
 *   USE_BACKEND = false -> 使用本地 localStorage（演示）
 */

/* =========================
 * 切换：后端/本地
 * ========================= */
const USE_BACKEND = true;
const API_BASE = "https://mini-forum-backend.20060303jjc.workers.dev"; // 你的 Worker 域名

/* =========================
 * 小工具
 * ========================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const now = () => Date.now();
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'u' + Math.random().toString(36).slice(2);
const fmtTime = (ts) => {
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}秒前`;
  if (diff < 3600) return `${Math.floor(diff/60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff/3600)}小时前`;
  return `${d.getFullYear()}-${(d.getMonth()+1+'').padStart(2,'0')}-${(d.getDate()+'').padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
};
const escapeHtml = s =>
  String(s ?? "").replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])
  );
const linkify = (text) => text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

function toast(text) {
  const el = $('#toast');
  if (!el) return alert(text);
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

/* =========================
 * 后端 API 包装（含带 Cookie）
 * ========================= */
async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = isForm ? (opts.headers || {}) : { "content-type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include", // 关键：跨站也带上/接收 Cookie
    ...opts,
    headers
  });
  const ctype = res.headers.get("content-type") || "";
  const data = ctype.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok || (data && data.ok === false)) {
    const msg = (data && data.error) ? data.error : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

/* 登录流程（简易弹窗版） */
async function ensureLogin() {
  if (!USE_BACKEND) return; // 本地演示时不强制登录
  try {
    const me = await api("/me");
    if (me && me.user) return; // 已登录
  } catch (e) {
    // ignore，继续下一步
  }
  // 未登录 -> 触发短信流程
  const phone = prompt("请输入手机号（国际格式，例如 +8613800138000）：");
  if (!phone) return;
  await api("/auth/request_code", { method: "POST", body: JSON.stringify({ phone }) });
  toast("验证码已发送（开发阶段请在 wrangler tail 日志查看）");
  const code = prompt("请输入 6 位验证码：");
  if (!code) return;
  // 首次需要昵称
  const nickname = prompt("首次登录，请输入你的昵称：") || "新用户";
  await api("/auth/verify_code", { method: "POST", body: JSON.stringify({ phone, code, nickname }) });
  toast("登录成功");
}

/* =========================
 * 本地演示存储（当 USE_BACKEND=false）
 * ========================= */
const Storage = {
  key: 'mini_forum_demo_v1',
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || null; } catch { return null; } },
  save(state) { localStorage.setItem(this.key, JSON.stringify(state)); },
};

const createInitialState = () => {
  const userA = { id: uuid(), nickname: 'Alice', bio: '热爱前端与猫', avatar: '', cover: '', following: [], followers: [], createdAt: now() };
  const userB = { id: uuid(), nickname: 'Bob', bio: '徒步/胶片摄影', avatar: '', cover: '', following: [], followers: [], createdAt: now() };
  const me    = { id: uuid(), nickname: '你', bio: '点击头像可编辑资料', avatar: '', cover: '', following: [userA.id], followers: [], createdAt: now() };
  userA.followers.push(me.id);
  const posts = [
    { id: uuid(), authorId: userA.id, content: '第一条贴子，欢迎来到小站～', images: [], createdAt: now()-7200000, replyToId: null, threadRootId: null, likes: 2, reposts: 0, replies: 0 },
    { id: uuid(), authorId: userB.id, content: '今天的天空很蓝。', images: [], createdAt: now()-3600000, replyToId: null, threadRootId: null, likes: 1, reposts: 0, replies: 0 },
  ];
  return { users: { [me.id]: me, [userA.id]: userA, [userB.id]: userB }, posts, currentUserId: me.id, version: 1 };
};

let DB = USE_BACKEND ? null : (Storage.load() || createInitialState());
if (!USE_BACKEND) Storage.save(DB);

/* 便捷选择器（本地模式用） */
const getUserLocal = (id) => DB.users[id];
const getMeLocal   = () => DB.users[DB.currentUserId];

/* =========================
 * 统一的数据适配层
 *   - 当 USE_BACKEND=true 时，使用后端
 *   - 否则使用本地 DB
 * ========================= */

/* 登录用户（仅用于渲染头像/昵称） */
async function getMe() {
  if (!USE_BACKEND) return getMeLocal();
  const r = await api("/me");
  return r.user || null;
}

/* 关注/取关/是否已关注 */
async function follow(uid) {
  if (!USE_BACKEND) {
    const me = getMeLocal();
    if (me.id === uid) return;
    if (!me.following.includes(uid)) me.following.push(uid);
    const target = getUserLocal(uid);
    if (!target.followers.includes(me.id)) target.followers.push(me.id);
    Storage.save(DB);
    return;
  }
  await api(`/follow/${uid}`, { method: "POST" });
}
async function unfollow(uid) {
  if (!USE_BACKEND) {
    const me = getMeLocal();
    if (me.id === uid) return;
    me.following = me.following.filter(id => id !== uid);
    const target = getUserLocal(uid);
    target.followers = target.followers.filter(id => id !== me.id);
    Storage.save(DB);
    return;
  }
  await api(`/follow/${uid}`, { method: "DELETE" });
}
async function isFollowing(uid) {
  if (!USE_BACKEND) return getMeLocal().following.includes(uid);
  // 后端没有“单查是否关注”的独立接口，这里在渲染 profile 时返回 counts；
  // 简化起见：在需要判断的地方不做即时查询，按钮以 follow/unfollow 动作为准。
  // 若要精准显示，建议在 worker 增加 /follow/state/:uid。
  return false; // 默认不显示“已关注”状态，点击后会变成已关注
}

/* 发帖 / 回复 */
async function createPost({ authorId, content, images }) {
  if (!USE_BACKEND) {
    const p = { id: uuid(), authorId, content, images: images || [], createdAt: now(), replyToId: null, threadRootId: null, likes: 0, reposts: 0, replies: 0 };
    DB.posts.unshift(p); Storage.save(DB); return p;
  }
  const r = await api("/api/posts", { method: "POST", body: JSON.stringify({ content, images }) });
  return { id: r.id };
}
async function createReply({ authorId, parentId, content, images }) {
  if (!USE_BACKEND) {
    const parent = DB.posts.find(p => p.id === parentId);
    if (!parent) throw new Error('Parent not found');
    let threadRootId = null;
    const sameAuthor = parent.authorId === authorId;
    if (sameAuthor) threadRootId = parent.threadRootId || parent.id;
    const r = { id: uuid(), authorId, content, images: images || [], createdAt: now(), replyToId: parentId, threadRootId, likes: 0, reposts: 0, replies: 0 };
    DB.posts.unshift(r); parent.replies += 1; Storage.save(DB); return r;
  }
  const r = await api(`/posts/${parentId}/reply`, { method: "POST", body: JSON.stringify({ content, images }) });
  return { id: r.id };
}

/* 线程 */
async function getThreadChainBackend(rootId) {
  const r = await api(`/posts/${rootId}/thread`);
  // r.root, r.chain[], r.replies[]
  // 线程展示只用 r.chain
  return r.chain || [];
}

/* 首页 feed */
async function getForYouFeed() {
  if (!USE_BACKEND) return DB.posts.filter(p => p.replyToId === null).sort((a,b)=>b.createdAt-a.createdAt);
  const r = await api(`/api/posts?type=forYou`);
  return r.data.map(normalizePostRow);
}
async function getFollowingFeed() {
  if (!USE_BACKEND) {
    const me = getMeLocal(); const set = new Set(me.following.concat([me.id]));
    return DB.posts.filter(p => p.replyToId === null && set.has(p.authorId)).sort((a,b)=>b.createdAt-a.createdAt);
  }
  const r = await api(`/api/posts?type=following`);
  return r.data.map(normalizePostRow);
}

/* 个人主页数据 */
async function fetchProfile(uid) {
  if (!USE_BACKEND) {
    const user = getUserLocal(uid);
    const items = DB.posts.filter(p => p.authorId === uid && p.replyToId === null).sort((a,b)=>b.createdAt-a.createdAt);
    return { user, following_count: user.following.length, followers_count: user.followers.length, items };
  }
  const u = await api(`/users/${uid}`);
  // 拉该用户的根贴
  const r = await api(`/api/posts?type=forYou&limit=100`); // 简化：后端暂未提供按作者过滤，这里客户端筛选
  const items = r.data.map(normalizePostRow).filter(p => p.authorId === uid && p.replyToId === null);
  return { user: u.user, following_count: u.following_count, followers_count: u.followers_count, items };
}

/* 上传图片（到 R2，通过 Worker /upload/image） */
async function uploadImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await api("/upload/image", { method: "POST", body: fd });
  // 返回 { ok:true, url:"/media/..." } -> 拼成完整可访问 URL
  return `${API_BASE}${r.url}`;
}

/* 将后端 posts 行适配为前端渲染需要的结构 */
function normalizePostRow(row) {
  // 后端返回：p.* + u.nickname, u.avatar
  // 我们需要：{ id, authorId, authorNick, authorAvatar, content, images:[{url}], createdAt, replyToId, threadRootId, ... }
  const imgs = Array.isArray(row.images)
    ? row.images
    : (() => { try { return JSON.parse(row.images || "[]"); } catch { return []; } })();

  return {
    id: String(row.id),
    authorId: row.author_id,
    authorNick: row.nickname || "",
    authorAvatar: row.avatar || "",
    content: row.content || "",
    images: imgs.map(u => ({ url: u })),
    createdAt: row.created_at,
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    threadRootId: row.thread_root_id ? String(row.thread_root_id) : null,
    likes: row.likes || 0,
    reposts: row.reposts || 0,
    replies: row.replies || 0
  };
}

/* =========================
 * 路由
 * ========================= */
const Routes = {
  home: '#/home',
  profile: (uid) => `#/u/${uid}`,
  post: (pid) => `#/post/${pid}`
};
function parseRoute() {
  const h = location.hash || '#/home';
  const [path, queryStr] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));
  if (path.startsWith('#/u/')) return { page: 'profile', uid: path.slice(4), query };
  if (path.startsWith('#/post/')) return { page: 'post', pid: path.slice(7), query };
  return { page: 'home', query };
}

/* =========================
 * 启动
 * ========================= */
window.addEventListener('hashchange', () => renderApp());
document.addEventListener('DOMContentLoaded', async () => {
  bindGlobalUI();
  if (USE_BACKEND) await ensureLogin();
  renderApp();
});

/* =========================
 * 全局 UI & 发帖弹层
 * ========================= */
function bindGlobalUI() {
  const composeBtn = $('#btn-compose');
  if (composeBtn) composeBtn.addEventListener('click', () => openComposeModal());

  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
  $$('#overlay .modal .btn-close').forEach(btn => btn.addEventListener('click', closeModal));

  const composeForm = $('#compose-form');
  if (composeForm) {
    $('#compose-images').addEventListener('change', handleComposeImages);
    composeForm.addEventListener('submit', handleSubmitCompose);
    $('#compose-clear-images').addEventListener('click', () => {
      $('#compose-images').value = ''; $('#compose-previews').innerHTML = ''; composeImages = [];
    });
  }

  $('#composerImageInput')?.addEventListener('change', handleInlineImages);
  $('#btnClearDraft')?.addEventListener('click', clearInlineDraft);
  $('#btnPost')?.addEventListener('click', handleSubmitInline);

  $('#nav-home').addEventListener('click', () => { location.hash = Routes.home; });
  $('#nav-me').addEventListener('click', async () => {
    const me = await getMe();
    if (me?.id) location.hash = Routes.profile(me.id);
  });

  $('#tab-forYou').addEventListener('click', () => renderHome('forYou'));
  $('#tab-following').addEventListener('click', () => renderHome('following'));
}

let composeImages = []; // [{file, url(base64)}...]
function openComposeModal(replyToId = null) {
  $('#overlay').classList.add('open');
  $('#modal-compose').classList.add('open');
  const form = $('#compose-form');
  form.reset(); $('#compose-previews').innerHTML = ''; composeImages = [];
  form.dataset.replyTo = replyToId || '';
}
function closeModal() {
  $('#overlay').classList.remove('open');
  $$('#overlay .modal').forEach(m => m.classList.remove('open'));
}
function handleComposeImages(e) {
  const files = Array.from(e.target.files || []);
  const all = composeImages.length + files.length;
  if (all > 3) { toast('最多选择 3 张图片'); return; }
  files.forEach(f => {
    if (!/^image\//.test(f.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      composeImages.push({ file: f, url: reader.result });
      renderComposePreviews();
    };
    reader.readAsDataURL(f);
  });
}
function renderComposePreviews() {
  const box = $('#compose-previews');
  box.innerHTML = composeImages.map((img, i) => `
    <div class="img-cell">
      <img src="${img.url}" alt="preview"/>
      <button class="img-del" data-i="${i}" aria-label="删除">×</button>
    </div>
  `).join('');
  $$('#compose-previews .img-del').forEach(btn => {
    btn.addEventListener('click', () => { const i = +btn.dataset.i; composeImages.splice(i,1); renderComposePreviews(); });
  });
}

async function handleSubmitCompose(e) {
  e.preventDefault();
  const me = await getMe();
  const content = $('#compose-content').value.trim();
  const replyTo = e.currentTarget.dataset.replyTo || null;

  if (!content && composeImages.length === 0) { toast('内容或图片至少有一项'); return; }

  try {
    let imageUrls = [];
    if (USE_BACKEND && composeImages.length) {
      // 逐张上传
      for (const it of composeImages) {
        const url = await uploadImage(it.file);
        imageUrls.push(url);
      }
    } else {
      imageUrls = composeImages; // 本地模式里仍用 base64 预览
    }

    if (replyTo) {
      await createReply({ authorId: me?.id || 'me', parentId: replyTo, content, images: USE_BACKEND ? imageUrls : composeImages });
    } else {
      await createPost({ authorId: me?.id || 'me', content, images: USE_BACKEND ? imageUrls : composeImages });
    }
    closeModal();

    const r = parseRoute();
    if (r.page === 'home') renderHome(getActiveTab());
    else if (r.page === 'profile') renderProfile(r.uid);
    else if (r.page === 'post') renderPostDetail(r.pid);
    toast('已发布');
  } catch (err) {
    console.error(err);
    toast('发布失败：' + err.message);
  }
}

/* =========================
 * 渲染根
 * ========================= */
async function renderApp() {
  await renderHeaderUser();
  const r = parseRoute();
  if (r.page === 'home') renderHome(getActiveTab());
  if (r.page === 'profile') renderProfile(r.uid);
  if (r.page === 'post') renderPostDetail(r.pid);
}

/* 头部用户区 */
async function renderHeaderUser() {
  let me = null;
  if (USE_BACKEND) {
    try { const r = await api("/me"); me = r.user || null; } catch (_) {}
  } else {
    me = getMeLocal();
  }

  if (!me) {
    // 未登录：显示登录按钮
    $('#user-entry').innerHTML = `
      <button class="btn primary" id="btn-login">登录/注册</button>
    `;
    $('#btn-login')?.addEventListener('click', async () => {
      try {
        await ensureLogin();     // 走短信验证码
        await renderHeaderUser();// 登录后刷新头部
        renderHome(getActiveTab());
      } catch (e) {
        toast('登录失败：' + e.message);
      }
    });
    return;
  }

  // 已登录：展示“发帖 + 头像”
  const avatarHTML = me?.avatar
    ? `<img src="${me.avatar}" alt="${escapeHtml(me.nickname || '')}">`
    : `<div class="avatar-ph" aria-label="${escapeHtml(me?.nickname || '我')}">
         ${escapeHtml((me?.nickname || '我').slice(0,1).toUpperCase())}
       </div>`;

  $('#user-entry').innerHTML = `
    <button class="btn ghost" id="btn-compose">发帖</button>
    <div class="user-mini" title="我的主页">
      <div class="avatar small">${avatarHTML}</div>
      <span class="nick">${escapeHtml(me?.nickname || '')}</span>
    </div>
  `;

  $('#btn-compose').addEventListener('click', () => openComposeModal());
  $('.user-mini').addEventListener('click', () => { if (me?.id) location.hash = Routes.profile(me.id); });
}

/* =========================
 * 首页：推荐/关注
 * ========================= */
function getActiveTab() { return $('.feed-tabs .tab.active')?.dataset.tab || 'forYou'; }

async function renderHome(tab = 'forYou') {
  $$('.feed-tabs .tab').forEach(t => t.classList.remove('active'));
  $(`.feed-tabs .tab[data-tab="${tab}"]`).classList.add('active');

  const box = $('#feed-list');
  box.innerHTML = `<div class="empty">加载中...</div>`;

  let list = [];
  try {
    list = (tab === 'forYou') ? await getForYouFeed() : await getFollowingFeed();
    if (!list.length) {
      box.innerHTML = `<div class="empty">这里还没有内容。去关注一些人，或者发第一条吧！</div>`;
      return;
    }
    box.innerHTML = list.map(renderPostCard).join('');
    bindPostCardEvents(box);
  } catch (e) {
    box.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

/* 帖子卡片（根贴） */
function renderPostCard(p) {
  const nick = USE_BACKEND ? (p.authorNick || '用户') : getUserLocal(p.authorId).nickname;
  const avatar = USE_BACKEND ? p.authorAvatar : (getUserLocal(p.authorId).avatar || '');
  const avatarHTML = avatar ? `<img src="${avatar}" alt="${escapeHtml(nick)}">`
    : `<div class="avatar-ph" aria-label="${escapeHtml(nick)}">${escapeHtml(nick.slice(0,1).toUpperCase())}</div>`;

  return `
    <article class="post" data-id="${p.id}">
      <div class="avatar">${avatarHTML}</div>
      <div class="body">
        <div class="meta">
          <span class="nick clickable" data-user="${p.authorId}">${escapeHtml(nick)}</span>
          <span class="time">· ${fmtTime(p.createdAt)}</span>
        </div>
        ${renderContent(p)}
        <div class="actions">
          <button class="act reply">评论</button>
          <button class="act detail">详情</button>
          ${renderFollowBtn(p.authorId)}
        </div>
      </div>
    </article>
  `;
}

function renderContent(p) {
  const text = `<div class="text">${linkify(escapeHtml(p.content))}</div>`;
  const imgs = (p.images && p.images.length) ? `
    <div class="media-grid">
      ${p.images.map(img => `<img src="${img.url}" class="media-img" alt="img">`).join('')}
    </div>` : '';
  return text + imgs;
}

function renderFollowBtn(uid) {
  // 后端模式下，为避免多次查询，这里总是显示“关注”或“取消关注”两态之一。
  // 简化：如果是本人，不显示按钮。
  // 本地模式沿用原逻辑。
  if (USE_BACKEND) {
    // 需要 me.id 才能判断本人
    // 在按钮点击时再调用 follow/unfollow
    return `<button class="act follow primary" data-follow="${uid}">关注/取关</button>`;
  }
  const me = getMeLocal();
  if (uid === me.id) return '';
  return isFollowing(uid)
    ? `<button class="act follow danger" data-follow="${uid}">取消关注</button>`
    : `<button class="act follow primary" data-follow="${uid}">关注</button>`;
}

function bindPostCardEvents(container) {
  container.querySelectorAll('.nick.clickable').forEach(el => {
    el.addEventListener('click', () => { const uid = el.dataset.user; location.hash = Routes.profile(uid); });
  });
  container.querySelectorAll('.avatar img').forEach(img => {
    img.addEventListener('click', () => openImageViewer(img.src));
  });
  container.querySelectorAll('.act.reply').forEach(btn => {
    btn.addEventListener('click', () => { const post = btn.closest('.post'); openComposeModal(post.dataset.id); });
  });
  container.querySelectorAll('.act.detail').forEach(btn => {
    btn.addEventListener('click', () => { const post = btn.closest('.post'); location.hash = Routes.post(post.dataset.id); });
  });
  container.querySelectorAll('.act.follow').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.follow;
      try {
        // 简化：再次点击视为切换，后端没有状态接口，这里直接尝试 follow，再尝试 unfollow。
        await follow(uid).catch(async () => { await unfollow(uid); });
        toast('已执行关注/取关');
        renderHome(getActiveTab());
      } catch (e) {
        toast('操作失败：' + e.message);
      }
    });
  });
}

/* =========================
 * 个人主页
 * ========================= */
async function renderProfile(uid) {
  const box = $('#feed-list');
  box.innerHTML = `<div class="empty">加载中...</div>`;
  try {
    const { user, following_count, followers_count, items } = await fetchProfile(uid);
    if (!user) { box.innerHTML = `<div class="empty">用户不存在</div>`; return; }

    const avatarHTML = user.avatar
      ? `<img src="${user.avatar}" alt="${escapeHtml(user.nickname)}">`
      : `<div class="avatar-ph" aria-label="${escapeHtml(user.nickname)}">${escapeHtml(user.nickname.slice(0,1).toUpperCase())}</div>`;

    box.innerHTML = `
      <section class="profile">
        <div class="cover">${user.cover ? `<img src="${user.cover}" alt="cover">` : `<div class="cover-ph">上传封面</div>`}</div>
        <div class="profile-row">
          <div class="avatar large">${avatarHTML}</div>
          <div class="meta">
            <div class="nick">${escapeHtml(user.nickname)}</div>
            <div class="bio">${escapeHtml(user.bio || '')}</div>
            <div class="stats">
              <span class="stat"><b>${following_count ?? 0}</b> 关注中</span>
              <span class="stat"><b>${followers_count ?? 0}</b> 粉丝</span>
            </div>
          </div>
          <div class="actions">
            <!-- 简化：本人不显示关注按钮；他人显示一个“关注/取关”切换 -->
            <button class="btn" id="btn-edit-profile" style="display:${USE_BACKEND ? 'none' : 'inline-block'}">编辑资料</button>
            <button class="btn" id="btn-follow-toggle" data-follow="${user.id}" style="display:${USE_BACKEND ? 'inline-block' : 'none'}">关注/取关</button>
          </div>
        </div>
        <div class="profile-tabs"><button class="tab active">动态</button></div>
        <div id="profile-list"></div>
      </section>
    `;

    // 绑定
    const flBtn = $('#btn-follow-toggle');
    if (flBtn) flBtn.addEventListener('click', async () => {
      try { await follow(user.id).catch(async ()=>{ await unfollow(user.id); }); toast('已执行关注/取关'); renderProfile(uid); }
      catch(e){ toast('操作失败：' + e.message); }
    });

    const list = $('#profile-list');
    if (!items.length) {
      list.innerHTML = `<div class="empty">还没有发布内容</div>`;
    } else {
      list.innerHTML = items.map(p => USE_BACKEND ? renderPostCard(p) : renderPostCard(p)).join('');
      bindPostCardEvents(list);
    }
  } catch (e) {
    box.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

/* =========================
 * 帖子详情（含线程）
 * ========================= */
async function renderPostDetail(pid) {
  const box = $('#feed-list');
  box.innerHTML = `<div class="empty">加载中...</div>`;

  if (!USE_BACKEND) {
    const post = DB.posts.find(p => p.id === pid);
    if (!post) { box.innerHTML = `<div class="empty">贴子不存在</div>`; return; }
    const user = getUserLocal(post.authorId);
    const chain = DB.posts.filter(p => (p.id === pid || p.threadRootId === pid) && p.authorId === user.id).sort((a,b)=>a.createdAt-b.createdAt);

    box.innerHTML = `
      <article class="post detail" data-id="${post.id}">
        <div class="avatar">${user.avatar ? `<img src="${user.avatar}">` : `<div class="avatar-ph">${escapeHtml(user.nickname.slice(0,1).toUpperCase())}</div>`}</div>
        <div class="body">
          <div class="meta"><span class="nick clickable" data-user="${user.id}">${escapeHtml(user.nickname)}</span><span class="time">· ${fmtTime(post.createdAt)}</span></div>
          ${renderContent(post)}
          <div class="actions"><button class="act reply">评论</button>${renderFollowBtn(user.id)}</div>
        </div>
      </article>
      ${chain.length>1 ? `<section class="thread-full"><div class="thread-head">线程</div>${chain.slice(1).map(renderThreadItemLocal).join('')}</section>` : ''}
    `;
    bindDetailEvents();
    const replies = DB.posts.filter(p => p.replyToId === post.id && (!p.threadRootId || p.threadRootId !== post.id)).sort((a,b)=>a.createdAt-b.createdAt);
    const list = $('#reply-list'); if (list) { list.innerHTML = replies.map(renderReplyItemLocal).join(''); bindReplyListEvents(list); }
    return;
  }

  // 后端
  try {
    // 为了简单：先从 forYou 拉一批，再找到这条（生产环境建议新增 /posts/:id）
    const r = await api(`/api/posts?type=forYou&limit=100`);
    const all = r.data.map(normalizePostRow);
    const post = all.find(p => String(p.id) === String(pid));
    if (!post) { box.innerHTML = `<div class="empty">贴子不存在</div>`; return; }

    const chain = await getThreadChainBackend(pid);

    box.innerHTML = `
      <article class="post detail" data-id="${post.id}">
        <div class="avatar">${post.authorAvatar ? `<img src="${post.authorAvatar}">` : `<div class="avatar-ph">${escapeHtml((post.authorNick||'用').slice(0,1).toUpperCase())}</div>`}</div>
        <div class="body">
          <div class="meta"><span class="nick clickable" data-user="${post.authorId}">${escapeHtml(post.authorNick||'用户')}</span><span class="time">· ${fmtTime(post.createdAt)}</span></div>
          ${renderContent(post)}
          <div class="actions"><button class="act reply">评论</button>${renderFollowBtn(post.authorId)}</div>
        </div>
      </article>
      ${chain.length ? `<section class="thread-full"><div class="thread-head">线程</div>${chain.map(normalizePostRow).map(renderThreadItem).join('')}</section>` : ''}
      <section class="replies"><div class="reply-head">所有回复</div><div id="reply-list"><div class="empty">（简化版：只展示线程，不展示普通回复列表）</div></div></section>
    `;
    bindDetailEvents();
  } catch (e) {
    box.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

/* 本地详情渲染项 */
function renderThreadItemLocal(t) {
  const u = getUserLocal(t.authorId);
  return `
    <div class="thread-item" data-id="${t.id}">
      <div class="avatar small">${u.avatar ? `<img src="${u.avatar}">` : `<div class="avatar-ph">${escapeHtml(u.nickname.slice(0,1).toUpperCase())}</div>`}</div>
      <div class="body">
        <div class="meta"><span class="nick clickable" data-user="${u.id}">${escapeHtml(u.nickname)}</span><span class="time">· ${fmtTime(t.createdAt)}</span></div>
        ${renderContent(t)}
      </div>
    </div>
  `;
}
function renderReplyItemLocal(p) {
  const u = getUserLocal(p.authorId);
  return `
    <div class="reply-item" data-id="${p.id}">
      <div class="avatar small">${u.avatar ? `<img src="${u.avatar}">` : `<div class="avatar-ph">${escapeHtml(u.nickname.slice(0,1).toUpperCase())}</div>`}</div>
      <div class="body">
        <div class="meta"><span class="nick clickable" data-user="${u.id}">${escapeHtml(u.nickname)}</span><span class="time">· ${fmtTime(p.createdAt)}</span></div>
        ${renderContent(p)}
        <div class="actions"><button class="act reply">回复</button></div>
      </div>
    </div>
  `;
}

/* 后端线程项渲染 */
function renderThreadItem(tnorm) {
  const nick = tnorm.authorNick || '用户';
  const avatar = tnorm.authorAvatar || '';
  const avatarHTML = avatar ? `<img src="${avatar}">` : `<div class="avatar-ph">${escapeHtml(nick.slice(0,1).toUpperCase())}</div>`;
  return `
    <div class="thread-item" data-id="${tnorm.id}">
      <div class="avatar small">${avatarHTML}</div>
      <div class="body">
        <div class="meta"><span class="nick clickable" data-user="${tnorm.authorId}">${escapeHtml(nick)}</span><span class="time">· ${fmtTime(tnorm.createdAt)}</span></div>
        ${renderContent(tnorm)}
      </div>
    </div>
  `;
}

function bindDetailEvents() {
  const box = $('#feed-list');
  box.querySelectorAll('.nick.clickable').forEach(el => { el.addEventListener('click', () => location.hash = Routes.profile(el.dataset.user)); });
  box.querySelectorAll('.avatar img').forEach(img => { img.addEventListener('click', () => openImageViewer(img.src)); });
  const replyBtn = box.querySelector('.post.detail .act.reply');
  if (replyBtn) replyBtn.addEventListener('click', (e) => { const pid = e.currentTarget.closest('.post').dataset.id; openComposeModal(pid); });
  box.querySelectorAll('.post.detail .act.follow').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.follow;
      try { await follow(uid).catch(async ()=>{ await unfollow(uid); }); toast('已执行关注/取关'); renderPostDetail($('#feed-list .post.detail').dataset.id); }
      catch(e){ toast('操作失败：' + e.message); }
    });
  });
}

function bindReplyListEvents(container) {
  container.querySelectorAll('.reply-item .act.reply').forEach(btn => {
    btn.addEventListener('click', () => { const pid = btn.closest('.reply-item').dataset.id; openComposeModal(pid); });
  });
  container.querySelectorAll('.avatar img').forEach(img => { img.addEventListener('click', () => openImageViewer(img.src)); });
  container.querySelectorAll('.nick.clickable').forEach(el => { el.addEventListener('click', () => location.hash = Routes.profile(el.dataset.user)); });
}

/* =========================
 * 头像、封面渲染 & 大图查看
 * ========================= */
function openImageViewer(src) {
  $('#overlay').classList.add('open'); $('#modal-image').classList.add('open');
  $('#modal-image .img-view').src = src;
}

let inlineImages = []; // [{file, url(base64)}]

function handleInlineImages(e) {
  const files = Array.from(e.target.files || []);
  const all = inlineImages.length + files.length;
  if (all > 3) { toast('最多选择 3 张图片'); return; }
  files.forEach(f => {
    if (!/^image\//.test(f.type)) return;
    const rd = new FileReader();
    rd.onload = () => {
      inlineImages.push({ file: f, url: rd.result });
      renderInlinePreviews();
    };
    rd.readAsDataURL(f);
  });
}

function renderInlinePreviews() {
  const box = $('#composerPreview');
  if (!box) return;
  box.innerHTML = inlineImages.map((img, i) => `
    <div class="img-cell">
      <img src="${img.url}" alt="preview"/>
      <button class="img-del" data-i="${i}" aria-label="删除">×</button>
    </div>
  `).join('');
  box.querySelectorAll('.img-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i; inlineImages.splice(i,1); renderInlinePreviews();
    });
  });
}

function clearInlineDraft() {
  $('#composerText').value = '';
  inlineImages = [];
  renderInlinePreviews();
  $('#composerImageInput').value = '';
}

async function handleSubmitInline() {
  await ensureLogin();

  const me = await getMe();
  const content = ($('#composerText')?.value || '').trim();
  if (!content && inlineImages.length === 0) {
    toast('内容或图片至少有一项'); return;
  }

  try {
    let imageUrls = [];
    if (USE_BACKEND && inlineImages.length) {
      for (const it of inlineImages) {
        const url = await uploadImage(it.file);
        imageUrls.push(url);
      }
    } else {
      imageUrls = inlineImages.map(x => x.url);
    }

    await createPost({ authorId: me?.id || 'me', content, images: USE_BACKEND ? imageUrls : inlineImages });
    clearInlineDraft();
    renderHome(getActiveTab());
    toast('已发布');
  } catch (err) {
    console.error(err);
    toast('发布失败：' + err.message);
  }
}
