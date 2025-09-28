/* main.js
 * 纯前端 Demo（无后端）：首页推荐/关注流、发帖（文字+最多3张图）、
 * 个人主页（头像/封面/简介可编辑）、关注/取关、帖子详情与“线程”逻辑。
 * 数据存 localStorage，未来替换为 Cloudflare Workers + D1 + R2 即可。
 */

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
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]);

/* =========================
 * 数据层（localStorage 模拟）
 * 未来替换成真实 API：把 Storage.* 调成 fetch('/api/...') 即可
 * ========================= */
const Storage = {
  key: 'mini_forum_demo_v1',
  load() {
    try {
      return JSON.parse(localStorage.getItem(this.key)) || null;
    } catch { return null; }
  },
  save(state) {
    localStorage.setItem(this.key, JSON.stringify(state));
  },
};

const createInitialState = () => {
  const userA = {
    id: uuid(), nickname: 'Alice', bio: '热爱前端与猫', avatar: '', cover: '',
    following: [], followers: [], createdAt: now()
  };
  const userB = {
    id: uuid(), nickname: 'Bob', bio: '徒步/胶片摄影', avatar: '', cover: '',
    following: [], followers: [], createdAt: now()
  };
  const me = {
    id: uuid(), nickname: '你', bio: '点击头像可编辑资料', avatar: '', cover: '',
    following: [userA.id], followers: [], createdAt: now()
  };
  // 建立互相关注一点点
  userA.followers.push(me.id);
  const posts = [
    { id: uuid(), authorId: userA.id, content: '第一条贴子，欢迎来到小站～', images: [], createdAt: now()-7200000, replyToId: null, threadRootId: null, likes: 2, reposts: 0, replies: 0 },
    { id: uuid(), authorId: userB.id, content: '今天的天空很蓝。', images: [], createdAt: now()-3600000, replyToId: null, threadRootId: null, likes: 1, reposts: 0, replies: 0 },
  ];
  return { users: { [me.id]: me, [userA.id]: userA, [userB.id]: userB }, posts, currentUserId: me.id, version: 1 };
};

let DB = Storage.load() || createInitialState();
Storage.save(DB);

/* 便捷选择器 */
const getUser = (id) => DB.users[id];
const getMe = () => DB.users[DB.currentUserId];

/* 关注关系 */
function follow(targetUserId) {
  const me = getMe();
  if (me.id === targetUserId) return;
  if (!me.following.includes(targetUserId)) me.following.push(targetUserId);
  const target = getUser(targetUserId);
  if (!target.followers.includes(me.id)) target.followers.push(me.id);
  Storage.save(DB);
}
function unfollow(targetUserId) {
  const me = getMe();
  if (me.id === targetUserId) return;
  me.following = me.following.filter(id => id !== targetUserId);
  const target = getUser(targetUserId);
  target.followers = target.followers.filter(id => id !== me.id);
  Storage.save(DB);
}
function isFollowing(targetUserId) {
  return getMe().following.includes(targetUserId);
}

/* 发帖 / 回复（含“线程”规则） */
function createPost({ authorId, content, images }) {
  const p = {
    id: uuid(),
    authorId,
    content,
    images: images || [],
    createdAt: now(),
    replyToId: null,
    threadRootId: null,
    likes: 0,
    reposts: 0,
    replies: 0
  };
  DB.posts.unshift(p);
  Storage.save(DB);
  return p;
}

function createReply({ authorId, parentId, content, images }) {
  const parent = DB.posts.find(p => p.id === parentId);
  if (!parent) throw new Error('Parent not found');
  // 如果回复的是“自己发的贴子”，则变线程：threadRootId = parent.threadRootId 或 parent.id
  // 如果回复的是别人的，但 parent 已经是自己的线程，也沿用该线程（与推特一致：线程是作者自己的连续自回复链）
  let threadRootId = null;
  const sameAuthor = parent.authorId === authorId;
  if (sameAuthor) {
    threadRootId = parent.threadRootId || parent.id;
  } else if (parent.threadRootId) {
    // 回复一个线程中的某条（非自己），不改变自己的 threadRootId（保持普通回复）
    threadRootId = null;
  }
  const r = {
    id: uuid(),
    authorId,
    content,
    images: images || [],
    createdAt: now(),
    replyToId: parentId,
    threadRootId,
    likes: 0,
    reposts: 0,
    replies: 0
  };
  DB.posts.unshift(r);
  parent.replies += 1;
  Storage.save(DB);
  return r;
}

/* 查找线程链（从 root 到叶） */
function getThreadChain(rootId) {
  // 线程定义：threadRootId === rootId 或 root 本身，且作者都相同（自我连续回复）
  const root = DB.posts.find(p => p.id === rootId);
  if (!root) return [];
  const authorId = root.authorId;
  // 找所有属于此线程的并按时间排序：从最早到最晚
  const chain = DB.posts
    .filter(p => (p.id === rootId) || (p.threadRootId === rootId))
    .filter(p => p.authorId === authorId) // 线程内必须同作者
    .sort((a, b) => a.createdAt - b.createdAt);
  return chain;
}

/* timeline 源 */
function getForYouFeed() {
  // 简单版：按时间倒序的所有“根贴 + 非线程首条也显示”（与推特略不同，这里直接显示所有根贴）
  // 为避免重复显示线程中的“自回复”，我们只在主流中显示：replyToId === null 的根贴
  return DB.posts.filter(p => p.replyToId === null).sort((a, b) => b.createdAt - a.createdAt);
}

function getFollowingFeed() {
  const me = getMe();
  const set = new Set(me.following.concat([me.id])); // 包含自己
  // 关注流也只显示根贴，回复在详情页查看
  return DB.posts
    .filter(p => p.replyToId === null && set.has(p.authorId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/* =========================
 * 路由（Hash 路由）
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

window.addEventListener('hashchange', () => renderApp());
document.addEventListener('DOMContentLoaded', () => {
  bindGlobalUI();
  renderApp();
});

/* =========================
 * 绑定全局 UI（头部、侧栏、弹层等）
 * ========================= */
function bindGlobalUI() {
  // 顶部“发帖”按钮
  const composeBtn = $('#btn-compose');
  if (composeBtn) composeBtn.addEventListener('click', openComposeModal);

  // 关闭弹层
  $('#overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') closeModal();
  });
  $$('#overlay .modal .btn-close').forEach(btn => btn.addEventListener('click', closeModal));

  // 发帖表单
  const composeForm = $('#compose-form');
  if (composeForm) {
    // 选择图片
    $('#compose-images').addEventListener('change', handleComposeImages);
    // 提交
    composeForm.addEventListener('submit', handleSubmitCompose);
    // 清空图片
    $('#compose-clear-images').addEventListener('click', () => {
      $('#compose-images').value = '';
      $('#compose-previews').innerHTML = '';
      composeImages = [];
    });
  }

  // 顶部导航：主页、我
  $('#nav-home').addEventListener('click', () => { location.hash = Routes.home; });
  $('#nav-me').addEventListener('click', () => { location.hash = Routes.profile(getMe().id); });

  // Feed Tabs
  $('#tab-forYou').addEventListener('click', () => renderHome('forYou'));
  $('#tab-following').addEventListener('click', () => renderHome('following'));
}

/* =========================
 * 弹层：发帖
 * ========================= */
let composeImages = []; // [{name, type, url(base64)}...]

function openComposeModal(replyToId = null) {
  $('#overlay').classList.add('open');
  $('#modal-compose').classList.add('open');
  const form = $('#compose-form');
  form.reset();
  $('#compose-previews').innerHTML = '';
  composeImages = [];
  form.dataset.replyTo = replyToId || '';
}

function closeModal() {
  $('#overlay').classList.remove('open');
  $$('#overlay .modal').forEach(m => m.classList.remove('open'));
}

/* 选择图片（最多3张） */
function handleComposeImages(e) {
  const files = Array.from(e.target.files || []);
  const all = composeImages.length + files.length;
  if (all > 3) {
    toast('最多选择 3 张图片');
    return;
  }
  files.forEach(f => {
    if (!/^image\//.test(f.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      composeImages.push({ name: f.name, type: f.type, url: reader.result });
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
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      composeImages.splice(i, 1);
      renderComposePreviews();
    });
  });
}

function handleSubmitCompose(e) {
  e.preventDefault();
  const me = getMe();
  const content = $('#compose-content').value.trim();
  const replyTo = e.currentTarget.dataset.replyTo || null;
  if (!content && composeImages.length === 0) {
    toast('内容或图片至少有一项');
    return;
  }
  if (replyTo) {
    createReply({ authorId: me.id, parentId: replyTo, content, images: composeImages });
  } else {
    createPost({ authorId: me.id, content, images: composeImages });
  }
  closeModal();
  // 重新渲染当前视图
  const r = parseRoute();
  if (r.page === 'home') renderHome(getActiveTab());
  else if (r.page === 'profile') renderProfile(r.uid);
  else if (r.page === 'post') renderPostDetail(r.pid);
  toast('已发布');
}

/* =========================
 * 渲染根：根据路由渲染
 * ========================= */
function renderApp() {
  renderHeaderUser();
  const r = parseRoute();
  if (r.page === 'home') renderHome(getActiveTab());
  if (r.page === 'profile') renderProfile(r.uid);
  if (r.page === 'post') renderPostDetail(r.pid);
}

/* 头部用户区 */
function renderHeaderUser() {
  const me = getMe();
  $('#user-entry').innerHTML = `
    <button class="btn ghost" id="btn-compose">发帖</button>
    <div class="user-mini" title="我的主页">
      <div class="avatar small">${renderAvatar(me)}</div>
      <span class="nick">${escapeHtml(me.nickname)}</span>
    </div>
  `;
  $('#btn-compose').addEventListener('click', () => openComposeModal());
  $('.user-mini').addEventListener('click', () => location.hash = Routes.profile(me.id));
}

/* =========================
 * 首页：推荐/关注
 * ========================= */
function getActiveTab() {
  return $('.feed-tabs .tab.active')?.dataset.tab || 'forYou';
}

function renderHome(tab = 'forYou') {
  // 设置 tab 激活
  $$('.feed-tabs .tab').forEach(t => t.classList.remove('active'));
  $(`.feed-tabs .tab[data-tab="${tab}"]`).classList.add('active');

  const list = (tab === 'forYou') ? getForYouFeed() : getFollowingFeed();
  const box = $('#feed-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty">这里还没有内容。去关注一些人，或者发第一条吧！</div>`;
    return;
  }
  box.innerHTML = list.map(renderPostCard).join('');
  bindPostCardEvents(box);
}

/* 帖子卡片 HTML（根贴） */
function renderPostCard(p) {
  const user = getUser(p.authorId);
  const threadChain = getThreadChain(p.id);
  // 如果该根贴已经有线程（自我连续回复），在卡片下方预览展示最近1-2条
  const hasThread = threadChain.length > 1;
  const previews = hasThread ? threadChain.slice(-2).map(t => `
    <div class="thread-cell">
      <div class="avatar small">${renderAvatar(user)}</div>
      <div class="cell-body">
        <div class="meta"><span class="nick">${escapeHtml(user.nickname)}</span> · <span class="time">${fmtTime(t.createdAt)}</span></div>
        ${renderContent(t)}
      </div>
    </div>
  `).join('') : '';

  return `
    <article class="post" data-id="${p.id}">
      <div class="avatar">${renderAvatar(user)}</div>
      <div class="body">
        <div class="meta">
          <span class="nick clickable" data-user="${user.id}">${escapeHtml(user.nickname)}</span>
          <span class="time">· ${fmtTime(p.createdAt)}</span>
        </div>
        ${renderContent(p)}
        <div class="actions">
          <button class="act reply">评论</button>
          <button class="act detail">详情</button>
          ${renderFollowBtn(user.id)}
        </div>
        ${hasThread ? `<div class="thread-preview">
          <div class="thread-line"></div>
          ${previews}
          <button class="btn link show-thread">展开该线程（${threadChain.length}）</button>
        </div>` : ''}
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
  const me = getMe();
  if (uid === me.id) return '';
  return isFollowing(uid)
    ? `<button class="act follow danger" data-follow="${uid}">取消关注</button>`
    : `<button class="act follow primary" data-follow="${uid}">关注</button>`;
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function bindPostCardEvents(container) {
  // 头像/昵称：进主页
  container.querySelectorAll('.nick.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const uid = el.dataset.user;
      location.hash = Routes.profile(uid);
    });
  });
  container.querySelectorAll('.avatar img').forEach(img => {
    img.addEventListener('click', () => openImageViewer(img.src));
  });
  // 评论（作为回复，自动处理线程）
  container.querySelectorAll('.act.reply').forEach(btn => {
    btn.addEventListener('click', () => {
      const post = btn.closest('.post');
      openComposeModal(post.dataset.id);
    });
  });
  // 详情
  container.querySelectorAll('.act.detail').forEach(btn => {
    btn.addEventListener('click', () => {
      const post = btn.closest('.post');
      location.hash = Routes.post(post.dataset.id);
    });
  });
  // 展开线程
  container.querySelectorAll('.show-thread').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const post = btn.closest('.post');
      location.hash = Routes.post(post.dataset.id);
    });
  });
  // 关注/取关
  container.querySelectorAll('.act.follow').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.follow;
      if (isFollowing(uid)) unfollow(uid); else follow(uid);
      renderHome(getActiveTab());
    });
  });
}

/* =========================
 * 个人主页
 * ========================= */
function renderProfile(uid) {
  const user = getUser(uid);
  if (!user) {
    $('#feed-list').innerHTML = `<div class="empty">用户不存在</div>`;
    return;
  }
  // 头部
  $('#feed-list').innerHTML = `
    <section class="profile">
      <div class="cover">${user.cover ? `<img src="${user.cover}" alt="cover">` : `<div class="cover-ph">上传封面</div>`}</div>
      <div class="profile-row">
        <div class="avatar large">${renderAvatar(user)}</div>
        <div class="meta">
          <div class="nick">${escapeHtml(user.nickname)}</div>
          <div class="bio">${escapeHtml(user.bio || '')}</div>
          <div class="stats">
            <span class="stat"><b>${user.following.length}</b> 关注中</span>
            <span class="stat"><b>${user.followers.length}</b> 粉丝</span>
          </div>
        </div>
        <div class="actions">
          ${user.id === getMe().id
            ? `<button class="btn" id="btn-edit-profile">编辑资料</button>`
            : renderFollowBtn(user.id)}
        </div>
      </div>
      <div class="profile-tabs">
        <button class="tab active">动态</button>
      </div>
      <div id="profile-list"></div>
    </section>
  `;
  // 绑定头像点击放大
  $$('.profile .avatar img').forEach(img => img.addEventListener('click', () => openImageViewer(img.src)));

  // 编辑资料
  const editBtn = $('#btn-edit-profile');
  if (editBtn) editBtn.addEventListener('click', () => openEditProfileModal(user.id));

  // 非本人：绑定关注按钮
  $$('.profile .act.follow').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.follow;
      if (isFollowing(uid)) unfollow(uid); else follow(uid);
      renderProfile(uid);
    });
  });

  // 列表：该用户的根贴（回复不显示在主页列表，符合主流产品）
  const items = DB.posts.filter(p => p.authorId === uid && p.replyToId === null)
                        .sort((a, b) => b.createdAt - a.createdAt);
  const list = $('#profile-list');
  if (!items.length) {
    list.innerHTML = `<div class="empty">还没有发布内容</div>`;
  } else {
    list.innerHTML = items.map(renderPostCard).join('');
    bindPostCardEvents(list);
  }
}

/* 编辑资料弹层 */
function openEditProfileModal(uid) {
  const user = getUser(uid);
  $('#overlay').classList.add('open');
  $('#modal-edit').classList.add('open');
  // 填充
  $('#edit-nick').value = user.nickname || '';
  $('#edit-bio').value = user.bio || '';
  // 预览
  $('#edit-avatar-preview').src = user.avatar || '';
  $('#edit-cover-preview').src = user.cover || '';
  // 绑定
  $('#edit-avatar').onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f || !/^image\//.test(f.type)) return;
    const rd = new FileReader();
    rd.onload = () => { $('#edit-avatar-preview').src = rd.result; };
    rd.readAsDataURL(f);
  };
  $('#edit-cover').onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f || !/^image\//.test(f.type)) return;
    const rd = new FileReader();
    rd.onload = () => { $('#edit-cover-preview').src = rd.result; };
    rd.readAsDataURL(f);
  };
  // 保存
  $('#edit-form').onsubmit = (e) => {
    e.preventDefault();
    user.nickname = $('#edit-nick').value.trim() || user.nickname;
    user.bio = $('#edit-bio').value.trim();
    user.avatar = $('#edit-avatar-preview').src || user.avatar;
    user.cover = $('#edit-cover-preview').src || user.cover;
    Storage.save(DB);
    closeModal();
    renderProfile(uid);
    renderHeaderUser();
    toast('资料已更新');
  };
}

/* =========================
 * 帖子详情（含线程视图）
 * ========================= */
function renderPostDetail(pid) {
  const post = DB.posts.find(p => p.id === pid);
  if (!post) {
    $('#feed-list').innerHTML = `<div class="empty">贴子不存在</div>`;
    return;
  }
  const user = getUser(post.authorId);
  const chain = getThreadChain(post.id);
  const hasThread = chain.length > 1;

  $('#feed-list').innerHTML = `
    <article class="post detail" data-id="${post.id}">
      <div class="avatar">${renderAvatar(user)}</div>
      <div class="body">
        <div class="meta">
          <span class="nick clickable" data-user="${user.id}">${escapeHtml(user.nickname)}</span>
          <span class="time">· ${fmtTime(post.createdAt)}</span>
        </div>
        ${renderContent(post)}
        <div class="actions">
          <button class="act reply">评论</button>
          ${renderFollowBtn(user.id)}
        </div>
      </div>
    </article>
    ${hasThread ? `
      <section class="thread-full">
        <div class="thread-head">线程</div>
        ${chain.slice(1).map(t => renderThreadItem(t)).join('')}
      </section>
    ` : ''}
    <section class="replies">
      <div class="reply-head">所有回复</div>
      <div id="reply-list"></div>
    </section>
  `;
  // 绑定
  bindDetailEvents();

  // 渲染非线程的普通回复（replyToId=post.id 且 threadRootId 为 null 或不是 post.id 的）
  const replies = DB.posts
    .filter(p => p.replyToId === post.id && (!p.threadRootId || p.threadRootId !== post.id))
    .sort((a,b) => a.createdAt - b.createdAt);
  const list = $('#reply-list');
  list.innerHTML = replies.map(renderReplyItem).join('');
  bindReplyListEvents(list);
}

function renderThreadItem(t) {
  const u = getUser(t.authorId);
  return `
    <div class="thread-item" data-id="${t.id}">
      <div class="avatar small">${renderAvatar(u)}</div>
      <div class="body">
        <div class="meta">
          <span class="nick clickable" data-user="${u.id}">${escapeHtml(u.nickname)}</span>
          <span class="time">· ${fmtTime(t.createdAt)}</span>
        </div>
        ${renderContent(t)}
      </div>
    </div>
  `;
}

function renderReplyItem(p) {
  const u = getUser(p.authorId);
  return `
    <div class="reply-item" data-id="${p.id}">
      <div class="avatar small">${renderAvatar(u)}</div>
      <div class="body">
        <div class="meta">
          <span class="nick clickable" data-user="${u.id}">${escapeHtml(u.nickname)}</span>
          <span class="time">· ${fmtTime(p.createdAt)}</span>
        </div>
        ${renderContent(p)}
        <div class="actions">
          <button class="act reply">回复</button>
        </div>
      </div>
    </div>
  `;
}

function bindDetailEvents() {
  const box = $('#feed-list');
  // 头像预览/主页
  box.querySelectorAll('.nick.clickable').forEach(el => {
    el.addEventListener('click', () => location.hash = Routes.profile(el.dataset.user));
  });
  box.querySelectorAll('.avatar img').forEach(img => {
    img.addEventListener('click', () => openImageViewer(img.src));
  });
  // 根贴评论：打开发帖弹层（作为回复，可能形成线程）
  box.querySelector('.post.detail .act.reply').addEventListener('click', (e) => {
    const pid = e.currentTarget.closest('.post').dataset.id;
    openComposeModal(pid);
  });
  // 关注/取关
  box.querySelectorAll('.post.detail .act.follow').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.follow;
      if (isFollowing(uid)) unfollow(uid); else follow(uid);
      renderPostDetail($('#feed-list .post.detail').dataset.id);
    });
  });
}

function bindReplyListEvents(container) {
  container.querySelectorAll('.reply-item .act.reply').forEach(btn => {
    btn.addEventListener('click', () => {
      // 回复某条普通回复（不会形成自己的线程，除非这条回复的作者就是自己且是根）
      // 我们保持“回复某条 -> replyTo = 那条的 id”。若作者与自己相同，线程会在 createReply 内判断。
      const pid = btn.closest('.reply-item').dataset.id;
      openComposeModal(pid);
    });
  });
  container.querySelectorAll('.avatar img').forEach(img => {
    img.addEventListener('click', () => openImageViewer(img.src));
  });
  container.querySelectorAll('.nick.clickable').forEach(el => {
    el.addEventListener('click', () => location.hash = Routes.profile(el.dataset.user));
  });
}

/* =========================
 * 头像、封面渲染 & 大图查看
 * ========================= */
function renderAvatar(user) {
  if (user.avatar) return `<img src="${user.avatar}" alt="${escapeHtml(user.nickname)}">`;
  const letter = escapeHtml((user.nickname || '?').slice(0,1).toUpperCase());
  return `<div class="avatar-ph" aria-label="${escapeHtml(user.nickname)}">${letter}</div>`;
}

function openImageViewer(src) {
  $('#overlay').classList.add('open');
  $('#modal-image').classList.add('open');
  $('#modal-image .img-view').src = src;
}

/* =========================
 * Toast
 * ========================= */
let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* =========================
 * 未来对接后端（示例注释）
 * - 发帖：POST /api/posts { content, images[] } -> 返回 id
 * - 回复：POST /api/posts/:id/reply { content, images[] }
 * - 头像/封面上传：获取预签名 URL -> 直传 R2 -> 回填 URL
 * - 关注：POST /follow/:uid, DELETE /follow/:uid
 * - 拉流：GET /feed?type=forYou|following&cursor=...
 * - 线程：GET /posts/:id/thread
 * ========================= */
