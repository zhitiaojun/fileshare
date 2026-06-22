/**
 * FileShare - Cloudflare Workers Entry Point
 * Uses shared Hono app from app.ts + Workers-specific static asset serving
 */
import app from './app';

// ---- Workers-specific: Static assets & SPA fallback ----

// Serve static assets
app.get('/assets/*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// Favicon
app.get('/favicon.ico', async (c) => {
  try {
    return c.env.ASSETS.fetch(new Request('https://internal/favicon.ico'));
  } catch {
    return new Response(null, { status: 404 });
  }
});

// SPA fallback
app.get('*', async (c) => {
  try {
    const resp = await c.env.ASSETS.fetch(c.req.raw);
    if (resp.status !== 404) return resp;
  } catch { /* Assets not available */ }

  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>FileShare</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#fff;border-radius:16px;padding:40px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center}h1{font-size:28px;margin-bottom:16px;color:#333}p{color:#666;margin-bottom:24px;line-height:1.6}.code-input{width:100%;padding:14px;border:2px solid #e0e0e0;border-radius:8px;font-size:18px;text-align:center;letter-spacing:4px;font-weight:700}.code-input:focus{outline:0;border-color:#667eea}.btn{width:100%;padding:12px;margin-top:12px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}.features{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:24px}.tag{background:#f0f0ff;color:#667eea;padding:4px 12px;border-radius:20px;font-size:12px}</style>
</head><body><div class="card"><h1>📦 FileShare</h1><p>输入取件码下载文件</p>
<form onsubmit="event.preventDefault();var c=document.getElementById('code').value.trim();if(c)window.location.hash='#/code/'+c">
<input id="code" class="code-input" placeholder="输入取件码" maxlength="10" autofocus>
<button type="submit" class="btn">取件</button></form>
<div class="features"><span class="tag">🔒端到端加密</span><span class="tag">🔥阅后即焚</span><span class="tag">📁文件夹上传</span><span class="tag">📱扫码取件</span><span class="tag">📦ZIP打包</span></div>
<p style="margin-top:20px;font-size:12px;color:#999"><a href="/setup" style="color:#667eea">系统设置</a></p></div></body></html>`);
});

export default app;
