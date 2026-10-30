/**
 * 后台看板静态资产（HTML 外壳 + 外置脚本源码）。
 *
 * 独立模块的原因：workerd 拒绝 worker 入口模块里「非函数/ExportedHandler 的具名导出」，
 * 字符串常量留在 index.ts 会让 `wrangler dev` 直接启动失败（2026-10-30 验收发现，d1c942d 引入）。
 * 测试（dashboardHtml.test.ts）从本模块导入；index.ts 只导入使用、不再转出口。
 */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ART/RANK 后台看板</title>
<link rel="icon" href="data:,">
<script src="/vendor/chart.umd.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0c0a;--card:#141914;--border:#2a3a2a;--accent:#d8f86a;--muted:#8a9a8a;--text:#e0e8e0;--green:#4ade80;--red:#f87171;--blue:#60a5fa;--yellow:#facc15}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:24px}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.dash-controls{display:flex;align-items:center;gap:8px;margin-left:auto}.dash-controls input,.dash-controls select{width:150px;padding:7px 9px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px}.dash-controls input:focus,.dash-controls select:focus{border-color:var(--accent);outline:none}.section-anchor{scroll-margin-top:20px}
.header h1{font-size:20px;font-weight:600;color:var(--accent)}
.header h1 span{color:var(--muted);font-weight:400}
.header .meta{font-size:12px;color:var(--muted)}
.grid{display:grid;gap:16px}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-2{grid-template-columns:repeat(2,1fr)}
@media(max-width:900px){.grid-4,.grid-2{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}
.card h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.card .value{font-size:32px;font-weight:700;color:var(--text)}
.card .sub{font-size:12px;color:var(--muted);margin-top:4px}
.card .value.green{color:var(--green)}.card .value.blue{color:var(--blue)}.card .value.yellow{color:var(--yellow)}.card .value.red{color:var(--red)}
.chart-card{padding:20px}.chart-card h3{font-size:14px;font-weight:600;margin-bottom:16px;color:var(--text)}
canvas{width:100%!important;max-height:250px}
table{width:100%;border-collapse:collapse;font-size:13px}
.table-action{background:transparent;border:1px solid var(--border);color:var(--muted);padding:3px 7px;border-radius:5px;font-size:10px;cursor:pointer;margin:1px}.table-action:hover{border-color:var(--accent);color:var(--accent)}.table-action.warn{border-color:#7b661a;color:var(--yellow)}.table-action.restore{border-color:#20623b;color:var(--green)}.table-action.danger{border-color:#703234;color:var(--red)}
th{text-align:left;padding:8px 12px;color:var(--muted);font-weight:500;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
td{padding:8px 12px;border-bottom:1px solid var(--border);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500}
.badge-visit{background:#1a2a1a;color:var(--green)}.badge-ranking_completed{background:#1a1a2a;color:var(--blue)}.badge-share{background:#2a2a1a;color:var(--yellow)}
.badge-film{background:#1a2a1a;color:#4ade80}.badge-book{background:#1a1a2a;color:#818cf8}.badge-music{background:#2a1a2a;color:#f472b6}.badge-other{background:#2a2a1a;color:#facc15}
.badge-ok{background:#1a2a1a;color:var(--green)}.badge-err{background:#2a1a1a;color:var(--red)}
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.status-dot.ok{background:var(--green)}.status-dot.warn{background:var(--yellow)}.status-dot.err{background:var(--red)}
.loading{text-align:center;padding:60px;color:var(--muted)}
.error{color:var(--red);padding:20px;text-align:center}
.refresh-btn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px}
.refresh-btn:hover{border-color:var(--accent);color:var(--accent)}
.logout-btn{background:transparent;border:1px solid var(--border);color:var(--muted);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px}
.logout-btn:hover{border-color:var(--red);color:var(--red)}
#login{max-width:360px;margin:120px auto;text-align:center}
#login h2{color:var(--accent);margin-bottom:24px}
#login input{width:100%;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;margin-bottom:12px}
#login button{width:100%;padding:12px;background:var(--accent);color:#000;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
#login button:hover{opacity:0.9}
#login .err{color:var(--red);font-size:13px;margin-bottom:12px}
.dash-tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border)}
.dash-tab{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--muted);padding:10px 18px;font-size:13px;cursor:pointer}
.dash-tab:hover{color:var(--text)}
.dash-tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.tab-pane{display:none}
.tab-pane.active{display:block}
.plaza-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.plaza-toolbar select,.plaza-toolbar input{width:auto;padding:7px 9px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px}
.dash-modal-backdrop{position:fixed;inset:0;background:#000c;display:grid;place-items:center;padding:24px;z-index:200}
.dash-modal{width:min(760px,100%);max-height:86vh;overflow-y:auto;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:22px}
.dash-modal h3{color:var(--text);margin-bottom:12px}
.dash-modal .close-x{float:right;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);width:28px;height:28px;cursor:pointer}
.rank-row{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}
.rank-medal{width:30px;flex-shrink:0;font-family:Consolas,monospace;color:var(--accent)}
.comment-row{padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}
.mini-note{font-size:11px;color:var(--muted);line-height:1.7}
.danger-zone{border:1px solid #703234;border-radius:10px;padding:16px;margin-top:16px;background:#140b0b}
.danger-zone>h3{color:var(--red);margin-bottom:10px}
.reset-card{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;font-size:13px}
.reset-card .sub{font-size:11px;color:var(--muted);margin-top:3px}
.dash-confirm-row{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.dash-confirm-row input{width:100%;padding:9px 11px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px}
</style>
</head>
<body>
<div id="login" style="display:none">
  <h2>ART/RANK 后台</h2>
  <div class="err" id="loginErr"></div>
  <input type="password" id="pwd" placeholder="管理密码" data-enter="login">
  <button data-act="login">登录</button>
</div>
<div id="dashboard" style="display:none">
<div class="header">
  <h1>ART<span>/</span>RANK <span>后台看板</span></h1>
  <div style="display:flex;align-items:center;gap:12px">
    <span class="meta" id="timestamp"></span>
    <button class="refresh-btn" data-act="refresh">刷新</button>
    <button class="logout-btn" data-act="logout">退出</button>
  </div>
</div>
<div class="dash-tabs">
  <button class="dash-tab active" data-tab="overview" data-act="tab" data-arg="overview">概览</button>
  <button class="dash-tab" data-tab="users" data-act="tab" data-arg="users">用户</button>
  <button class="dash-tab" data-tab="plaza" data-act="tab" data-arg="plaza">广场</button>
  <button class="dash-tab" data-tab="data" data-act="tab" data-arg="data">数据</button>
  <button class="dash-tab" data-tab="cache" data-act="tab" data-arg="cache">缓存</button>
</div>
<div id="tab-overview" class="tab-pane active"><div id="app" class="loading">加载中...</div></div>
<div id="tab-users" class="tab-pane"><div id="users-app" class="loading">点击「用户」页签加载</div></div>
<div id="tab-plaza" class="tab-pane"><div id="plaza-app" class="loading">点击「广场」页签加载</div></div>
<div id="tab-data" class="tab-pane"><div id="data-app" class="loading">点击「数据」页签加载</div></div>
<div id="tab-cache" class="tab-pane">
  <div class="card" style="max-width:640px">
    <h3 style="margin-bottom:8px">清除服务端缓存</h3>
    <p style="color:var(--muted);font-size:13px;line-height:1.7;margin-bottom:12px">
      立即失效对应类别的服务端缓存（本机即刻生效，其余节点 60 秒内跟进）。
      浏览器侧的 HTTP 缓存由响应 max-age 控制（文字/详情类最长 1 小时）。
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <button class="table-action" data-act="purge" data-arg="posters">海报</button>
      <button class="table-action" data-act="purge" data-arg="intro">文字简介</button>
      <button class="table-action" data-act="purge" data-arg="music">歌曲</button>
      <button class="table-action" data-act="purge" data-arg="misc">其他</button>
      <button class="table-action warn" data-act="purge" data-arg="all">全部清除</button>
    </div>
    <div id="cache-purge-result" style="font-size:12px;color:var(--muted)"></div>
  </div>
</div>
<div id="dash-modal-root"></div>
</div>
<script src="/admin/app.js"><\/script>

</body>
</html>`;

/** 后台看板脚本外置，配合 CSP `script-src 'self'`（禁止内联脚本与内联事件）。 */
export const DASHBOARD_JS = `var TOKEN_KEY = 'art-rank-admin-token';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
// 库内时间格式是混合的：CURRENT_TIMESTAMP 写 "YYYY-MM-DD HH:MM:SS"（UTC 但无标记），
// strftime 写带 Z 的 ISO。浏览器会把前一种按本地时区解析，UTC+8 下全体偏 8 小时。
// 与前端 src/lib/dbTime.ts 同一判定；看板是独立外置脚本，无法 import，故此处复刻一份。
function dbTime(v){var s=String(v==null?'':v);return /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/.test(s)?new Date(s.replace(' ','T')+'Z'):new Date(s);}
function getToken(){return localStorage.getItem(TOKEN_KEY)||''}
function setToken(t){localStorage.setItem(TOKEN_KEY,t)}
function clearToken(){localStorage.removeItem(TOKEN_KEY)}

var ACTIONS = {
  login: function(){ doLogin(); },
  logout: function(){ doLogout(); },
  refresh: function(){ refreshCurrent(); },
  tab: function(el){ switchTab(el.getAttribute('data-arg')); },
  purge: function(el){ purgeCache(el.getAttribute('data-arg')); },
  'export-poster-errors': function(){ exportPosterErrors(); },
  'modal-close': function(){ closeDashModal(); },
  'modal-backdrop': function(){ closeDashModal(); },
  'user-detail': function(el){ openUserDetail(Number(el.getAttribute('data-arg'))); },
  'user-toggle': function(el){ toggleAccount(Number(el.getAttribute('data-arg')), el.getAttribute('data-arg2') === 'true'); },
  'user-clear': function(el){ clearAccountData(Number(el.getAttribute('data-arg')), el.getAttribute('data-arg2')); },
  'user-delete': function(el){ deleteAccount(Number(el.getAttribute('data-arg'))); },
  'user-reset-password': function(el){ resetPassword(Number(el.getAttribute('data-arg'))); },
  'revoke-sessions': function(){ revokeAllSessions(); },
  'clean-links': function(){ cleanExpiredLinks(); },
  'change-admin-password': function(){ changeAdminPassword(); },
  'clean-logs': function(el){ cleanLogs(el.getAttribute('data-arg'), el.getAttribute('data-arg2')); },
  'reset-open': function(el){ openResetConfirm(el.getAttribute('data-arg')); },
  'reset-execute': function(el){ executeReset(el.getAttribute('data-arg')); },
  'ai-prompt-save': function(el){ saveAiPrompt(el.getAttribute('data-arg')); },
  'ai-prompt-clear': function(el){ clearAiPrompt(el.getAttribute('data-arg')); },
  'plaza-filter': function(){ plazaApplyFilter(); },
  'plaza-load': function(){ loadPlaza(); },
  'plaza-page': function(el){ plazaPage(Number(el.getAttribute('data-arg'))); },
  'plaza-detail': function(el){ openPlazaDetail(Number(el.getAttribute('data-arg'))); },
  'plaza-toggle': function(el){ togglePlazaPost(Number(el.getAttribute('data-arg')), Number(el.getAttribute('data-arg2')) === 1); },
  'plaza-delete': function(el){ deletePlazaPost(Number(el.getAttribute('data-arg'))); },
  'plaza-comment-delete': function(el){ deletePlazaComment(Number(el.getAttribute('data-arg')), Number(el.getAttribute('data-arg2'))); }
};

function findAction(node, attr){
  return node && node.closest ? node.closest('[' + attr + ']') : null;
}
document.addEventListener('click', function(e){
  var el = findAction(e.target, 'data-act');
  if (!el) return;
  if (el.getAttribute('data-act') === 'modal-backdrop' && e.target !== el) return;
  var fn = ACTIONS[el.getAttribute('data-act')];
  if (fn) fn(el);
});
document.addEventListener('change', function(e){
  var el = findAction(e.target, 'data-change');
  if (!el) return;
  var fn = ACTIONS[el.getAttribute('data-change')];
  if (fn) fn(el);
});
document.addEventListener('keydown', function(e){
  if (e.key !== 'Enter') return;
  var el = findAction(e.target, 'data-enter');
  if (!el) return;
  var fn = ACTIONS[el.getAttribute('data-enter')];
  if (fn) fn(el);
});


async function checkAuth(){
  var r=await fetch('/api/admin/check',{headers:{'Authorization':'Bearer '+getToken()}});
  var d=await r.json();
  return d.authenticated;
}

async function doLogin(){
  var pwd=document.getElementById('pwd').value;
  var errEl=document.getElementById('loginErr');
  errEl.textContent='';
  if(!pwd){errEl.textContent='请输入密码';return;}
  try{
    var r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})});
    var d=await r.json();
    if(d.token){setToken(d.token);showDashboard();}else{errEl.textContent='密码错误';}
  }catch(e){errEl.textContent='登录失败: '+e.message;}
}

function doLogout(){
  fetch('/api/admin/logout',{method:'POST',headers:{'Authorization':'Bearer '+getToken()}});
  clearToken();showLogin();
}

function showLogin(){document.getElementById('login').style.display='block';document.getElementById('dashboard').style.display='none';}
function showDashboard(){document.getElementById('login').style.display='none';document.getElementById('dashboard').style.display='block';load();}

async function deleteAccount(id) {
  if (!confirm('确定删除该账户？此操作不可撤销。')) return;
  var r = await fetch('/api/admin/accounts/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + getToken() } });
  if (r.ok) { load(); } else { alert('删除失败'); }
}
async function resetPassword(id) {
  var pwd = prompt('输入新密码（至少8位）');
  if (!pwd || pwd.length < 8) { if (pwd !== null) alert('密码至少8位'); return; }
  var r = await fetch('/api/admin/accounts/' + id + '/reset-password', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
  if (r.ok) { alert('密码已重置，该用户所有会话已失效'); } else { alert('重置失败'); }
}
async function toggleAccount(id, disabled) {
  var action = disabled ? 'restore' : 'disable';
  if (!confirm(disabled ? '恢复该账户？' : '禁用该账户并结束其会话？')) return;
  var r = await fetch('/api/admin/accounts/' + id + '/' + action, { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() } });
  if (r.ok) load(); else alert('操作失败');
}
async function clearAccountData(id, type) {
  if (!confirm(type === 'profile' ? '删除该用户画像？' : '删除该用户所有云端清单？')) return;
  var r = await fetch('/api/admin/accounts/' + id + '/' + type, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + getToken() } });
  if (r.ok) load(); else alert('操作失败');
}
async function exportPosterErrors() {
  var r=await fetch('/api/admin/poster-errors/export?days=30',{headers:{'Authorization':'Bearer '+getToken()}});
  if(!r.ok){alert('导出失败');return;}
  var blob=await r.blob();
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url; a.download='poster-errors-30d.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
async function cleanLogs(table, action) {
  var labels = {delete_all:'清空全部',delete_7d:'删除7天前',keep_24h:'仅保留24小时',delete_24h:'删除最近24小时',keep_1h:'仅保留1小时',delete_1h:'删除最近1小时'};
  var tableLabel = table==='all'?'全部日志':table;
  if(!confirm('确定对 '+tableLabel+' 执行「'+(labels[action]||action)+'」？')) return;
  try {
    var r = await fetch('/api/admin/logs/clean',{method:'POST',headers:{'Authorization':'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({table:table,action:action})});
    var d = await r.json();
    var el = document.getElementById('cleanResult');
    if(r.ok) { el.textContent = '完成：删除了 '+d.deleted+' 条记录'; el.style.color='var(--green)'; load(); }
    else { el.textContent = '失败：'+d.error; el.style.color='var(--red)'; }
  } catch(e) { document.getElementById('cleanResult').textContent = '请求失败'; }
}

var CURRENT_TAB = 'overview';
var plazaState = { page: 1, kind: '', q: '', total: 0, loaded: false };

function switchTab(name) {
  CURRENT_TAB = name;
  ['overview','users','plaza','data','cache'].forEach(function(t){
    var pane = document.getElementById('tab-'+t);
    if (pane) pane.classList.toggle('active', t === name);
  });
  var tabButtons = document.querySelectorAll('.dash-tab');
  for (var i = 0; i < tabButtons.length; i++) tabButtons[i].classList.toggle('active', tabButtons[i].getAttribute('data-tab') === name);
  if (name === 'plaza' && !plazaState.loaded) loadPlaza();
  if (name === 'cache' && !CACHE_STATE.loaded) purgeCache(null);
  if (name === 'data') { loadAudit(); loadAiPrompts(); }
}
var CACHE_STATE = { loaded: false, generation: null };
async function purgeCache(scope) {
  var out = document.getElementById('cache-purge-result');
  if (scope) {
    out.textContent = '清除中…';
    try {
      var r = await fetch('/api/admin/cache/clear', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: scope }) });
      var d = await r.json();
      if (!r.ok) { out.textContent = '清除失败: ' + (d.error || r.status); return; }
      CACHE_STATE.loaded = true;
      CACHE_STATE.generation = d.generation;
      renderCacheStatus();
      if (scope !== 'all') return;
    } catch (e) { out.textContent = '清除失败: ' + e.message; return; }
  }
  try {
    var r2 = await fetch('/api/admin/cache/status', { headers: { 'Authorization': 'Bearer ' + getToken() } });
    if (r2.ok) { var d2 = await r2.json(); CACHE_STATE.generation = d2.generation; CACHE_STATE.loaded = true; renderCacheStatus(); }
  } catch (e) { /* 状态展示失败不影响操作 */ }
}
function renderCacheStatus() {
  var out = document.getElementById('cache-purge-result');
  var g = CACHE_STATE.generation || {};
  var parts = [];
  for (var k in g) parts.push(k + ': ' + g[k]);
  if (out && parts.length) out.textContent = '当前缓存代次 — ' + parts.join(' · ');
}
function refreshCurrent(){ if (CURRENT_TAB === 'plaza') loadPlaza(); else load(); }

async function load() {
  try {
    var r = await fetch('/api/admin/dashboard', {headers:{'Authorization':'Bearer '+getToken()}});
    var d = await r.json();
    if (!d.available) { document.getElementById('app').innerHTML = '<div class="error">数据库未连接</div>'; return; }
    var o = d.overview;
    document.getElementById('timestamp').textContent = '更新于 ' + new Date(d.timestamp).toLocaleString('zh-CN');
    renderOverview(d, o);
    renderUsers(d);
    renderData(d);
  } catch (e) {
    document.getElementById('app').innerHTML = '<div class="error">加载失败: ' + esc(e && e.message ? e.message : e) + '</div>';
  }
}

function renderOverview(d, o) {
  var apiLogsHtml = '<table><thead><tr><th>路径</th><th>状态</th><th>耗时</th><th>来源</th><th>错误</th><th>时间</th></tr></thead><tbody>';
  (d.api_logs||[]).forEach(function(l){
    var statusCls = l.status >= 400 ? 'badge-err' : 'badge-ok';
    var time = dbTime(l.created_at).toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    apiLogsHtml += '<tr><td>'+esc(l.path)+'</td><td><span class="badge '+statusCls+'">'+esc(l.status)+'</span></td><td>'+esc(l.duration_ms)+'ms</td><td>'+esc(l.source)+'</td><td style="color:var(--red)">'+esc(l.error||'')+'</td><td style="color:var(--muted)">'+esc(time)+'</td></tr>';
  });
  apiLogsHtml += '</tbody></table>';

  var apiErrorsHtml = '<table><thead><tr><th>路径</th><th>状态</th><th>耗时</th><th>错误信息</th><th>时间</th></tr></thead><tbody>';
  (d.api_errors||[]).forEach(function(l){
    var time = dbTime(l.created_at).toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    apiErrorsHtml += '<tr><td>'+esc(l.path)+'</td><td><span class="badge badge-err">'+esc(l.status)+'</span></td><td>'+esc(l.duration_ms)+'ms</td><td style="color:var(--red)">'+esc(l.error||'')+'</td><td style="color:var(--muted)">'+esc(time)+'</td></tr>';
  });
  apiErrorsHtml += '</tbody></table>';

  var posterErrors = d.poster_errors||[];
  var batchStats = d.poster_batch_stats||{};
  document.getElementById('app').innerHTML = [
    '<div class="grid grid-4" style="margin-bottom:16px">',
      '<div class="card"><h3>总访问</h3><div class="value">',o.total_visits,'</div><div class="sub">今日 ',o.visits_today,' / 7日 ',o.visits_7d,'</div></div>',
      '<div class="card"><h3>排序完成</h3><div class="value green">',o.total_completed,'</div><div class="sub">今日 ',o.completed_today,' / 7日 ',o.completed_7d,'</div></div>',
      '<div class="card"><h3>平均取舍</h3><div class="value blue">',o.avg_comparisons||'--','</div><div class="sub">平均作品数 ',o.avg_items||'--','</div></div>',
      '<div class="card"><h3>完成率</h3><div class="value yellow">',o.completion_rate,'%</div><div class="sub">独立会话 ',o.unique_sessions,'</div></div>',
    '</div>',
    '<div class="grid grid-2" style="margin-bottom:16px">',
      '<div class="card chart-card"><h3>近14天趋势</h3><canvas id="dailyChart"></canvas></div>',
      '<div class="card chart-card"><h3>媒介分布</h3><canvas id="modeChart"></canvas></div>',
    '</div>',
    '<div class="grid grid-2" style="margin-bottom:16px">',
      '<div class="card"><h3 style="margin-bottom:12px">最近API调用</h3>',apiLogsHtml,'</div>',
      '<div class="card"><h3 style="margin-bottom:12px"><span class="status-dot err"></span>API错误记录</h3>',apiErrorsHtml,'</div>',
    '</div>',
    '<div class="grid grid-2" style="margin-bottom:16px">',
      '<div class="card"><h3 style="margin-bottom:12px"><span class="status-dot err"></span>海报获取失败（近7天 ',posterErrors.length,' 条）</h3>',
        posterErrors.length > 0 ? '<table><thead><tr><th>标题</th><th>类型</th><th>来源</th><th>时间</th></tr></thead><tbody>' + posterErrors.slice(0,20).map(function(e) {
          var time = dbTime(e.created_at).toLocaleString('zh-CN', {hour:'2-digit',minute:'2-digit',month:'2-digit',day:'2-digit'});
          return '<tr><td>'+esc(e.title)+'</td><td><span class="badge badge-'+esc(e.media_type)+'">'+esc(e.media_type)+'</span></td><td style="color:var(--muted)">'+esc(e.source||'resolver')+'</td><td style="color:var(--muted)">'+esc(time)+'</td></tr>';
        }).join('') + '</tbody></table>' : '<p style="color:var(--muted);font-size:13px">暂无错误记录</p>',
        '<div style="margin-top:10px"><button data-act="export-poster-errors" style="background:var(--card);border:1px solid var(--border);color:var(--text);padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">导出CSV（近30天）</button></div>',
      '</div>',
      '<div class="card"><h3 style="margin-bottom:12px">海报错误聚合 / 近30天</h3>',
        '<div style="margin-bottom:10px;font-size:12px;color:var(--muted)">批量解析近7天：共 '+(batchStats.total||0)+' 项 · found '+(batchStats.found||0)+' · absent '+(batchStats.absent||0)+' · throttled '+(batchStats.throttled||0)+(batchStats.total?'（占比 '+Math.round((batchStats.throttled||0)/batchStats.total*100)+'%）':'')+' <span title="throttled 占比持续偏高 = 上游限流；absent 突增 = 封面链判断变化。判断依据：poster_batch_stats 表。">ⓘ</span></div>',
        (d.poster_error_summary||[]).length ? '<table><thead><tr><th>媒介</th><th>错误类型</th><th>次数</th></tr></thead><tbody>' + (d.poster_error_summary||[]).map(function(e) { return '<tr><td><span class="badge badge-'+esc(e.media_type)+'">'+esc(e.media_type)+'</span></td><td>'+esc(e.error||'unknown')+'</td><td>'+e.count+'</td></tr>'; }).join('') + '</tbody></table>' : '<p style="color:var(--muted);font-size:13px">暂无聚合数据</p>',
      '</div>',
    '</div>',
    '<div class="grid grid-2">',
      '<div class="card"><h3 style="margin-bottom:12px">最近用户事件</h3>',
        '<table><thead><tr><th>事件</th><th>模式</th><th>详情</th><th>时间</th></tr></thead>',
        '<tbody>', d.recent_events.map(function(e) {
          var badge = 'badge-' + esc(e.event_name);
          var mode = e.mode ? '<span class="badge badge-' + esc(e.mode) + '">' + esc(e.mode) + '</span>' : '';
          var detail = e.item_count ? e.item_count + '件 / ' + (e.comparison_count || '?') + '次' : '';
          var time = dbTime(e.created_at).toLocaleString('zh-CN', {hour:'2-digit',minute:'2-digit',month:'2-digit',day:'2-digit'});
          return '<tr><td><span class="badge ' + badge + '">' + esc(e.event_name) + '</span></td><td>' + mode + '</td><td>' + esc(detail) + '</td><td style="color:var(--muted)">' + esc(time) + '</td></tr>';
        }).join(''), '</tbody></table>',
      '</div>',
      '<div class="card"><h3 style="margin-bottom:12px">系统状态</h3>',
        '<table><tbody>',
          '<tr><td><span class="status-dot ok"></span>数据库</td><td>D1 连接正常</td></tr>',
          '<tr><td><span class="status-dot ok"></span>缓存</td><td>Edge Cache + 内存Map（Top250 15分钟）</td></tr>',
          '<tr><td><span class="status-dot ok"></span>CDN</td><td>Cloudflare 边缘节点全球分发</td></tr>',
          '<tr><td><span class="status-dot ok"></span>图片缓存</td><td>Edge Cache 24小时 + CDN代理</td></tr>',
          '<tr><td><span class="status-dot ok"></span>搜索缓存</td><td>Edge Cache 1小时</td></tr>',
          '<tr><td><span class="status-dot ',(o.total_visits > 0 ? 'ok' : 'warn'),'"></span>分析</td><td>',(o.total_visits > 0 ? '数据收集中' : '暂无数据'),'</td></tr>',
        '</tbody></table>',
        '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">',
          '<h3 style="margin-bottom:8px">媒介使用排行</h3>',
          d.modes.map(function(m) {
            var pct = o.total_completed > 0 ? Math.round(m.count / o.total_completed * 100) : 0;
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="badge badge-' + esc(m.mode) + '" style="width:50px;text-align:center">' + esc(m.mode) + '</span><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--accent);border-radius:3px"></div></div><span style="font-size:12px;color:var(--muted);width:60px;text-align:right">' + m.count + ' (' + pct + '%)</span></div>';
          }).join(''),
        '</div>',
      '</div>',
    '</div>'
  ].join('');
  var dailyData = (d.daily||[]).slice().reverse();
  if(typeof Chart!=='undefined'){
  new Chart(document.getElementById('dailyChart'), {
    type: 'bar',
    data: {
      labels: dailyData.map(function(r) { return r.date.slice(5); }),
      datasets: [
        { label: '访问', data: dailyData.map(function(r) { return r.visits; }), backgroundColor: '#4ade8044', borderColor: '#4ade80', borderWidth: 1, borderRadius: 4 },
        { label: '完成', data: dailyData.map(function(r) { return r.completions; }), backgroundColor: '#60a5fa44', borderColor: '#60a5fa', borderWidth: 1, borderRadius: 4 }
      ]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#8a9a8a', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#8a9a8a' }, grid: { color: '#1a2a1a' } }, y: { ticks: { color: '#8a9a8a' }, grid: { color: '#1a2a1a' }, beginAtZero: true } } }
  });
  var modeColors = { film: '#4ade80', book: '#818cf8', music: '#f472b6', other: '#facc15' };
  new Chart(document.getElementById('modeChart'), {
    type: 'doughnut',
    data: {
      labels: d.modes.map(function(m) { return m.mode; }),
      datasets: [{ data: d.modes.map(function(m) { return m.count; }), backgroundColor: d.modes.map(function(m) { return modeColors[m.mode] || '#666'; }), borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#8a9a8a', font: { size: 11 } } } } }
  });
  }
}

function renderUsers(d) {
  var accounts = d.accounts||[];
  var rowsHtml = accounts.map(function(a) {
    var time = dbTime(a.created_at).toLocaleString('zh-CN', {year:'2-digit',month:'2-digit',day:'2-digit'});
    var disabled = !!a.disabled_at;
    return '<tr><td>'+esc(a.email)+'</td><td>'+esc(a.nickname||'-')+'</td><td><span class="badge '+(disabled?'badge-err':'badge-ok')+'">'+(disabled?'已禁用':'正常')+'</span></td><td style="color:var(--muted)">'+time+'</td><td><button data-act="user-detail" data-arg="'+a.id+'" class="table-action">查看</button> <button data-act="user-toggle" data-arg="'+a.id+'" data-arg2="'+disabled+'" class="table-action '+(disabled?'restore':'warn')+'">'+(disabled?'恢复':'禁用')+'</button> <button data-act="user-clear" data-arg="'+a.id+'" data-arg2="profile" class="table-action">画像</button> <button data-act="user-clear" data-arg="'+a.id+'" data-arg2="collections" class="table-action">清单</button> <button data-act="user-delete" data-arg="'+a.id+'" class="table-action danger">删除</button> <button data-act="user-reset-password" data-arg="'+a.id+'" class="table-action warn">重置密码</button></td></tr>';
  }).join('');
  document.getElementById('users-app').innerHTML = '<div class="card"><h3 style="margin-bottom:12px">用户账户（'+accounts.length+'）</h3>'+(accounts.length ? '<table><thead><tr><th>邮箱</th><th>昵称</th><th>状态</th><th>注册</th><th>操作</th></tr></thead><tbody>'+rowsHtml+'</tbody></table>' : '<p style="color:var(--muted);font-size:13px">暂无注册用户</p>')+'</div>';
}

// ===== 用户画像查看 =====
var KIND_LABELS = { film: '电影', book: '书籍', music: '音乐', other: '其他' };
async function openUserDetail(id){
  var root = document.getElementById('dash-modal-root');
  root.innerHTML = '<div class="dash-modal-backdrop" data-act="modal-backdrop"><div class="dash-modal"><div class="loading">加载中...</div></div></div>';
  try {
    var r = await fetch('/api/admin/accounts/'+id+'/detail',{headers:{'Authorization':'Bearer '+getToken()}});
    var d = await r.json();
    if (!r.ok) throw new Error(d.error||'加载失败');
    var a = d.account||{};
    var disabled = !!a.disabled_at;
    var head = '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3>'+esc(a.nickname||'-')+' <span class="mini-note">#'+a.id+'</span></h3><div class="mini-note">'+esc(a.email||'')+'</div></div><button class="close-x" data-act="modal-close">✕</button></div>';
    var meta = '<div class="mini-note" style="margin:8px 0 12px">注册 '+(a.created_at?dbTime(a.created_at).toLocaleDateString('zh-CN'):'-')+' · <span class="badge '+(disabled?'badge-err':'badge-ok')+'">'+(disabled?'已禁用':'正常')+'</span> · 活跃会话 '+(d.active_sessions||0)+' · OAuth '+(d.oauth_providers&&d.oauth_providers.length?esc(d.oauth_providers.join(' / ')):'无')+' · 广场发帖 '+(d.plaza_post_count||0)+' 篇</div>';
    var profileHtml = '';
    var p = d.profile;
    if (p && p.rankings && p.rankings.length) {
      profileHtml = '<h3 style="font-size:13px;margin:14px 0 4px">画像「'+esc(p.profileName||'-')+'」（'+p.rankings.length+' 个榜单 / '+p.rankings.reduce(function(s,e){return s+(e.items?e.items.length:0);},0)+' 件作品'+(d.profile_updated_at?' · 更新于 '+dbTime(d.profile_updated_at).toLocaleDateString('zh-CN'):'')+'）</h3>';
      profileHtml += p.rankings.map(function(entry){
        var items = (entry.items||[]).map(function(w,i){
          var rank = Number(w.rank) || (i+1);
          var poster = (w.posterUrls&&w.posterUrls[0]) ? '<img src="/api/image?url='+encodeURIComponent(w.posterUrls[0])+'" alt="" style="width:24px;height:34px;object-fit:cover;border-radius:2px;flex-shrink:0" referrerpolicy="no-referrer">' : '';
          return '<div class="rank-row">'+poster+'<span class="rank-medal">'+(rank<=3?(rank===1?'🥇':rank===2?'🥈':'🥉'):String(rank).padStart(2,'0'))+'</span><div style="min-width:0"><strong>'+esc(w.title)+'</strong><div class="mini-note">'+esc(w.creator||'')+' '+esc(w.year||'')+'</div></div></div>';
        }).join('');
        return '<div style="margin-bottom:14px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span class="badge badge-'+esc(entry.kind)+'">'+esc(KIND_LABELS[entry.kind]||entry.kind)+'</span><strong style="font-size:13px">'+esc(entry.collectionTitle)+'</strong><span class="mini-note">TOP '+((entry.items||[]).length)+'</span></div>'+(items||'<p class="mini-note">空榜单</p>')+'</div>';
      }).join('');
    } else {
      profileHtml = '<h3 style="font-size:13px;margin:14px 0 4px">画像</h3><p class="mini-note">该用户尚未创建画像</p>';
    }
    var noteEntries = Object.entries(d.notes||{}).filter(function(kv){ return kv[1] && String(kv[1]).trim(); });
    var notesHtml = '<h3 style="font-size:13px;margin:14px 0 4px">批注（'+noteEntries.length+' 条）</h3>'+(noteEntries.length ? noteEntries.map(function(kv){
      var scopeLabel = kv[0].indexOf('work:')===0?'作品批注':kv[0].indexOf('ranking:')===0?'榜单批注':'画像批注';
      return '<div class="comment-row"><div class="mini-note">'+scopeLabel+' · <code>'+esc(kv[0])+'</code></div><div style="margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere">'+esc(String(kv[1]))+'</div></div>';
    }).join('') : '<p class="mini-note">无批注</p>');
    var collections = d.collections||[];
    var collectionsHtml = '<h3 style="font-size:13px;margin:14px 0 4px">云端清单（'+collections.length+'）</h3>'+(collections.length ? '<table><thead><tr><th>标题</th><th>媒介</th><th>作品数</th><th>更新</th></tr></thead><tbody>'+collections.map(function(c){
      return '<tr><td>'+esc(c.title)+'</td><td><span class="badge badge-'+esc(c.kind)+'">'+esc(KIND_LABELS[c.kind]||c.kind)+'</span></td><td>'+(c.item_count||0)+'</td><td style="color:var(--muted)">'+(c.updated_at?dbTime(c.updated_at).toLocaleDateString('zh-CN'):'-')+'</td></tr>';
    }).join('')+'</tbody></table>' : '<p class="mini-note">无云端清单</p>');
    root.innerHTML = '<div class="dash-modal-backdrop" data-act="modal-backdrop"><div class="dash-modal">'+head+meta+profileHtml+notesHtml+collectionsHtml+'<div class="mini-note" style="margin-top:14px">删除/禁用/重置密码等操作请在「用户」页签表格中进行</div></div></div>';
  } catch(e){ root.innerHTML = '<div class="dash-modal-backdrop" data-act="modal-backdrop"><div class="dash-modal"><div class="error">加载失败: '+esc(e&&e.message?e.message:e)+'</div></div></div>'; }
}

function renderData(d) {
  lastDashData = d;
  var storageRows = (d.storage||[]).concat(d.storage_extended||[]).map(function(s) {
    return '<tr><td>'+esc(s.tbl)+'</td><td style="text-align:right;font-variant-numeric:tabular-nums">'+Number(s.cnt).toLocaleString()+' 行</td></tr>';
  }).join('');
  var sessionCount = storageCount(d, 'user_sessions');
  var linkCount = storageCount(d, 'shared_links');
  document.getElementById('data-app').innerHTML = '<div class="grid grid-2">'+
    '<div class="card"><h3 style="margin-bottom:12px">D1 存储统计</h3><table><tbody>'+storageRows+'</tbody></table>'+
      '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"><h3 style="margin-bottom:6px">缓存策略</h3><table><tbody>'+
        '<tr><td>海报/图片</td><td style="color:var(--muted)">Edge Cache 24h</td></tr>'+
        '<tr><td>搜索结果</td><td style="color:var(--muted)">Edge Cache 1h</td></tr>'+
        '<tr><td>Top250索引</td><td style="color:var(--muted)">内存Map 15min</td></tr>'+
        '<tr><td>详情页</td><td style="color:var(--muted)">Edge Cache 24h</td></tr>'+
        '<tr><td>API日志</td><td style="color:var(--muted)">D1 持久化</td></tr>'+
      '</tbody></table></div></div>'+
    '<div>'+
    '<div class="card" style="margin-bottom:16px"><h3 style="margin-bottom:12px">会话与链接管理</h3>'+
      '<div class="reset-card"><div>用户活跃会话<div class="sub">'+sessionCount+' 个在线会话</div></div><button class="table-action warn" data-act="revoke-sessions">强制下线全部用户</button></div>'+
      '<div class="reset-card"><div>分享短链<div class="sub">'+linkCount+' 条（含未过期）</div></div><button class="table-action" data-act="clean-links">清理过期链接</button></div>'+
      '<div class="reset-card"><div>管理后台密码<div class="sub">DB 密码模式可在此修改；环境变量密码需到 Cloudflare 设置</div></div><button class="table-action" data-act="change-admin-password">修改密码</button></div>'+
    '</div>'+
    '<div class="card"><h3 style="margin-bottom:12px">日志清理</h3>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+
        '<button data-act="clean-logs" data-arg="all" data-arg2="delete_all" class="table-action danger">清空全部日志</button>'+
        '<button data-act="clean-logs" data-arg="all" data-arg2="delete_7d" class="table-action warn">删除7天前</button>'+
        '<button data-act="clean-logs" data-arg="all" data-arg2="keep_24h" class="table-action">仅保留24小时</button>'+
        '<button data-act="clean-logs" data-arg="all" data-arg2="delete_24h" class="table-action warn">删除最近24小时</button>'+
        '<button data-act="clean-logs" data-arg="all" data-arg2="keep_1h" class="table-action">仅保留1小时</button>'+
        '<button data-act="clean-logs" data-arg="all" data-arg2="delete_1h" class="table-action warn">删除最近1小时</button>'+
      '</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">'+
        '<span style="color:var(--muted);font-size:11px;line-height:26px">单表：</span>'+
        '<button data-act="clean-logs" data-arg="api_logs" data-arg2="delete_all" class="table-action">清空API日志</button>'+
        '<button data-act="clean-logs" data-arg="analytics_events" data-arg2="delete_all" class="table-action">清空分析事件</button>'+
        '<button data-act="clean-logs" data-arg="poster_errors" data-arg2="delete_all" class="table-action">清空海报错误</button>'+
      '</div>'+
      '<div id="cleanResult" style="font-size:12px;color:var(--muted);margin-top:6px"></div>'+
    '</div></div>'+
    '<div class="danger-zone"><h3>⚠ 危险区 · 分级数据重置（不可恢复）</h3>'+
      ['analytics','plaza','shares','accounts'].map(function(scope){
        var meta = RESET_META[scope];
        return '<div class="reset-card"><div><strong>'+meta.label+'</strong><div class="sub">'+meta.desc+'</div></div><button class="table-action '+(scope==='accounts'?'danger':'warn')+'" data-act="reset-open" data-arg="'+scope+'">一键重置</button></div>';
      }).join('')+
      '<p class="mini-note">执行需输入确认短语 RESET 并重新验证管理员密码；所有重置操作都会写入审计日志。建议重置前先用 wrangler d1 export 导出备份。</p>'+
    '</div>'+
    '<div class="card" style="margin-top:16px"><h3 style="margin-bottom:12px">AI 提示词覆盖（三场景，留空 = 使用内置默认模块）</h3><div id="ai-prompts" class="loading">加载中...</div></div>'+
    '<div class="card" style="margin-top:16px"><h3 style="margin-bottom:12px">管理操作审计日志</h3><div id="audit-app" class="loading">加载中...</div></div>';
}
function storageCount(d, tbl){
  var rows = (d.storage||[]).concat(d.storage_extended||[]);
  for (var i = 0; i < rows.length; i++) { if (rows[i].tbl === tbl) return Number(rows[i].cnt); }
  return 0;
}

// ===== 分级重置 / 审计 / 会话管理 =====
var lastDashData = null;
var RESET_META = {
  analytics: { label: '清空运行数据', desc: '删除全部分析事件、API 日志与海报错误记录，不影响用户数据。', tables: ['analytics_events','api_logs','poster_errors'] },
  plaza: { label: '清空广场内容', desc: '删除全部广场帖子、点赞与评论，用户账户不受影响。', tables: ['plaza_posts','plaza_likes','plaza_comments'] },
  shares: { label: '清空分享短链', desc: '删除全部分享链接，已发出的链接将立即失效。', tables: ['shared_links'] },
  accounts: { label: '删除全部用户账户（最高危）', desc: '删除全部用户账户及级联数据：画像、云端清单、会话、OAuth 绑定、广场内容、分享链接。不可恢复。', tables: ['user_accounts','user_profiles_v2','user_collections','user_sessions','user_oauth','plaza_posts','plaza_likes','plaza_comments','shared_links'] }
};
function openResetConfirm(scope){
  var meta = RESET_META[scope];
  if (!meta) return;
  var countRows = meta.tables.map(function(t){
    return '<tr><td>'+esc(t)+'</td><td style="text-align:right">'+storageCount(lastDashData, t).toLocaleString()+' 行</td></tr>';
  }).join('');
  var root = document.getElementById('dash-modal-root');
  root.innerHTML = '<div class="dash-modal-backdrop" data-act="modal-backdrop"><div class="dash-modal">'+
    '<button class="close-x" data-act="modal-close">✕</button>'+
    '<h3>确认重置：'+esc(meta.label)+'</h3>'+
    '<p style="font-size:13px;color:var(--muted);line-height:1.7">'+esc(meta.desc)+'</p>'+
    '<table style="margin:10px 0"><tbody>'+countRows+'</tbody></table>'+
    '<div class="dash-confirm-row">'+
      '<label class="mini-note">输入 <strong style="color:var(--red)">RESET</strong> 确认（区分大小写）</label><input id="resetConfirmInput" autocomplete="off" placeholder="RESET">'+
      '<label class="mini-note">管理员密码</label><input id="resetPasswordInput" type="password" autocomplete="off" placeholder="管理员密码">'+
      '<button class="table-action danger" style="padding:9px" data-act="reset-execute" data-arg="'+scope+'">执行重置（不可恢复）</button>'+
    '</div></div></div>';
  document.getElementById('resetConfirmInput').focus();
}
async function executeReset(scope){
  var confirmText = (document.getElementById('resetConfirmInput').value||'').trim();
  var password = (document.getElementById('resetPasswordInput').value||'');
  if (confirmText !== 'RESET') { alert('确认短语不正确，需精确输入 RESET'); return; }
  if (!password) { alert('请输入管理员密码'); return; }
  if (!confirm('最后确认：此操作不可恢复，确定执行？')) return;
  var r = await fetch('/api/admin/reset',{method:'POST',headers:{'Authorization':'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({scope:scope,confirm:confirmText,password:password})});
  var d = await r.json().catch(function(){ return {}; });
  if (r.ok) { alert('重置完成：'+scope); closeDashModal(); load(); }
  else alert('重置失败：'+(d.msg||d.error||('HTTP '+r.status)));
}
async function revokeAllSessions(){
  if (!confirm('强制下线全部用户？所有登录用户的本地 token 将失效。')) return;
  var r = await fetch('/api/admin/sessions/revoke-all',{method:'POST',headers:{'Authorization':'Bearer '+getToken()}});
  var d = await r.json().catch(function(){ return {}; });
  if (r.ok) { alert('已清除 '+d.revoked+' 个会话'); load(); } else alert('操作失败');
}
async function cleanExpiredLinks(){
  var r = await fetch('/api/admin/links/clean-expired',{method:'POST',headers:{'Authorization':'Bearer '+getToken()}});
  var d = await r.json().catch(function(){ return {}; });
  if (r.ok) { alert('已清理 '+d.deleted+' 条过期链接'); load(); } else alert('操作失败');
}
async function changeAdminPassword(){
  var oldPwd = prompt('输入旧的管理密码');
  if (!oldPwd) return;
  var newPwd = prompt('输入新密码（至少10位）');
  if (!newPwd || newPwd.length < 10) { if (newPwd !== null) alert('密码至少10位'); return; }
  var r = await fetch('/api/admin/change-password',{method:'POST',headers:{'Authorization':'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({old_password:oldPwd,new_password:newPwd})});
  var d = await r.json().catch(function(){ return {}; });
  if (r.ok) { alert('管理密码已更新，所有管理会话已失效，请重新登录'); localStorage.removeItem(TOKEN_KEY); location.reload(); } else alert('修改失败：'+(d.msg||d.error||('HTTP '+r.status)));
}
async function loadAudit(){
  var el = document.getElementById('audit-app');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/audit?limit=100',{headers:{'Authorization':'Bearer '+getToken()}});
    var d = await r.json();
    if (!r.ok) throw new Error(d.error||'加载失败');
    var entries = d.entries||[];
    el.classList.remove('loading');
    el.innerHTML = entries.length ? '<table><thead><tr><th>时间</th><th>操作</th><th>详情</th><th>来源IP</th></tr></thead><tbody>'+entries.map(function(e){
      var time = dbTime(e.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
      return '<tr class="audit-row"><td style="color:var(--muted);white-space:nowrap">'+esc(time)+'</td><td><span class="badge badge-visit">'+esc(e.action)+'</span></td><td>'+esc(e.detail||'')+'</td><td style="color:var(--muted)">'+esc(e.ip||'-')+'</td></tr>';
    }).join('')+'</tbody></table>' : '<p style="color:var(--muted);font-size:13px">暂无审计记录</p>';
  } catch(e){ el.innerHTML = '<p style="color:var(--red);font-size:13px">审计日志加载失败</p>'; }
}

// ===== AI 提示词覆盖（三场景在线调优）=====
async function loadAiPrompts() {
  var el = document.getElementById('ai-prompts');
  if (!el) return;
  try {
    var r = await fetch('/api/admin/ai/prompts', { headers: { 'Authorization': 'Bearer ' + getToken() } });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || '加载失败');
    var scenes = [['ranking', '榜单点评'], ['profile', '画像点评'], ['compare', '比较解读']];
    el.classList.remove('loading');
    el.innerHTML = scenes.map(function(s) {
      var p = (d.prompts && d.prompts[s[0]]) || {};
      return '<div style="margin-bottom:12px">' +
        '<div class="mini-note" style="margin-bottom:4px">' + s[1] + (p.override ? ' · <span style="color:var(--yellow)">覆盖中</span>（响应 promptVersion=override）' : ' · 默认模块') + '</div>' +
        '<textarea id="ai-prompt-' + s[0] + '" style="width:100%;min-height:72px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;padding:8px" placeholder="留空使用默认提示词；仅覆盖指令部分，作品数据始终由服务端渲染">' + esc(p.value || '') + '</textarea>' +
        '<div style="display:flex;gap:6px;margin-top:4px">' +
          '<button class="table-action" data-act="ai-prompt-save" data-arg="' + s[0] + '">保存覆盖</button>' +
          (p.override ? '<button class="table-action warn" data-act="ai-prompt-clear" data-arg="' + s[0] + '">恢复默认</button>' : '') +
        '</div></div>';
    }).join('');
  } catch(e) { el.classList.remove('loading'); el.textContent = '加载失败'; }
}
async function saveAiPrompt(scene) {
  var value = (document.getElementById('ai-prompt-' + scene).value || '').trim();
  if (!value) { alert('提示词不能为空；要回到默认请点「恢复默认」'); return; }
  var r = await fetch('/api/admin/ai/prompt/' + scene, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ system: value }) });
  if (r.ok) { alert('已保存覆盖'); loadAiPrompts(); } else alert('保存失败');
}
async function clearAiPrompt(scene) {
  if (!confirm('清除「' + scene + '」的覆盖，恢复默认提示词？')) return;
  var r = await fetch('/api/admin/ai/prompt/' + scene, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + getToken() } });
  if (r.ok) { loadAiPrompts(); } else alert('操作失败');
}

// ===== 广场管理 =====
async function loadPlaza() {
  plazaState.loaded = true;
  var el = document.getElementById('plaza-app');
  el.innerHTML = '<div class="loading">加载中...</div>';
  try {
    var qs = '?page='+plazaState.page+'&limit=20'+(plazaState.kind?'&kind='+encodeURIComponent(plazaState.kind):'')+(plazaState.q?'&q='+encodeURIComponent(plazaState.q):'');
    var r = await fetch('/api/admin/plaza/posts'+qs, {headers:{'Authorization':'Bearer '+getToken()}});
    var d = await r.json();
    if (!r.ok) throw new Error(d.error||'加载失败');
    plazaState.total = d.total||0;
    renderPlaza(d);
  } catch(e){ el.innerHTML = '<div class="error">加载失败: '+esc(e&&e.message?e.message:e)+'</div>'; }
}

function renderPlaza(d) {
  var kinds = [['','全部媒介'],['film','电影'],['book','书籍'],['music','音乐'],['other','其他']];
  var pages = Math.max(1, Math.ceil(plazaState.total / 20));
  var rows = (d.posts||[]).map(function(p){
    var time = dbTime(p.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    var hidden = !p.is_public;
    var liveComments = p.live_comment_count != null ? p.live_comment_count : (p.comment_count||0);
    return '<tr><td style="color:var(--muted)">#'+p.id+'</td><td>'+esc(p.collection_title)+'</td><td>'+esc(p.nickname||'-')+'<div class="mini-note">'+esc(p.email||'')+'</div></td><td><span class="badge badge-'+esc(p.kind||'other')+'">'+esc(p.kind||'-')+'</span></td><td>'+(p.item_count||0)+'</td><td>'+(p.like_count||0)+'</td><td>'+liveComments+'</td><td>'+(hidden?'<span class="badge badge-err">已隐藏</span>':'<span class="badge badge-ok">公开</span>')+'</td><td style="color:var(--muted)">'+time+'</td><td><button class="table-action" data-act="plaza-detail" data-arg="'+p.id+'">详情</button> <button class="table-action '+(hidden?'restore':'warn')+'" data-act="plaza-toggle" data-arg="'+p.id+'" data-arg2="'+(hidden?1:0)+'">'+(hidden?'恢复':'隐藏')+'</button> <button class="table-action danger" data-act="plaza-delete" data-arg="'+p.id+'">删除</button></td></tr>';
  }).join('');
  var kindOptions = kinds.map(function(k){ return '<option value="'+k[0]+'"'+(plazaState.kind===k[0]?' selected':'')+'>'+k[1]+'</option>'; }).join('');
  document.getElementById('plaza-app').innerHTML = [
    '<div class="grid grid-4" style="margin-bottom:16px">',
      '<div class="card"><h3>帖子总数</h3><div class="value">'+plazaState.total+'</div></div>',
    '</div>',
    '<div class="card">',
      '<div class="plaza-toolbar"><select id="plazaKind" data-change="plaza-filter">'+kindOptions+'</select><input id="plazaQ" placeholder="标题 / 昵称 / 邮箱搜索" value="'+esc(plazaState.q)+'" style="width:220px" data-enter="plaza-filter"><button class="refresh-btn" data-act="plaza-filter">搜索</button><button class="refresh-btn" data-act="plaza-load">刷新</button><span class="mini-note">隐藏不会删除数据，可随时恢复显示</span></div>',
      '<table><thead><tr><th>ID</th><th>榜单</th><th>作者</th><th>媒介</th><th>作品</th><th>赞</th><th>评论</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>'+(rows || '<tr><td colspan="10" style="color:var(--muted)">暂无帖子</td></tr>')+'</tbody></table>',
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:14px"><button class="refresh-btn" data-act="plaza-page" data-arg="'+(plazaState.page-1)+'"'+(plazaState.page<=1?' disabled':'')+'>上一页</button><span class="mini-note" style="line-height:30px">第 '+plazaState.page+' / '+pages+' 页</span><button class="refresh-btn" data-act="plaza-page" data-arg="'+(plazaState.page+1)+'"'+(plazaState.page>=pages?' disabled':'')+'>下一页</button></div>',
    '</div>'
  ].join('');
}
function plazaApplyFilter(){ plazaState.kind = document.getElementById('plazaKind').value; plazaState.q = document.getElementById('plazaQ').value.trim(); plazaState.page = 1; loadPlaza(); }
function plazaPage(p){ if (p < 1) return; plazaState.page = p; loadPlaza(); }
async function togglePlazaPost(id, makePublic){
  if (!confirm(makePublic ? '恢复显示帖子 #'+id+'？' : '隐藏帖子 #'+id+'？前台将不再展示。')) return;
  var r = await fetch('/api/admin/plaza/posts/'+id+'/visibility',{method:'POST',headers:{'Authorization':'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({is_public:makePublic})});
  if (r.ok) loadPlaza(); else alert('操作失败');
}
async function deletePlazaPost(id){
  if (!confirm('确定删除帖子 #'+id+'？其评论与点赞将一并清除，不可恢复。')) return;
  var r = await fetch('/api/admin/plaza/posts/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+getToken()}});
  if (r.ok) loadPlaza(); else alert('删除失败');
}
async function openPlazaDetail(id){
  var root = document.getElementById('dash-modal-root');
  root.innerHTML = '<div class="dash-modal-backdrop" data-act="modal-backdrop"><div class="dash-modal"><div class="loading">加载中...</div></div></div>';
  try {
    var r = await fetch('/api/admin/plaza/posts/'+id,{headers:{'Authorization':'Bearer '+getToken()}});
    var d = await r.json();
    if (!r.ok) throw new Error(d.error||'加载失败');
    var p = d.post;
    var items = (p.items||[]).map(function(w,i){
      var rank = Number(w.rank) || (i+1);
      return '<div class="rank-row"><span class="rank-medal">'+(rank<=3?(rank===1?'🥇':rank===2?'🥈':'🥉'):String(rank).padStart(2,'0'))+'</span><div style="min-width:0"><strong>'+esc(w.title)+'</strong><div class="mini-note">'+esc(w.creator||'')+' '+esc(w.year||'')+'</div></div></div>';
    }).join('');
    var comments = (d.comments||[]).map(function(c){
      var time = dbTime(c.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      return '<div class="comment-row"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span><strong>'+esc(c.nickname||'匿名')+'</strong> <span class="mini-note">'+esc(c.email||'')+' · '+time+'</span></span><button class="table-action danger" data-act="plaza-comment-delete" data-arg="'+c.id+'" data-arg2="'+p.id+'">删除</button></div><div style="margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere">'+esc(c.content)+'</div></div>';
    }).join('');
    root.innerHTML = '<div class="dash-modal-backdrop" data-act="modal-backdrop"><div class="dash-modal"><button class="close-x" data-act="modal-close">✕</button><h3>'+esc(p.collection_title)+' <span class="mini-note">#'+p.id+'</span></h3><div class="mini-note" style="margin-bottom:10px">作者 '+esc(p.nickname||'匿名')+'（'+esc(p.email||'-')+'） · '+(p.is_public?'公开':'已隐藏')+' · 赞 '+(p.like_count||0)+'</div>'+(p.description?'<p style="font-size:13px;color:var(--muted);margin-bottom:10px">'+esc(p.description)+'</p>':'')+'<h3 style="font-size:13px;margin:12px 0 4px">榜单内容（'+(p.items||[]).length+' 件）</h3>'+(items||'<p class="mini-note">无</p>')+'<h3 style="font-size:13px;margin:14px 0 4px">评论（'+(d.comments||[]).length+' 条）</h3>'+(comments||'<p class="mini-note">暂无评论</p>')+'</div></div>';
  } catch(e){ root.innerHTML = '<div class="dash-modal-backdrop" data-act="modal-backdrop"><div class="dash-modal"><div class="error">加载失败: '+esc(e&&e.message?e.message:e)+'</div></div></div>'; }
}
async function deletePlazaComment(commentId, postId){
  if (!confirm('删除该评论？其回复将一并删除。')) return;
  var r = await fetch('/api/admin/plaza/comments/'+commentId,{method:'DELETE',headers:{'Authorization':'Bearer '+getToken()}});
  if (r.ok) openPlazaDetail(postId); else alert('删除失败');
}
function closeDashModal(){ document.getElementById('dash-modal-root').innerHTML=''; }

(async function(){
  var authed = await checkAuth();
  if(authed) showDashboard(); else showLogin();
})();
`;
