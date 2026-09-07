import { doubanTop250, doubanSuggest, doubanBookTop250, doubanBookSuggest, doubanMusicTop250, doubanSearch, doubanBookDetail, doubanMovieDetail, doubanMusicDetail, proxyImage, resolvePosters } from "./media";
import { accountRoute } from "./account";

export interface Env {
  DB?: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

type JsonObject = Record<string, unknown>;

const EVENT_NAMES = new Set([
  "visit",
  "list_opened",
  "list_selected",
  "sorting_started",
  "comparison_made",
  "ranking_completed",
  "poster_downloaded",
  "share_copied",
  "result_viewed",
  "qr_viewed",
  "home_content_rendered",
  "experiment_exposed",
  "heavy_config_viewed",
  "default_start_clicked",
  "sorting_scope_reduced",
  "result_share_prompt_clicked",
]);

// Only product metadata may leave the browser. Movie titles, rankings and free text are excluded.
const EVENT_PAYLOAD_KEYS = new Set([
  "app_version",
  "challenge_id",
  "comparison_count",
  "experiment_id",
  "item_count",
  "lang",
  "list_id",
  "mode",
  "source",
  "template_id",
  "top_k",
  "utm_campaign",
  "utm_medium",
  "utm_source",
  "variant_id",
]);

const STRING_PAYLOAD_KEYS = new Set([
  "app_version",
  "challenge_id",
  "experiment_id",
  "lang",
  "list_id",
  "mode",
  "source",
  "template_id",
  "utm_campaign",
  "utm_medium",
  "utm_source",
  "variant_id",
]);

const NUMBER_PAYLOAD_KEYS = new Set(["comparison_count", "item_count", "top_k"]);
const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const CHALLENGE_ID = /^mv-[a-z0-9]{12}$/;
const MAX_REQUEST_BYTES = 48 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 2 * 1024;
const MAX_CHALLENGE_ITEMS = 300;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ART/RANK 后台看板</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0c0a;--card:#141914;--border:#2a3a2a;--accent:#d8f86a;--muted:#8a9a8a;--text:#e0e8e0;--green:#4ade80;--red:#f87171;--blue:#60a5fa;--yellow:#facc15}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:24px}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
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
</style>
</head>
<body>
<div id="login" style="display:none">
  <h2>ART/RANK 后台</h2>
  <div class="err" id="loginErr"></div>
  <input type="password" id="pwd" placeholder="管理密码" onkeydown="if(event.key==='Enter')doLogin()">
  <button onclick="doLogin()">登录</button>
</div>
<div id="dashboard" style="display:none">
<div class="header">
  <h1>ART<span>/</span>RANK <span>后台看板</span></h1>
  <div style="display:flex;align-items:center;gap:12px">
    <span class="meta" id="timestamp"></span>
    <button class="refresh-btn" onclick="load()">刷新</button>
    <button class="logout-btn" onclick="doLogout()">退出</button>
  </div>
</div>
<div id="app" class="loading">加载中...</div>
</div>
<script>
var TOKEN_KEY = 'art-rank-admin-token';
function getToken(){return localStorage.getItem(TOKEN_KEY)||''}
function setToken(t){localStorage.setItem(TOKEN_KEY,t)}
function clearToken(){localStorage.removeItem(TOKEN_KEY)}

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

async function load() {
  try {
    var r = await fetch('/api/admin/dashboard', {headers:{'Authorization':'Bearer '+getToken()}});
    var d = await r.json();
    if (!d.available) { document.getElementById('app').innerHTML = '<div class="error">数据库未连接</div>'; return; }
    var o = d.overview;
    document.getElementById('timestamp').textContent = '更新于 ' + new Date(d.timestamp).toLocaleString('zh-CN');

    var apiLogsHtml = '<table><thead><tr><th>路径</th><th>状态</th><th>耗时</th><th>来源</th><th>错误</th><th>时间</th></tr></thead><tbody>';
    (d.api_logs||[]).forEach(function(l){
      var statusCls = l.status >= 400 ? 'badge-err' : 'badge-ok';
      var time = new Date(l.created_at).toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      apiLogsHtml += '<tr><td>'+l.path+'</td><td><span class="badge '+statusCls+'">'+l.status+'</span></td><td>'+l.duration_ms+'ms</td><td>'+l.source+'</td><td style="color:var(--red)">'+(l.error||'')+'</td><td style="color:var(--muted)">'+time+'</td></tr>';
    });
    apiLogsHtml += '</tbody></table>';

    var apiErrorsHtml = '<table><thead><tr><th>路径</th><th>状态</th><th>耗时</th><th>错误信息</th><th>时间</th></tr></thead><tbody>';
    (d.api_errors||[]).forEach(function(l){
      var time = new Date(l.created_at).toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      apiErrorsHtml += '<tr><td>'+l.path+'</td><td><span class="badge badge-err">'+l.status+'</span></td><td>'+l.duration_ms+'ms</td><td style="color:var(--red)">'+(l.error||'')+'</td><td style="color:var(--muted)">'+time+'</td></tr>';
    });
    apiErrorsHtml += '</tbody></table>';

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
        '<div class="card"><h3 style="margin-bottom:12px">用户账户 (',(d.accounts||[]).length,')</h3>',
          '<table><thead><tr><th>邮箱</th><th>昵称</th><th>会话</th><th>画像</th><th>注册</th></tr></thead>',
          '<tbody>', (d.accounts||[]).map(function(a) {
            var time = new Date(a.created_at).toLocaleString('zh-CN', {year:'2-digit',month:'2-digit',day:'2-digit'});
            var profileTime = a.profile_updated ? new Date(a.profile_updated).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit'}) : '-';
            return '<tr><td>'+a.email+'</td><td>'+(a.nickname||'-')+'</td><td>'+a.active_sessions+'</td><td>'+profileTime+'</td><td style="color:var(--muted)">'+time+'</td></tr>';
          }).join(''), '</tbody></table>',
        '</div>',
        '<div class="card"><h3 style="margin-bottom:12px">D1 存储</h3>',
          '<table><tbody>',
            (d.storage||[]).map(function(s) {
              return '<tr><td>'+s.tbl+'</td><td style="text-align:right;font-variant-numeric:tabular-nums">'+Number(s.cnt).toLocaleString()+' 行</td></tr>';
            }).join(''),
          '</tbody></table>',
          '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">',
            '<h3 style="margin-bottom:6px">缓存策略</h3>',
            '<table><tbody>',
              '<tr><td>海报/图片</td><td style="color:var(--muted)">Edge Cache 24h</td></tr>',
              '<tr><td>搜索结果</td><td style="color:var(--muted)">Edge Cache 1h</td></tr>',
              '<tr><td>Top250索引</td><td style="color:var(--muted)">内存Map 15min</td></tr>',
              '<tr><td>详情页</td><td style="color:var(--muted)">Edge Cache 24h</td></tr>',
              '<tr><td>API日志</td><td style="color:var(--muted)">D1 持久化</td></tr>',
            '</tbody></table>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="grid grid-2">',
        '<div class="card"><h3 style="margin-bottom:12px">最近用户事件</h3>',
          '<table><thead><tr><th>事件</th><th>模式</th><th>详情</th><th>时间</th></tr></thead>',
          '<tbody>', d.recent_events.map(function(e) {
            var badge = 'badge-' + e.event_name;
            var mode = e.mode ? '<span class="badge badge-' + e.mode + '">' + e.mode + '</span>' : '';
            var detail = e.item_count ? e.item_count + '件 / ' + (e.comparison_count || '?') + '次' : '';
            var time = new Date(e.created_at).toLocaleString('zh-CN', {hour:'2-digit',minute:'2-digit',month:'2-digit',day:'2-digit'});
            return '<tr><td><span class="badge ' + badge + '">' + e.event_name + '</span></td><td>' + mode + '</td><td>' + detail + '</td><td style="color:var(--muted)">' + time + '</td></tr>';
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
              return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="badge badge-' + m.mode + '" style="width:50px;text-align:center">' + m.mode + '</span><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:var(--accent);border-radius:3px"></div></div><span style="font-size:12px;color:var(--muted);width:60px;text-align:right">' + m.count + ' (' + pct + '%)</span></div>';
            }).join(''),
          '</div>',
        '</div>',
      '</div>'
    ].join('');
    var dailyData = d.daily.reverse();
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
  } catch (e) {
    document.getElementById('app').innerHTML = '<div class="error">加载失败: ' + e.message + '</div>';
  }
}

(async function(){
  var authed = await checkAuth();
  if(authed) showDashboard(); else showLogin();
})();
<\/script>
</body>
</html>`;

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return withSecurityHeaders(new Response(JSON.stringify(data), { status, headers }));
}

function withSecurityHeaders(response: Response): Response {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    result.headers.set(key, value);
  }
  return result;
}

// ===== API Logging =====
async function logApiCall(env: Env | undefined, path: string, method: string, status: number, durationMs: number, source: string, error?: string, ip?: string) {
  if (!env?.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO api_logs (path, method, status, duration_ms, source, error, ip) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(path, method, status, durationMs, source, error ?? null, ip ?? null).run();
  } catch { /* logging should never break the request */ }
}

// ===== Admin Auth =====
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

async function adminAuth(request: Request, env: Env): Promise<boolean> {
  if (!env.DB) return false;
  const token = getAdminToken(request);
  if (!token || token.length < 32) return false;
  try {
    const session = await env.DB.prepare(
      "SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
    ).bind(token).first();
    return !!session;
  } catch { return false; }
}

function getAdminToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return new URL(request.url).searchParams.get("token");
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "cross_origin_forbidden", "Cross-origin writes are not allowed.");
  }
}

function parseContentLength(request: Request): void {
  const value = request.headers.get("content-length");
  if (value && Number(value) > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }
}

async function readJson(request: Request): Promise<JsonObject> {
  parseContentLength(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "json_required", "Content-Type must be application/json.");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_field", `${field} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new HttpError(400, "invalid_field", `${field} has an invalid length or characters.`);
  }
  return cleaned;
}

function cleanOptionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return cleanString(value, field, maxLength);
}

function cleanOptionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new HttpError(400, "invalid_field", `${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function validateEventPayload(value: unknown): JsonObject {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) {
    throw new HttpError(400, "invalid_payload", "payload must be an object.");
  }

  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (!EVENT_PAYLOAD_KEYS.has(key)) {
      throw new HttpError(400, "private_payload_field", `payload.${key} is not collected.`);
    }
    if (STRING_PAYLOAD_KEYS.has(key)) {
      output[key] = cleanString(item, `payload.${key}`, 100);
    } else if (NUMBER_PAYLOAD_KEYS.has(key)) {
      output[key] = cleanOptionalInteger(item, `payload.${key}`, 0, 10000);
    }
  }

  const encoded = JSON.stringify(output);
  if (new TextEncoder().encode(encoded).byteLength > MAX_EVENT_PAYLOAD_BYTES) {
    throw new HttpError(413, "payload_too_large", "Event payload is too large.");
  }
  return output;
}

async function createEvent(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  const body = await readJson(request);
  const eventName = cleanString(body.event_name, "event_name", 64);
  const sessionId = cleanString(body.session_id, "session_id", 64);

  if (!EVENT_NAMES.has(eventName)) {
    throw new HttpError(400, "event_not_allowed", "Unknown analytics event.");
  }
  if (!SESSION_ID.test(sessionId)) {
    throw new HttpError(400, "invalid_session_id", "session_id must be an anonymous random identifier.");
  }

  const payload = validateEventPayload(body.payload);
  if (!env.DB) {
    return json({ accepted: false, stored: false, reason: "analytics_unavailable" }, 202);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO analytics_events (event_name, session_id, payload) VALUES (?, ?, ?)",
    )
      .bind(eventName, sessionId, JSON.stringify(payload))
      .run();
    return json({ accepted: true, stored: true }, 202);
  } catch (error) {
    console.error("analytics insert failed", error instanceof Error ? error.message : error);
    return json({ accepted: false, stored: false, reason: "analytics_unavailable" }, 202);
  }
}

interface StatsRow {
  completed_total: number | string | null;
  completed_today: number | string | null;
  average_comparisons: number | string | null;
}

async function getStats(env: Env): Promise<Response> {
  const emptyStats = {
    available: false,
    completed_total: 0,
    completed_today: 0,
    average_comparisons: 0,
  };
  if (!env.DB) return json(emptyStats, 200, { "cache-control": "public, max-age=60" });

  try {
    const row = await env.DB.prepare(
      `SELECT
        COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS completed_total,
        COUNT(CASE WHEN event_name = 'ranking_completed' AND created_at >= datetime('now', 'start of day') THEN 1 END) AS completed_today,
        ROUND(AVG(CASE
          WHEN event_name = 'ranking_completed'
          THEN CAST(json_extract(payload, '$.comparison_count') AS REAL)
        END), 1) AS average_comparisons
      FROM analytics_events`,
    ).first<StatsRow>();

    return json(
      {
        available: true,
        completed_total: Number(row?.completed_total ?? 0),
        completed_today: Number(row?.completed_today ?? 0),
        average_comparisons: Number(row?.average_comparisons ?? 0),
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  } catch (error) {
    console.error("stats query failed", error instanceof Error ? error.message : error);
    return json(emptyStats, 200, { "cache-control": "public, max-age=30" });
  }
}

async function getDashboard(env: Env): Promise<Response> {
  if (!env.DB) return json({ available: false }, 200, { "cache-control": "public, max-age=60" });
  try {
    const [overview, daily, modes, recentEvents, apiLogs, apiErrors, accounts, storageInfo] = await Promise.all([
      env.DB.prepare(`SELECT
        COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS total_visits,
        COUNT(CASE WHEN event_name = 'visit' AND created_at >= datetime('now', '-7 days') THEN 1 END) AS visits_7d,
        COUNT(CASE WHEN event_name = 'visit' AND created_at >= datetime('now', 'start of day') THEN 1 END) AS visits_today,
        COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS total_completed,
        COUNT(CASE WHEN event_name = 'ranking_completed' AND created_at >= datetime('now', '-7 days') THEN 1 END) AS completed_7d,
        COUNT(CASE WHEN event_name = 'ranking_completed' AND created_at >= datetime('now', 'start of day') THEN 1 END) AS completed_today,
        ROUND(AVG(CASE WHEN event_name = 'ranking_completed' THEN CAST(json_extract(payload, '$.comparison_count') AS REAL) END), 1) AS avg_comparisons,
        ROUND(AVG(CASE WHEN event_name = 'ranking_completed' THEN CAST(json_extract(payload, '$.item_count') AS REAL) END), 1) AS avg_items,
        COUNT(DISTINCT CASE WHEN event_name = 'visit' THEN session_id END) AS unique_sessions
      FROM analytics_events`).first(),
      env.DB.prepare(`SELECT
        strftime('%Y-%m-%d', created_at) AS date,
        COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS visits,
        COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS completions
      FROM analytics_events
      WHERE created_at >= datetime('now', '-14 days')
      GROUP BY date
      ORDER BY date DESC
      LIMIT 14`).all(),
      env.DB.prepare(`SELECT
        json_extract(payload, '$.mode') AS mode,
        COUNT(*) AS count
      FROM analytics_events
      WHERE event_name = 'ranking_completed' AND json_extract(payload, '$.mode') IS NOT NULL
      GROUP BY mode
      ORDER BY count DESC`).all(),
      env.DB.prepare(`SELECT
        event_name,
        json_extract(payload, '$.mode') AS mode,
        json_extract(payload, '$.list_id') AS list_id,
        json_extract(payload, '$.item_count') AS item_count,
        json_extract(payload, '$.comparison_count') AS comparison_count,
        created_at
      FROM analytics_events
      ORDER BY created_at DESC
      LIMIT 20`).all(),
      env.DB.prepare(`SELECT
        id, path, method, status, duration_ms, source, error, created_at
      FROM api_logs
      ORDER BY created_at DESC
      LIMIT 30`).all(),
      env.DB.prepare(`SELECT
        id, path, method, status, duration_ms, source, error, created_at
      FROM api_logs
      WHERE status >= 400
      ORDER BY created_at DESC
      LIMIT 20`).all(),
      // Accounts list
      env.DB.prepare(`SELECT
        a.id, a.email, a.nickname, a.created_at
      FROM user_accounts a
      ORDER BY a.created_at DESC
      LIMIT 50`).all(),
      // Storage info - table row counts
      Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS cnt FROM analytics_events").first<{cnt: number}>(),
        env.DB.prepare("SELECT COUNT(*) AS cnt FROM api_logs").first<{cnt: number}>(),
        env.DB.prepare("SELECT COUNT(*) AS cnt FROM user_accounts").first<{cnt: number}>(),
        env.DB.prepare("SELECT COUNT(*) AS cnt FROM user_sessions").first<{cnt: number}>(),
        env.DB.prepare("SELECT COUNT(*) AS cnt FROM user_profiles_v2").first<{cnt: number}>(),
        env.DB.prepare("SELECT COUNT(*) AS cnt FROM challenge_sets").first<{cnt: number}>(),
      ]).then(([ae, al, ua, us, up, cs]) => ({ results: [
        { tbl: "analytics_events", cnt: ae?.cnt ?? 0 },
        { tbl: "api_logs", cnt: al?.cnt ?? 0 },
        { tbl: "user_accounts", cnt: ua?.cnt ?? 0 },
        { tbl: "user_sessions", cnt: us?.cnt ?? 0 },
        { tbl: "user_profiles_v2", cnt: up?.cnt ?? 0 },
        { tbl: "challenge_sets", cnt: cs?.cnt ?? 0 },
      ]})),
    ]);

    return json({
      available: true,
      timestamp: new Date().toISOString(),
      overview: {
        total_visits: Number((overview as Record<string, unknown>)?.total_visits ?? 0),
        visits_7d: Number((overview as Record<string, unknown>)?.visits_7d ?? 0),
        visits_today: Number((overview as Record<string, unknown>)?.visits_today ?? 0),
        total_completed: Number((overview as Record<string, unknown>)?.total_completed ?? 0),
        completed_7d: Number((overview as Record<string, unknown>)?.completed_7d ?? 0),
        completed_today: Number((overview as Record<string, unknown>)?.completed_today ?? 0),
        avg_comparisons: Number((overview as Record<string, unknown>)?.avg_comparisons ?? 0),
        avg_items: Number((overview as Record<string, unknown>)?.avg_items ?? 0),
        unique_sessions: Number((overview as Record<string, unknown>)?.unique_sessions ?? 0),
        completion_rate: Number((overview as Record<string, unknown>)?.total_visits ?? 0) > 0
          ? Math.round(Number((overview as Record<string, unknown>)?.total_completed ?? 0) / Number((overview as Record<string, unknown>)?.total_visits ?? 0) * 100)
          : 0,
      },
      daily: (daily as { results?: unknown[] }).results ?? [],
      modes: (modes as { results?: unknown[] }).results ?? [],
      recent_events: (recentEvents as { results?: unknown[] }).results ?? [],
      api_logs: (apiLogs as { results?: unknown[] }).results ?? [],
      api_errors: (apiErrors as { results?: unknown[] }).results ?? [],
      accounts: (accounts as { results?: unknown[] }).results ?? [],
      storage: (storageInfo as { results?: unknown[] }).results ?? [],
    }, 200, { "cache-control": "public, max-age=30" });
  } catch (error) {
    console.error("dashboard query failed", error instanceof Error ? error.message : error);
    return json({ available: false, error: "query failed" }, 200, { "cache-control": "public, max-age=10" });
  }
}

// ===== Admin Login =====
async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD && !env.DB) return json({ error: "auth_unavailable" }, 503);
  const body = await readJson(request);
  const password = cleanString(body.password, "password", 128);

  // Prefer environment variable password
  if (env.ADMIN_PASSWORD) {
    if (password !== env.ADMIN_PASSWORD) return json({ error: "invalid_password" }, 401);
  } else {
    // Fallback to DB-stored password
    if (!env.DB) return json({ error: "auth_unavailable" }, 503);
    const stored = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'password_hash'").first<{ value: string }>();
    if (!stored?.value) return json({ error: "no_password_configured" }, 503);
    const hash = await hashPassword(password);
    if (stored.value !== hash) return json({ error: "invalid_password" }, 401);
  }

  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)").bind(token, expires).run();
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
  return json({ token, expires });
}

async function handleAdminLogout(request: Request, env: Env): Promise<Response> {
  const token = getAdminToken(request);
  if (token && env.DB) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
  }
  return json({ ok: true });
}

async function handleAdminCheck(request: Request, env: Env): Promise<Response> {
  const authed = await adminAuth(request, env);
  return json({ authenticated: authed });
}

interface ChallengeRow {
  id: string;
  theme: string;
  mode: string;
  items: string;
  top_k: number | null;
  seed_text: string | null;
  template_id: string | null;
  created_at: string;
}

function validateItems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_CHALLENGE_ITEMS) {
    throw new HttpError(400, "invalid_items", "items must contain 2 to 300 movie titles.");
  }
  const cleaned = value.map((item, index) => cleanString(item, `items[${index}]`, 120));
  const unique = [...new Set(cleaned)];
  if (unique.length < 2) {
    throw new HttpError(400, "invalid_items", "items must contain at least two unique titles.");
  }
  return unique;
}

function randomChallengeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
  return `mv-${suffix}`;
}

async function createChallenge(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  if (!env.DB) {
    return json(
      { error: "challenge_storage_unavailable", fallback: "payload" },
      503,
      { "retry-after": "60" },
    );
  }

  const body = await readJson(request);
  const items = validateItems(body.items);
  const theme = cleanString(body.theme, "theme", 80);
  const mode = cleanOptionalString(body.mode, "mode", 40) ?? "shared";
  const topK = cleanOptionalInteger(body.top_k, "top_k", 1, items.length);
  const seedText = cleanOptionalString(body.seed_text, "seed_text", 80);
  const templateId = cleanOptionalString(body.template_id, "template_id", 80);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = randomChallengeId();
    try {
      await env.DB.prepare(
        `INSERT INTO challenge_sets
          (id, theme, mode, items, item_count, top_k, seed_text, template_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, theme, mode, JSON.stringify(items), items.length, topK, seedText, templateId)
        .run();
      return json({ id, path: `/?list=${id}` }, 201);
    } catch (error) {
      if (attempt === 2) {
        console.error("challenge insert failed", error instanceof Error ? error.message : error);
      }
    }
  }

  return json({ error: "challenge_storage_unavailable", fallback: "payload" }, 503);
}

async function getChallenge(id: string, env: Env): Promise<Response> {
  if (!CHALLENGE_ID.test(id)) {
    throw new HttpError(400, "invalid_challenge_id", "Invalid challenge id.");
  }
  if (!env.DB) {
    return json({ error: "challenge_storage_unavailable", fallback: "payload" }, 503);
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, theme, mode, items, top_k, seed_text, template_id, created_at
       FROM challenge_sets WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first<ChallengeRow>();
    if (!row) return json({ error: "challenge_not_found" }, 404);

    return json(
      {
        id: row.id,
        theme: row.theme,
        mode: row.mode,
        items: JSON.parse(row.items),
        top_k: row.top_k,
        seed_text: row.seed_text ?? "",
        source: "shared",
        template_id: row.template_id ?? "",
        created_at: row.created_at,
      },
      200,
      { "cache-control": "public, max-age=300" },
    );
  } catch (error) {
    console.error("challenge query failed", error instanceof Error ? error.message : error);
    return json({ error: "challenge_storage_unavailable", fallback: "payload" }, 503);
  }
}

async function serveAssets(request: Request, env: Env): Promise<Response> {
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && request.method === "GET") {
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      const indexUrl = new URL("/", request.url);
      response = await env.ASSETS.fetch(new Request(indexUrl, request));
    }
  }
  return withSecurityHeaders(response);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return json({ error: "cross_origin_forbidden" }, 405, { allow: "GET, POST" });
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, storage: env.DB ? "d1" : "disabled" });
  }
  if (url.pathname === "/api/events" && request.method === "POST") {
    return createEvent(request, env);
  }
  if (url.pathname === "/api/stats" && request.method === "GET") {
    return getStats(env);
  }
  if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
    return getDashboard(env);
  }
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    return handleAdminLogin(request, env);
  }
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    return handleAdminLogout(request, env);
  }
  if (url.pathname === "/api/admin/check" && request.method === "GET") {
    return handleAdminCheck(request, env);
  }
  if (url.pathname === "/api/douban/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250) return json({ error: "invalid_limit" }, 400);
    try { const works = await doubanTop250(limit); return json({ source: "douban", total: works.length, works }, 200, { "cache-control": "public, max-age=900" }); }
    catch { return json({ error: "douban_unavailable" }, 502); }
  }
  if (url.pathname === "/api/douban/books/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250) return json({ error: "invalid_limit" }, 400);
    try { const works = await doubanBookTop250(limit); return json({ source: "douban", total: works.length, works }, 200, { "cache-control": "public, max-age=900" }); }
    catch { return json({ error: "douban_unavailable" }, 502); }
  }
  if (url.pathname === "/api/douban/music/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250) return json({ error: "invalid_limit" }, 400);
    try { const works = await doubanMusicTop250(limit); return json({ source: "douban", total: works.length, works }, 200, { "cache-control": "public, max-age=900" }); }
    catch { return json({ error: "douban_unavailable" }, 502); }
  }
  if (url.pathname === "/api/douban/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try { return json({ works: await doubanSuggest(query) }, 200, { "cache-control": "public, max-age=3600" }); }
    catch { return json({ error: "douban_unavailable", works: [] }, 502); }
  }
  if (url.pathname === "/api/douban/books/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try { return json({ works: await doubanBookSuggest(query) }, 200, { "cache-control": "public, max-age=3600" }); }
    catch { return json({ error: "douban_unavailable", works: [] }, 502); }
  }
  if (url.pathname === "/api/posters" && request.method === "GET") {
    const title = url.searchParams.get("q")?.trim();
    const english = url.searchParams.get("en")?.trim() ?? "";
    const year = Number(url.searchParams.get("year")) || undefined;
    const type = url.searchParams.get("type") as "movie" | "book" | undefined;
    if (!title || title.length > 160 || english.length > 160 || (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 2200))) return json({ error: "invalid_query" }, 400);
    const poster_urls = await resolvePosters(title, english, year, type);
    return json({ poster_urls }, 200, { "cache-control": `public, max-age=${poster_urls.length ? 86400 : 300}` });
  }
  if (url.pathname === "/api/image" && request.method === "GET") return withSecurityHeaders(await proxyImage(url.searchParams.get("url") ?? ""));

  // Search list APIs
  if (url.pathname === "/api/book/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80) return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100) return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("book", key, page), 200, { "cache-control": "public, max-age=3600" });
  }
  if (url.pathname === "/api/movie/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80) return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100) return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("movie", key, page), 200, { "cache-control": "public, max-age=3600" });
  }
  if (url.pathname === "/api/music/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80) return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100) return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("music", key, page), 200, { "cache-control": "public, max-age=3600" });
  }

  // Detail APIs
  if (url.pathname === "/api/book/detail" && request.method === "GET") {
    const detailUrl = url.searchParams.get("url")?.trim();
    if (!detailUrl || !detailUrl.includes("book.douban.com/subject/")) return json({ status: false, msg: "缺少参数 url", data: null }, 400);
    return json(await doubanBookDetail(detailUrl), 200, { "cache-control": "public, max-age=86400" });
  }
  if (url.pathname === "/api/movie/detail" && request.method === "GET") {
    const detailUrl = url.searchParams.get("url")?.trim();
    if (!detailUrl || !detailUrl.includes("movie.douban.com/subject/")) return json({ status: false, msg: "缺少参数 url", data: null }, 400);
    return json(await doubanMovieDetail(detailUrl), 200, { "cache-control": "public, max-age=86400" });
  }
  if (url.pathname === "/api/music/detail" && request.method === "GET") {
    const detailUrl = url.searchParams.get("url")?.trim();
    if (!detailUrl || !detailUrl.includes("music.douban.com/subject/")) return json({ status: false, msg: "缺少参数 url", data: null }, 400);
    return json(await doubanMusicDetail(detailUrl), 200, { "cache-control": "public, max-age=86400" });
  }

  if (url.pathname === "/api/auth/config") return json({ enabled: Boolean(env.DB) });
  if (url.pathname.startsWith("/api/account/")) {
    if (request.method !== "GET") assertSameOrigin(request);
    return withSecurityHeaders(await accountRoute(request, env));
  }
  if (url.pathname === "/api/challenges" && request.method === "POST") {
    return createChallenge(request, env);
  }
  if (url.pathname.startsWith("/api/challenges/") && request.method === "GET") {
    return getChallenge(decodeURIComponent(url.pathname.slice("/api/challenges/".length)), env);
  }
  if (url.pathname === "/admin" && request.method === "GET") {
    return new Response(DASHBOARD_HTML, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }
  if (url.pathname.startsWith("/api/")) {
    return json({ error: "not_found" }, 404);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405);
  }
  return serveAssets(request, env);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const isApi = path.startsWith("/api/") && !path.startsWith("/api/admin/");
    const t0 = Date.now();
    let response: Response;
    let error: string | undefined;

    try {
      const cacheable = request.method === "GET" && ["/api/douban/top250", "/api/douban/suggest", "/api/posters", "/api/image"].includes(path);
      if (cacheable) {
        const edgeCache = (caches as unknown as { default: Cache }).default;
        const hit = await edgeCache.match(request);
        if (hit) {
          if (isApi) ctx.waitUntil(logApiCall(env, path, request.method, hit.status, Date.now() - t0, "cache"));
          return hit;
        }
      }
      response = await route(request, env);
      if (cacheable && response.ok) ctx.waitUntil((caches as unknown as { default: Cache }).default.put(request, response.clone()));
    } catch (err) {
      if (err instanceof HttpError) {
        response = json({ error: err.code, message: err.message }, err.status);
        error = err.message;
      } else {
        console.error("unhandled worker error", err instanceof Error ? err.stack : err);
        response = json({ error: "internal_error" }, 500);
        error = err instanceof Error ? err.message : "unknown";
      }
    }

    if (isApi) {
      const duration = Date.now() - t0;
      const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
      ctx.waitUntil(logApiCall(env, path, request.method, response.status, duration, response.status >= 400 ? "error" : "ok", error, ip));
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
