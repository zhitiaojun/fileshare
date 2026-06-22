/**
 * Setup route - First-time initialization wizard
 * Serves HTML page for admin password + initial config setup
 */
import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { isInitialized, setConfigs, getConfig } from '../lib/db';
import { hashPasswordAsync, randomHex } from '../lib/crypto';
import { jsonSuccess, jsonError } from '../lib/response';

const setupApi = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Default config values for initial setup
const DEFAULT_CONFIG: Record<string, string> = {
  name: '"FileShare - 文件分享"',
  description: '"像拿快递一样取文件"',
  keywords: '"文件分享,FileShare"',
  uploadSize: '10485760',
  allowed_file_types: '["*"]',
  expireStyle: '["day","hour","minute","forever","count","datetime","burn"]',
  code_generate_type: '"number"',
  openUpload: '1',
  uploadMinute: '1',
  uploadCount: '10',
  errorMinute: '1',
  errorCount: '10',
  enableChunk: '0',
  max_save_seconds: '0',
  showAdminAddr: '0',
  robotsText: '"User-agent: *\nDisallow: /"',
  notify_title: '""',
  notify_content: '""',
  page_explain: '""',
};

// =============================================
// HTML Setup Page
// =============================================
const SETUP_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FileShare - 系统初始化</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 { font-size: 24px; margin-bottom: 8px; color: #333; }
    p.subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 6px; font-weight: 600; color: #444; font-size: 14px; }
    input[type="text"], input[type="password"], input[type="number"], select {
      width: 100%; padding: 10px 14px; border: 2px solid #e0e0e0;
      border-radius: 8px; font-size: 14px; transition: border-color 0.2s;
    }
    input:focus, select:focus { outline: none; border-color: #667eea; }
    .error { color: #e53e3e; font-size: 13px; margin-top: 4px; }
    .btn {
      width: 100%; padding: 12px; background: linear-gradient(135deg, #667eea, #764ba2);
      color: white; border: none; border-radius: 8px; font-size: 16px;
      font-weight: 600; cursor: pointer; transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .success-msg { color: #38a169; text-align: center; margin-top: 16px; display: none; }
    .note { font-size: 12px; color: #999; margin-top: 4px; }
    .row { display: flex; gap: 12px; }
    .row > * { flex: 1; }
    .checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
    .checkbox-group label {
      display: flex; align-items: center; gap: 4px;
      font-weight: 400; font-size: 13px; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔒 FileShare 初始化</h1>
    <p class="subtitle">首次使用需要设置管理员密码和基本配置</p>
    <form id="setupForm">
      <div class="form-group">
        <label>站点名称</label>
        <input type="text" name="name" value="FileShare - 文件分享" required>
      </div>
      <div class="form-group">
        <label>管理员密码 <span style="color:red">*</span></label>
        <input type="password" name="admin_password" placeholder="至少8位字符" minlength="8" required>
      </div>
      <div class="form-group">
        <label>确认密码 <span style="color:red">*</span></label>
        <input type="password" name="admin_password_confirm" placeholder="再次输入密码" minlength="8" required>
        <div class="error" id="pwdError"></div>
      </div>
      <div class="row">
        <div class="form-group">
          <label>上传大小限制</label>
          <input type="number" name="uploadSizeNum" value="10" min="1" max="1024">
        </div>
        <div class="form-group">
          <label>单位</label>
          <select name="uploadSizeUnit">
            <option value="MB" selected>MB</option>
            <option value="KB">KB</option>
            <option value="GB">GB</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>上传限制</label>
        <div class="row">
          <input type="number" name="uploadCount" value="10" min="1" placeholder="次数">
          <span style="align-self:center;color:#666;font-size:13px">次 /</span>
          <input type="number" name="uploadMinute" value="1" min="1" placeholder="分钟">
          <span style="align-self:center;color:#666;font-size:13px">分钟</span>
        </div>
      </div>
      <div class="form-group">
        <label>过期方式</label>
        <div class="checkbox-group">
          <label><input type="checkbox" name="expire_day" checked> 天</label>
          <label><input type="checkbox" name="expire_hour" checked> 小时</label>
          <label><input type="checkbox" name="expire_minute" checked> 分钟</label>
          <label><input type="checkbox" name="expire_forever" checked> 永久</label>
          <label><input type="checkbox" name="expire_count" checked> 下载次数</label>
          <label><input type="checkbox" name="expire_datetime" checked> 指定时间</label>
          <label><input type="checkbox" name="expire_burn" checked> 阅后即焚</label>
        </div>
      </div>
      <div class="form-group">
        <label>允许访客上传</label>
        <select name="openUpload">
          <option value="1" selected>允许</option>
          <option value="0">禁止（需登录）</option>
        </select>
      </div>
      <button type="submit" class="btn">初始化系统</button>
      <div class="success-msg" id="successMsg">✅ 初始化成功！正在跳转到管理面板...</div>
    </form>
  </div>
  <script>
    document.getElementById('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = document.querySelector('[name="admin_password"]').value;
      const pwdConfirm = document.querySelector('[name="admin_password_confirm"]').value;
      const pwdError = document.getElementById('pwdError');

      if (pwd !== pwdConfirm) {
        pwdError.textContent = '两次输入的密码不一致';
        return;
      }
      if (pwd.length < 8) {
        pwdError.textContent = '密码至少8位';
        return;
      }
      pwdError.textContent = '';

      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = '初始化中...';

      // Collect expiry styles
      const expireStyles = [];
      if (document.querySelector('[name="expire_day"]').checked) expireStyles.push('day');
      if (document.querySelector('[name="expire_hour"]').checked) expireStyles.push('hour');
      if (document.querySelector('[name="expire_minute"]').checked) expireStyles.push('minute');
      if (document.querySelector('[name="expire_forever"]').checked) expireStyles.push('forever');
      if (document.querySelector('[name="expire_count"]').checked) expireStyles.push('count');
      if (document.querySelector('[name="expire_datetime"]').checked) expireStyles.push('datetime');
      if (document.querySelector('[name="expire_burn"]').checked) expireStyles.push('burn');

      const uploadSizeNum = parseInt(document.querySelector('[name="uploadSizeNum"]').value) || 10;
      const uploadSizeUnit = document.querySelector('[name="uploadSizeUnit"]').value;
      const multipliers = { KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };

      const body = {
        admin_password: pwd,
        name: document.querySelector('[name="name"]').value,
        uploadSize: (uploadSizeNum * multipliers[uploadSizeUnit]).toString(),
        uploadCount: document.querySelector('[name="uploadCount"]').value,
        uploadMinute: document.querySelector('[name="uploadMinute"]').value,
        openUpload: document.querySelector('[name="openUpload"]').value,
        expireStyle: JSON.stringify(expireStyles),
      };

      try {
        const resp = await fetch('/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          document.getElementById('successMsg').style.display = 'block';
          setTimeout(() => { window.location.href = '/'; }, 2000);
        } else {
          const data = await resp.json();
          pwdError.textContent = data.message || '初始化失败';
          btn.disabled = false;
          btn.textContent = '初始化系统';
        }
      } catch (err) {
        pwdError.textContent = '网络错误，请重试';
        btn.disabled = false;
        btn.textContent = '初始化系统';
      }
    });
  </script>
</body>
</html>`;

// =============================================
// GET /setup - Serve setup page
// =============================================
setupApi.get('/', async (c) => {
  const init = await isInitialized(c.env.DB, c.env);
  if (init) {
    return c.redirect('/');
  }
  return c.html(SETUP_HTML);
});

// =============================================
// POST /setup - Process setup form
// =============================================
setupApi.post('/', async (c) => {
  const init = await isInitialized(c.env.DB, c.env);
  if (init) {
    return jsonError(400, 'System already initialized');
  }

  const body = await c.req.json<{
    admin_password: string;
    name?: string;
    uploadSize?: string;
    uploadCount?: string;
    uploadMinute?: string;
    openUpload?: string;
    expireStyle?: string;
  }>();

  if (!body.admin_password || body.admin_password.length < 8) {
    return jsonError(400, 'Admin password must be at least 8 characters');
  }

  // Hash admin password
  const hashedPassword = await hashPasswordAsync(body.admin_password);

  // Generate JWT secret
  const jwtSecret = randomHex(32);

  // Build config entries
  const entries: Record<string, string> = {
    admin_token: `"${hashedPassword}"`,
    jwt_secret: `"${jwtSecret}"`,
  };

  if (body.name) entries.name = `"${body.name}"`;
  if (body.uploadSize) entries.uploadSize = body.uploadSize;
  if (body.uploadCount) entries.uploadCount = body.uploadCount;
  if (body.uploadMinute) entries.uploadMinute = body.uploadMinute;
  if (body.openUpload) entries.openUpload = body.openUpload;
  if (body.expireStyle) entries.expireStyle = body.expireStyle;

  // Merge with defaults for any missing keys
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!entries[key]) {
      entries[key] = value;
    }
  }

  await setConfigs(c.env.DB, entries, c.env);

  const accept = c.req.header('Accept') || '';
  if (accept.includes('application/json')) {
    return jsonSuccess({ initialized: true });
  }

  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>初始化成功</title>
<meta http-equiv="refresh" content="2;url=/">
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0;}
.success{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.1);}
h2{color:#38a169;}p{color:#666;}</style></head>
<body><div class="success"><h2>✅ 初始化成功！</h2><p>正在跳转到首页...</p></div></body></html>`);
});

export default setupApi;
