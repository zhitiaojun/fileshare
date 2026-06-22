<template>
  <div class="admin">
    <!-- Login -->
    <div v-if="!loggedIn" class="card" style="max-width:400px;margin:0 auto">
      <div class="card-header">
        <h1 class="card-title">&#128274; 管理员登录</h1>
        <p class="card-subtitle">输入密码进入管理面板</p>
      </div>
      <input v-model="password" type="password" class="input" placeholder="管理员密码"
        style="margin-bottom:16px" @keyup.enter="doLogin" />
      <button class="btn btn-primary btn-lg" :disabled="loginLoading" @click="doLogin">
        {{ loginLoading ? '登录中&#8230;' : '登录' }}
      </button>
      <div v-if="loginError" class="error-msg">{{ loginError }}</div>
    </div>

    <template v-if="loggedIn">
      <!-- Dashboard -->
      <div class="card">
        <div class="card-header"><h2 class="card-title">&#128200; 仪表盘</h2></div>
        <div v-if="dashboard" class="stats">
          <div class="stat"><span class="stat-num">{{ dashboard.totalFiles }}</span>总文件</div>
          <div class="stat"><span class="stat-num">{{ dashboard.activeCount }}</span>活跃</div>
          <div class="stat"><span class="stat-num">{{ dashboard.expiredCount }}</span>已过期</div>
          <div class="stat"><span class="stat-num">{{ formatSize(dashboard.totalStorage) }}</span>存储</div>
          <div class="stat"><span class="stat-num">{{ dashboard.todayCount }}</span>今日</div>
        </div>
      </div>

      <!-- File List -->
      <div class="card">
        <h3 class="card-title" style="font-size:17px">&#128193; 文件列表</h3>
        <div class="toolbar">
          <input v-model="searchKeyword" class="input-sm" placeholder="搜索文件名或取件码" style="flex:1" @keyup.enter="loadFiles" />
          <select v-model="filterStatus" class="input-sm" style="width:110px" @change="loadFiles">
            <option value="">全部</option><option value="active">活跃</option><option value="expired">已过期</option>
          </select>
          <button class="btn btn-ghost btn-sm" @click="loadFiles">刷新</button>
        </div>

        <div v-if="loadingFiles" class="loading">加载中&#8230;</div>
        <div v-else-if="!fileList.length" class="empty">暂无文件</div>
        <table v-else class="table">
          <thead><tr><th>ID</th><th>取件码</th><th>文件名</th><th>大小</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>
            <tr v-for="f in fileList" :key="f.id" :class="{ 'row-expired': f.is_expired }">
              <td class="td-muted">{{ f.id }}</td>
              <td class="td-code">{{ f.code }}</td>
              <td>
                {{ f.name }}
                <span v-if="f.is_encrypted" title="加密">&#128274;</span>
                <span v-if="f.is_burn_after_read" title="阅后即焚">&#128293;</span>
              </td>
              <td class="td-muted">{{ formatSize(f.size) }}</td>
              <td><span :class="['badge', f.is_expired ? 'badge-danger' : 'badge-success']">{{ f.is_expired ? '已过期' : '活跃' }}</span></td>
              <td style="text-align:right">
                <button class="btn btn-ghost btn-xs" @click="extendFile(f.id)">+24h</button>
                <button class="btn btn-danger btn-xs" @click="deleteFile(f.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pager" v-if="totalPages > 1">
          <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="page--; loadFiles()">上一页</button>
          <span class="hint">{{ page }} / {{ totalPages }}</span>
          <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="page++; loadFiles()">下一页</button>
        </div>
      </div>

      <!-- Config -->
      <div class="card">
        <h3 class="card-title" style="font-size:17px">&#9881; 配置</h3>
        <div class="config-row">
          <label class="config-label">上传大小 (bytes)</label>
          <input v-model="configForm.uploadSize" class="input-sm" />
        </div>
        <div class="config-row">
          <label class="config-label">访客上传</label>
          <select v-model="configForm.openUpload" class="input-sm" style="width:auto">
            <option value="1">允许</option><option value="0">禁止</option>
          </select>
        </div>
        <div class="config-row">
          <label class="config-label">上传频次 (次/分钟)</label>
          <input v-model.number="configForm.uploadCount" class="input-sm" type="number" style="width:100px" />
        </div>
        <button class="btn btn-primary" :disabled="savingConfig" @click="saveConfig" style="margin-top:12px">
          {{ savingConfig ? '保存中&#8230;' : '保存配置' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { adminAPI } from '../services/api';

const password = ref('');
const loggedIn = ref(false);
const loginLoading = ref(false);
const loginError = ref('');
const dashboard = ref<any>(null);
const fileList = ref<any[]>([]);
const loadingFiles = ref(false);
const savingConfig = ref(false);
const searchKeyword = ref('');
const filterStatus = ref('');
const page = ref(1);
const totalPages = ref(1);
const configForm = ref({ uploadSize: '104857600', openUpload: '1', uploadCount: '10' });

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

async function doLogin() {
  loginLoading.value = true; loginError.value = '';
  try { await adminAPI.login(password.value); loggedIn.value = true; await Promise.all([loadDashboard(), loadFiles(), loadConfig()]); }
  catch (err: any) { loginError.value = err.message || '登录失败'; }
  finally { loginLoading.value = false; }
}

async function loadDashboard() { try { dashboard.value = await adminAPI.dashboard(); } catch { } }
async function loadFiles() {
  loadingFiles.value = true;
  try {
    const r = await adminAPI.listFiles({ page: page.value, size: 20, keyword: searchKeyword.value, status: filterStatus.value }) as any;
    fileList.value = r.data || []; totalPages.value = Math.ceil((r.total || 0) / 20);
  } catch { } finally { loadingFiles.value = false; }
}
async function loadConfig() { try { const c = await adminAPI.getConfig() as any; configForm.value = { ...configForm.value, ...c }; } catch { } }
async function deleteFile(id: number) { if (!confirm('确认删除？')) return; try { await adminAPI.deleteFile(id); await loadFiles(); } catch (e: any) { alert(e.message); } }
async function extendFile(id: number) { try { await adminAPI.policyAction(id, 'extend_24h'); await loadFiles(); } catch (e: any) { alert(e.message); } }
async function saveConfig() {
  savingConfig.value = true;
  try { await adminAPI.updateConfig(configForm.value as any); alert('配置已保存'); } catch (e: any) { alert(e.message); }
  finally { savingConfig.value = false; }
}

onMounted(() => { if (localStorage.getItem('admin_token')) { loggedIn.value = true; loadDashboard(); loadFiles(); loadConfig(); } });
</script>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.stat { background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 18px 14px; text-align: center; font-size: 12px; color: var(--text-secondary); }
.stat-num { display: block; font-size: 26px; font-weight: 600; color: var(--accent-light); margin-bottom: 4px; font-family: 'Newsreader', serif; }

.toolbar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }

.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { text-align: left; padding: 10px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.table td { padding: 8px; border-bottom: 1px solid var(--border); }
.td-muted { color: var(--text-muted); font-size: 12px; }
.td-code { font-family: 'SF Mono', 'Fira Code', monospace; font-weight: 600; color: var(--accent-light); }
.row-expired td { opacity: 0.4; }

.pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 16px; }

.config-row { margin-bottom: 12px; }
.config-label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px; }
</style>
