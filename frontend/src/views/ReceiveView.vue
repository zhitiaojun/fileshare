<template>
  <div class="receive">
    <!-- No code provided -->
    <div v-if="!code && !metadata" class="card">
      <h1 class="card-title">&#128229; 取件</h1>
      <p class="card-subtitle">输入取件码下载文件</p>
      <div style="display:flex;gap:8px;margin-top:20px">
        <input v-model="inputCode" class="input" placeholder="取件码" maxlength="10"
          style="font-size:20px;text-align:center;letter-spacing:6px;font-weight:600"
          @keyup.enter="lookupCode" autofocus />
        <button class="btn btn-primary" @click="lookupCode" style="flex-shrink:0;padding:11px 24px">查询</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card" style="text-align:center">
      <p class="loading">&#8943; 查询中</p>
    </div>

    <!-- Error -->
    <div v-if="errorMsg" class="card">
      <div class="error-msg">{{ errorMsg }}</div>
    </div>

    <!-- File Detail -->
    <div v-if="metadata && !loading" class="card">
      <div class="card-header">
        <h1 class="card-title">{{ metadata.is_text ? '&#128196;' : '&#128206;' }} {{ metadata.name }}</h1>
      </div>

      <!-- Meta grid -->
      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">大小</span>{{ formatSize(metadata.size) }}</div>
        <div class="meta-item"><span class="meta-label">上传时间</span>{{ metadata.created_at }}</div>
        <div class="meta-item" v-if="metadata.remaining_downloads !== 0">
          <span class="meta-label">剩余下载</span>{{ metadata.remaining_downloads < 0 ? '无限' : metadata.remaining_downloads + ' 次' }}
        </div>
        <div class="meta-item" v-if="metadata.encrypted"><span class="meta-label">&#128274; 已加密</span>需密码解密</div>
        <div class="meta-item" v-if="metadata.is_burn_after_read"><span class="meta-label">&#128293; 阅后即焚</span>仅一次有效</div>
        <div class="meta-item" v-if="metadata.is_folder"><span class="meta-label">&#128194; 文件夹</span>{{ metadata.folder_manifest?.totalFiles || '' }} 个文件</div>
      </div>

      <!-- Folder tree -->
      <div v-if="metadata.folder_manifest" class="folder-tree">
        <h3>&#128194; {{ metadata.folder_manifest.name }}</h3>
        <div v-for="(c, i) in flattenTree(metadata.folder_manifest)" :key="i" class="tree-item">
          {{ c.indent }}{{ c.type === 'folder' ? '&#128193;' : '&#128196;' }} {{ c.name }}
          <span v-if="c.size" class="hint">{{ formatSize(c.size) }}</span>
        </div>
      </div>

      <!-- Text preview -->
      <div v-if="textContent" class="text-block">
        <div class="preview-tabs">
          <button :class="{ active: previewMode === 'rendered' }" @click="previewMode = 'rendered'">预览</button>
          <button :class="{ active: previewMode === 'raw' }" @click="previewMode = 'raw'">原始</button>
        </div>
        <div v-if="previewMode === 'rendered'" class="markdown-body" v-html="renderedHtml"></div>
        <pre v-else class="raw-code">{{ textContent }}</pre>
      </div>

      <!-- Decrypt password -->
      <div v-if="metadata.encrypted" class="callout callout-warning">
        <input v-model="decryptPassword" type="password" class="input" placeholder="输入解密密码" />
      </div>

      <!-- Actions -->
      <button class="btn btn-primary btn-lg" style="margin-top:20px" :disabled="downloading" @click="doDownload">
        {{ downloading ? '&#8943; 下载中' : metadata.is_burn_after_read ? '&#128293; 下载（仅此一次）' : '&#8615; 下载文件' }}
      </button>
      <button v-if="metadata.is_folder" class="btn btn-outline btn-lg" style="margin-top:8px" @click="doDownloadAll">
        &#128230; 打包下载 (ZIP)
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { shareAPI } from '../services/api';
import { decryptFile } from '../composables/useEncryption';
import { useMarkdown } from '../composables/useMarkdown';

const props = defineProps<{ code?: string }>();
const route = useRoute();
const { renderedHtml, renderMarkdown } = useMarkdown();

const code = ref(props.code || '');
const inputCode = ref('');
const loading = ref(false);
const errorMsg = ref('');
const metadata = ref<any>(null);
const textContent = ref('');
const decryptPassword = ref('');
const downloading = ref(false);
const previewMode = ref<'rendered' | 'raw'>('rendered');

onMounted(() => { if (props.code) { code.value = props.code; lookupCode(); } });
watch(() => route.params.code, (v) => { if (v) { code.value = v as string; lookupCode(); } });

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

function flattenTree(node: any, depth = 0): any[] {
  const indent = '  '.repeat(depth);
  const result: any[] = [{ name: node.name, type: node.type, indent, size: node.size }];
  if (node.children) for (const c of node.children) result.push(...flattenTree(c, depth + 1));
  return result;
}

async function lookupCode() {
  const c = code.value || inputCode.value.trim(); if (!c) return;
  loading.value = true; errorMsg.value = ''; metadata.value = null; textContent.value = '';
  try { metadata.value = await shareAPI.getMetadata(c); code.value = c; }
  catch (err: any) { errorMsg.value = err.message || '文件不存在或已过期'; }
  finally { loading.value = false; }
}

async function doDownload() {
  if (!metadata.value || !code.value) return;
  if (metadata.value.encrypted && !decryptPassword.value) { errorMsg.value = '请输入解密密码'; return; }
  downloading.value = true; errorMsg.value = '';
  try {
    // Text share: fetch via API and render
    if (metadata.value.is_text) {
      const result = await shareAPI.select(code.value);
      textContent.value = result.text;
      if (result.text && looksLikeMarkdown(result.text)) await renderMarkdown(result.text);
      return;
    }

    // Encrypted file: fetch raw, decrypt locally, trigger download
    if (metadata.value.encrypted && decryptPassword.value) {
      const resp = await fetch(`/api/share/select?code=${code.value}`, { headers: { Accept: 'application/octet-stream' } });
      if (!resp.ok) throw new Error(await resp.text().then(t => { try { return JSON.parse(t).message; } catch { return '下载失败'; } }));
      const encrypted = await resp.arrayBuffer();
      const decrypted = await decryptFile(encrypted, decryptPassword.value, { iv: metadata.value.encryption_iv, salt: metadata.value.encryption_salt, encryptedKey: metadata.value.encryption_key_encrypted });
      downloadBlob(new Blob([decrypted]), metadata.value.name.replace(/\.enc$/, ''));
      return;
    }

    // Regular file: open download URL directly
    window.open(`/api/share/select?code=${code.value}`, '_blank');
  } catch (err: any) { errorMsg.value = err.message || '下载失败'; }
  finally { downloading.value = false; }
}

async function doDownloadAll() { if (code.value) window.open(`/api/share/download-all?code=${code.value}`, '_blank'); }

function looksLikeMarkdown(text: string): boolean {
  const patterns = [/^#+\s/m, /^\*+\s/m, /^-\s/m, /^>\s/m, /```/, /\[.*\]\(.*\)/, /\*\*.*\*\*/];
  const lines = text.split('\n').slice(0, 20);
  let n = 0; for (const l of lines) if (patterns.some(p => p.test(l))) n++;
  return n >= 2;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 16px 0; }
.meta-item { padding: 12px; background: var(--bg-base); border-radius: var(--radius-sm); border: 1px solid var(--border); }
.meta-label { display: block; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }

.folder-tree { margin: 16px 0; padding: 14px; background: var(--bg-base); border-radius: var(--radius-sm); border: 1px solid var(--border); max-height: 260px; overflow-y: auto; }
.folder-tree h3 { font-size: 14px; margin-bottom: 8px; }
.tree-item { font-size: 13px; padding: 2px 0; color: var(--text-secondary); white-space: pre; }

.text-block { margin: 16px 0; }
.preview-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.preview-tabs button {
  padding: 5px 14px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text-secondary); font-family: inherit; font-size: 12px; cursor: pointer;
}
.preview-tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.raw-code {
  background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 16px; font-size: 13px; overflow-x: auto; white-space: pre-wrap;
  font-family: 'SF Mono', 'Fira Code', monospace; color: var(--text-secondary);
}

/* Markdown */
.markdown-body { padding: 16px 0; line-height: 1.8; font-size: 14px; }
.markdown-body :where(h1,h2,h3) { margin: 20px 0 10px; font-family: 'Newsreader', serif; }
.markdown-body h1 { font-size: 24px; } .markdown-body h2 { font-size: 20px; }
.markdown-body pre { background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; overflow-x: auto; }
.markdown-body code { background: var(--bg-base); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.markdown-body pre code { background: none; padding: 0; }
.markdown-body blockquote { border-left: 3px solid var(--accent); padding-left: 14px; color: var(--text-secondary); margin: 12px 0; }
.markdown-body table { border-collapse: collapse; width: 100%; }
.markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 8px 12px; font-size: 13px; }
.markdown-body th { background: var(--bg-base); }
.markdown-body img { max-width: 100%; border-radius: var(--radius-sm); }

.callout { padding: 16px; border-radius: var(--radius-sm); border: 1px solid; margin: 16px 0; }
.callout-warning { background: var(--warning-bg); border-color: rgba(202,138,4,0.25); }
</style>
