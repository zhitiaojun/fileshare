# FileShare

> 像取快递一样取文件 —— 安全、匿名、即用即走的文件分享服务

[![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20Workers-f38020?logo=cloudflare)](https://pages.cloudflare.com)
[![Vue](https://img.shields.io/badge/Vue-3.5-4fc08d?logo=vuedotjs)](https://vuejs.org)
[![Hono](https://img.shields.io/badge/Hono-4.x-e36002?logo=hono)](https://hono.dev)
[![License](https://img.shields.io/badge/License-LGPL--3.0-blue)](LICENSE)

## ✨ 功能

- **📤 文件分享** — 拖拽上传，生成取件码，对方凭码取件
- **📁 文件夹上传** — 递归上传整个文件夹，保留目录结构
- **🔒 密码加密** — 客户端 AES-256-GCM 加密，服务端零知悉明文
- **🔥 阅后即焚** — 首次下载后自动销毁文件
- **👁 查看次数限制** — 查看 N 次后自动过期
- **⏰ 精确过期** — 支持分钟/小时/天/指定日期/永久
- **📦 ZIP 打包下载** — 多文件一键打包
- **📝 Markdown 预览** — 文本分享支持渲染与代码高亮
- **📱 二维码取件** — 扫码直达取件页面
- **🛡️ Turnstile 验证** — Cloudflare 人机验证防滥用
- **🌓 深浅色模式** — 跟随系统，也可手动切换

## 🏗️ 架构

```
Cloudflare Pages (Vue 3 SPA)
    │
    ├── 静态资源 (index.html + JS/CSS)
    │
    └── Pages Functions (Hono)
        ├── /api/share/*   文件上传与取件
        ├── /api/chunk/*   分块上传
        ├── /api/admin/*   管理后台
        ├── /setup         初始化向导
        └── /api/stats     公开统计

Cloudflare Worker (定时清理)
    └── Cron: */10 min    清理过期文件 + 不完整上传

存储层
    ├── D1 (SQLite)       元数据 / 配置 / 取件码
    └── R2 (Object)       文件二进制存储
```

## 🚀 快速部署

### 环境要求

- [Node.js](https://nodejs.org) 18+
- [Cloudflare 账号](https://dash.cloudflare.com)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 创建 Cloudflare 资源

```bash
# 登录
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create fileshare-db

# 创建 R2 存储桶
npx wrangler r2 bucket create fileshare-storage

# 创建 Turnstile 站点 (可选)
# https://dash.cloudflare.com → Turnstile → 添加站点
```

### 克隆并配置

```bash
git clone https://github.com/zhitiaojun/fileshare.git
cd fileshare

# 安装依赖
npm install
cd frontend && npm install && cd ..

# 更新 wrangler.toml 中的 database_id
# 将 migrations/001_initial.sql 执行到远程 D1
npx wrangler d1 execute fileshare-db --file=migrations/001_initial.sql --remote

# 设置 Turnstile 密钥（可选）
echo "你的secret" | npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=fileshare
```

### 构建并部署

```bash
# 构建前端
cd frontend && npm run build && cd ..

# 部署到 Cloudflare Pages
npx wrangler pages deploy public/ --project-name=fileshare

# 部署清理 Worker
cd worker-cleanup && npm install && npx wrangler deploy && cd ..
```

### 部署后初始化

1. 访问你的 Pages 域名
2. 自动跳转 `/setup` 设置管理员密码
3. 开始使用

## 📂 项目结构

```
fileshare/
├── frontend/                 Vue 3 前端
│   └── src/
│       ├── views/            HomeView, ReceiveView
│       ├── components/       TurnstileWidget
│       ├── composables/      useEncryption, useQRCode, etc.
│       └── services/         API 客户端 (Axios)
├── src/                      后端 (Hono on Pages Functions)
│   ├── routes/               share, chunk, admin, setup
│   ├── middleware/            auth, ratelimit, turnstile
│   └── lib/                  crypto, db, storage, zip, code
├── functions/                Pages Functions 入口
├── public/                   前端构建产物
├── migrations/               D1 数据库迁移
├── worker-cleanup/           独立清理 Worker
└── wrangler.toml             Cloudflare 配置
```

## 🔧 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite + Vue Router + Pinia |
| 后端 | Hono (TypeScript) |
| 数据库 | Cloudflare D1 (SQLite) |
| 存储 | Cloudflare R2 |
| 限流 | IP 内存计数 |
| 加密 | Web Crypto API (AES-256-GCM + PBKDF2) |
| 验证 | Cloudflare Turnstile |
| 部署 | Cloudflare Pages + Workers |

## 📄 声明

部分代码由 **DeepSeek V4 Pro** 辅助生成。

本项目基于 [FileCodeBox](https://github.com/vastsa/FileCodeBox) (LGPL-3.0) 重构，将 Python FastAPI 后端迁移至 Cloudflare Pages Functions (Hono + TypeScript)，并新增了客户端加密、阅后即焚、Turnstile 验证等功能。

## 📜 License

LGPL-3.0 © 2025
