// —— 极简状态管理（无后端，用内存模拟；对接时替换 fetch 部分）——
const state = {
  me: {
    id: 'u_me',
    nickname: '我自己',
    handle: '@me',
    avatar: 'https://api.dicebear.com/8.x/avataaars/svg?seed=me',
    banner: '',
    bio: '这个人很神秘，还什么都没有写。',
    following: new Set(['u_alice']),
    followers: new Set(['u_bob'])
  },
  users: new Map(), // id -> user
  posts: [],        // 数组：最新在前
  tab: 'forYou',    // forYou | following
  route: '#/home'
};

// 初始用户 & 帖子（模拟）
const seedUsers = [
  { id:'u_alice', nickname:'Alice', handle:'@alice', avatar:'https://api.dicebear.com/8.x/avataaars/svg?seed=alice', banner:'', bio:'前端 / 设计 / 咖啡' },
  { id:'u_bob',   nickname:'Bob',   handle:'@bob',   avatar:'https://api.dicebear.com/8.x/avataaars/svg?seed=bob',   banner:'', bio:'Cloudflare 爱好者' },
];
seedUsers.forEach(u => state.users.set(u.id, {...u, following:new Set(), followers:new Set(['u_me'])}));
state.users.set(state.me.id, state.me);

const now = Date.now();
state.posts = [
  makePost('p1', seedUsers[0], '第一次尝试做一个轻量论坛 UI，欢迎提意见！', ['https://images.unsplash.com/photo-1547658719-98e6ac31f871?q=80&w=1200&auto=format&fit=crop'], now - 3600000),
  makePost('p2', seedUsers[1], 'Cloudflare Workers + R2 / D1 真的好香。', [], now - 2000000),
  makePost('p3', state.me,     '我也来一条：今天把发帖面板做了个轻改。', [], now - 600000),
];
/** 模拟线程：作者对自己 p3 的回复，自动识别为 thread */
state.posts.push(makeReply('p3r1', state.me, '补一条：多图预览看起来不错。', 'p3', now - 300000));
state.posts.push(makeReply('p3r2', state.me, '再补：等会儿把 R2 直传也接起来。', 'p3', now - 120000));

// 工具：构造贴子 / 回复
function makePost(id, author, content, images=[], ts=Date.now()){
  return { id, authorId: author.id, content, images, createdAt: ts, replyTo: null };
}
function makeReply(id, author, content, parentId, ts=Date.now()){
  return { id, authorId: author.id, content, images:[], createdAt: ts, replyTo: parentId };
}

// —— DOM 获取 —— 
const $ = s => document.querySelector(s);
const feedView = $('#feedView');
const profileView = $('#profileView');
const feedList = $('#feedList');
const profilePosts = $('#profilePosts');
const composerText = $('#composerText');
const composerImageInput = $('#composerImageInput');
const composerPreview = $('#composerPreview');
const composerAvatar = $('#composerAvatar');

const tabButtons = [...document.querySelectorAll('.feed-tabs .tab')];
const btnPost = $('#btnPost');
const btnClearDraft = $('#btnClearDraft');
const btnLoadMore = $('#btnLoadMore');
const fabCompose = $('#fabCompose');
const btnLogin = $('#btnLogin');
const userEntry = $('#userEntry');
const navMyProfile = $('#navMyProfile');

const profileNickname = $('#profileNickname');
const profileHandle = $('#profileHandle');
const profileAvatar = $('#profileAvatar');
const profileBanner = $('#profileBanner');
const profileBio = $('#profileBio');
const statFollowing = $('#statFollowing');
const statFollowers = $('#statFollowers');
const btnEditProfile = $('#btnEditProfile');
const btnFollow = $('#btnFollow');
const inputAvatar = $('#inputAvatar');
const inputBanner = $('#inputBanner');
const btnEditAvatar = $('#btnEditAvatar');
const btnEditBanner = $('#btnEditBanner');

const lightbox = $('#lightbox');
const lightboxImg = $('#lightboxImg');

// —— 路由 —— 
window.addEventListener('hashchange', onRouteChange);
function onRouteChange(){
  const hash = location.hash || '#/home';
  state.route = hash;
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query||'');
  if(path === '#/home'){
    feedView.hidden = false; profileView.hidden = true;
    const tab = params.get('tab');
    if (tab === 'following') setTab('following'); else setTab('forYou');
  } else if (path.startsWith('#/u/')){
    const uid = path.slice(4);
    showProfile(uid || state.me.id);
  } else {
    // 其它页面占位
    feedView.hidden = false; profileView.hidden = true;
  }
  render();
}
function setTab(tab){
  state.tab = tab;
  tabButtons.forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
}
tabButtons.forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tab;
  location.hash = `#/home?tab=${t}`;
}));

// —— 登录状态（演示：点击即“登录好”） —— 
btnLogin.addEventListener('click', ()=> {
  // 这里未来接手机号登录面板
  alert('Demo：已模拟登录');
  renderUserEntry();
});
function renderUserEntry(){
  userEntry.innerHTML = `
    <img class="avatar sm" src="${state.me.avatar}" alt="me" title="${state.me.nickname}" />
  `;
  composerAvatar.src = state.me.avatar;
}
renderUserEntry();

// —— 发布（文本 + 最多 3 张图） —— 
const draft = { text:'', images:[] };
composerText.addEventListener('input', e => draft.text = e.target.value);
composerImageInput.addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 3 - draft.images.length);
  for(const f of files){
    if(!f.type.startsWith('image/')) continue;
    const dataUrl = await fileToDataURL(f);
    draft.images.push({ name:f.name, type:f.type, dataUrl });
  }
  renderPreview();
  composerImageInput.value = '';
});
function renderPreview(){
  composerPreview.innerHTML = draft.images.map((img, i)=>`
    <div class="thumb">
      <img src="${img.dataUrl}" alt="preview-${i}" />
      <button class="btn tiny ghost" data-remove="${i}">移除</button>
    </div>
  `).join('');
  composerPreview.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.remove);
      draft.images.splice(idx,1);
      renderPreview();
    });
  });
}
btnClearDraft.addEventListener('click', ()=>{
  draft.text=''; draft.images=[]; composerText.value=''; renderPreview();
});
btnPost.addEventListener('click', async ()=>{
  const text = draft.text.trim();
  if(!text && draft.images.length===0){ alert('请输入内容或选择图片'); return; }
  // TODO: 如果接后端，这里先请求“预签名URL”并上传图片，然后得到图片URL数组
  const images = draft.images.map(i=>i.dataUrl); // Demo 使用 dataURL；后端时替换为 R2 URL
  const post = makePost('p'+(Date.now()), state.me, text, images, Date.now());
  state.posts.unshift(post);
  // 清空
  draft.text=''; draft.images=[]; composerText.value=''; renderPreview();
  renderFeed();
});

// —— 信息流渲染 —— 
function render(){
  if(!feedView.hidden) renderFeed();
  if(!profileView.hidden) renderProfileView();
}
function renderFeed(){
  const list = getFeed
