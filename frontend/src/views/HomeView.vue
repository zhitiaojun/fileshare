<template>
<div class="home">
  <!-- Mobile tabs -->
  <div class="mobile-tabs">
    <button :class="{ active: mobileTab === 'share' }" @click="mobileTab = 'share'">📤 分享文件</button>
    <button :class="{ active: mobileTab === 'receive' }" @click="mobileTab = 'receive'">📥 接收文件</button>
  </div>

  <div class="layout">
    <!-- ===== LEFT: Share ===== -->
    <div class="col" :class="{ 'col-hidden': isMobile && mobileTab !== 'share' }">
      <div class="card">
        <div class="card-header">
          <h1 class="card-title">分享文件</h1>
          <p class="card-subtitle">上传文件生成取件码，安全分享给他人</p>
        </div>
        <div class="tabs">
          <button :class="{ active: tab === 'file' }" @click="tab = 'file'">📄 文件</button>
          <button :class="{ active: tab === 'folder' }" @click="tab = 'folder'">📁 文件夹</button>
        </div>

        <!-- File -->
        <div v-if="tab === 'file'" class="drop-area" @dragover.prevent @drop.prevent="handleDrop">
          <div class="drop-zone" @click="triggerFileInput">
            <div class="drop-icon">&#8682;</div>
            <p class="drop-text">拖拽文件到此处，或点击选择</p>
            <p class="hint">最大 {{ maxSizeMB }} MB</p>
          </div>
          <input ref="fileInput" type="file" hidden @change="handleFileSelect" />
        </div>

        <!-- Folder -->
        <div v-if="tab === 'folder'">
          <button class="btn btn-outline" style="width:100%;padding:14px" @click="pickFolderHandler">📁 选择文件夹</button>
          <p class="hint" style="text-align:center;margin-top:8px">或拖拽文件夹到文件区域</p>
        </div>

        <!-- Selected file -->
        <div v-if="selectedFile || folderEntries.length" class="file-chip">
          <span class="file-chip-icon">📎</span>
          <span class="file-chip-name">{{ selectedFile?.name || folderName }}</span>
          <span class="file-chip-size">{{ formatSize(selectedFile?.size || folderTotalSize) }}</span>
          <button class="btn btn-ghost btn-sm" @click="clearSelection">✕</button>
        </div>

        <!-- Settings -->
        <div v-if="selectedFile || folderEntries.length" class="settings-panel">
          <div class="section">
            <label class="section-label">⏰ 过期时间</label>
            <div class="chip-group">
              <button v-for="o in expireOptions" :key="o.value" :class="['chip', { active: expireStyle === o.value }]" @click="expireStyle = o.value">{{ o.label }}</button>
            </div>
            <div class="expiry-row" v-if="needsValue">
              <input v-model.number="expireValue" type="number" min="1" class="input-sm" style="width:80px" />
              <span class="hint">{{ unitLabel }}</span>
            </div>
            <input v-if="expireStyle === 'datetime'" v-model="expireDatetime" type="datetime-local" class="input" style="margin-top:8px" />
          </div>

          <div class="section">
            <label class="option" style="cursor:pointer"><input v-model="useEncryption" type="checkbox" /><span>🔒 密码加密</span></label>
            <input v-if="useEncryption" v-model="encryptPassword" type="password" class="input" style="margin-top:8px" placeholder="设置加密密码（请牢记）" />
            <p v-if="useEncryption" class="hint" style="color:var(--warning)">⚠ 不存储密码，忘记则无法解密</p>
          </div>

          <div class="section">
            <label class="option" style="cursor:pointer"><input v-model="useViewLimit" type="checkbox" /><span>👁 最大查看次数</span></label>
            <div v-if="useViewLimit" style="display:flex;align-items:center;gap:8px;margin-top:8px">
              <span class="hint">查看</span><input v-model.number="maxViews" type="number" min="1" class="input-sm" style="width:80px" /><span class="hint">次后自动过期</span>
            </div>
          </div>

          <div v-if="uploading" class="progress-section">
            <div class="progress-bar-wrap"><div class="progress-bar" :style="{ width: uploadProgress + '%' }"></div></div>
            <div class="progress-stats">
              <span>{{ uploadProgress }}%</span><span>{{ formatSize(uploadLoaded) }} / {{ formatSize(uploadTotal) }}</span>
              <span>{{ formatSpeed(uploadSpeed) }}</span><span v-if="uploadSpeed>0">{{ formatETA((uploadTotal - uploadLoaded) / uploadSpeed) }}</span>
            </div>
          </div>

          <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

          <button class="btn btn-primary btn-lg" :disabled="!canUpload || uploading" @click="doUpload">
            {{ uploading ? '上传中 ' + uploadProgress + '%' : canUpload ? '🚀 确认分享' : '请先完成人机验证' }}
          </button>
        </div>

        <TurnstileWidget ref="turnstileRef" :siteKey="siteKey" :theme="tsTheme"
          @verified="tsToken = $event; setTurnstileToken($event)" @error="errorMsg = $event" />
      </div>

      <!-- Result -->
      <div v-if="result" class="card result-card">
        <div class="success-icon">✓</div>
        <h2 class="card-title" style="text-align:center">分享就绪</h2>
        <div class="result-detail">
          <div class="result-row"><span>文件名</span><span>{{ result.name }}</span></div>
          <div class="result-row"><span>大小</span><span>{{ formatSize(result.size) }}</span></div>
          <div v-if="result.encrypted" class="result-row"><span>保护</span><span>🔒 密码加密</span></div>
        </div>
        <div class="code-display">
          <span class="code-label">取件码</span><span class="code-value">{{ result.code }}</span>
          <button class="btn btn-ghost btn-sm" @click="copyCode">复制</button>
        </div>
        <div class="share-link-row">
          <input :value="shareUrl" readonly class="input" style="font-size:12px" @focus="$event.target.select()" />
          <button class="btn btn-ghost btn-sm" @click="copyLink">复制链接</button>
        </div>
        <div v-if="qrDataUrl" class="qr-wrap"><img :src="qrDataUrl" alt="QR" class="qr-img" /><p class="hint">扫码取件</p></div>
        <button class="btn btn-outline" style="width:100%;margin-top:12px" @click="clearAll">继续分享</button>
      </div>
    </div>

    <!-- ===== RIGHT: Receive + Info ===== -->
    <div class="col col-right" :class="{ 'col-hidden': isMobile && mobileTab !== 'receive' }">
      <div class="card">
        <h3 class="card-title" style="font-size:18px">📥 接收文件</h3>
        <p class="card-subtitle">输入取件码下载文件</p>
        <div style="display:flex;gap:8px;margin-top:16px">
          <input v-model="receiveCode" class="input" placeholder="取件码" maxlength="10" @keyup.enter="goReceive" />
          <button class="btn btn-primary" @click="goReceive">取件</button>
        </div>
      </div>
      <div class="disclaimer">
        <p class="disclaimer-title">⚠ 内容声明</p>
        <p>严禁上传任何违法违规内容，包括但不限于：色情低俗、政治敏感、网络翻墙工具、暴力恐怖、恶意软件、诈骗信息、侵犯公民隐私等。违规者将被永久封禁 IP 地址，情节严重者将配合执法机关追究法律责任。</p>
      </div>
      <div class="stats-bar">
        <div class="stat-item"><span class="stat-num">{{ stats.totalFiles }}</span> 文件总数</div>
        <div class="stat-item"><span class="stat-num">{{ stats.activeFiles }}</span> 活跃</div>
        <div class="stat-item"><span class="stat-num">{{ stats.todayFiles }}</span> 今日</div>
        <div class="stat-item"><span class="stat-num">{{ formatSize(stats.totalStorage) }}</span> 存储</div>
      </div>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { shareAPI, setTurnstileToken, clearTurnstileToken, publicAPI } from '../services/api';
import { encryptFile } from '../composables/useEncryption';
import { useQRCode } from '../composables/useQRCode';
import { useFolderUpload } from '../composables/useFolderUpload';
import TurnstileWidget from '../components/TurnstileWidget.vue';
import type { FileEntry } from '../composables/useFolderUpload';

const router = useRouter();
const { pickFolder, fromDrop, folderName, buildManifest } = useFolderUpload();
const { qrDataUrl, generateQR } = useQRCode();

const isMobile = ref(window.innerWidth < 700);
const mobileTab = ref('share');
window.addEventListener('resize', () => { isMobile.value = window.innerWidth < 700; });

const tab = ref<'file' | 'folder'>('file');
const selectedFile = ref<File | null>(null);
const fileInput = ref<HTMLInputElement>();
const folderEntries = ref<FileEntry[]>([]);
const receiveCode = ref('');

const expireStyle = ref('day');
const expireValue = ref(1);
const expireDatetime = ref('');
const useEncryption = ref(false);
const encryptPassword = ref('');
const useViewLimit = ref(false);
const maxViews = ref(5);

const uploading = ref(false);
const uploadProgress = ref(0);
const uploadLoaded = ref(0);
const uploadTotal = ref(0);
const uploadSpeed = ref(0);
let speedTimer: ReturnType<typeof setInterval> | null = null;
let lastLoaded = 0;

const errorMsg = ref('');
const result = ref<any>(null);
const tsToken = ref('');
const turnstileRef = ref<InstanceType<typeof TurnstileWidget>>();
const siteKey = '0x4AAAAAADo7AsqRUPz0HOup';
const tsTheme = ref(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
new MutationObserver(() => { tsTheme.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light'; })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

const stats = ref({ totalFiles:0, activeFiles:0, todayFiles:0, totalStorage:0 });

const maxSizeMB = 100;
const shareUrl = computed(() => result.value ? location.origin + '/#/code/' + result.value.code : '');
const folderTotalSize = computed(() => folderEntries.value.reduce((s,e) => s + e.file.size, 0));
const canUpload = computed(() => !!tsToken.value && !uploading.value);

const expireOptions = [
  { value:'minute',label:'分钟'},{ value:'hour',label:'小时'},{ value:'day',label:'天'},
  { value:'datetime',label:'指定时间'},{ value:'forever',label:'永久'},{ value:'burn',label:'阅后即焚'},
];
const needsValue = computed(() => ['minute','hour','day'].includes(expireStyle.value));
const unitLabel = computed(() => ({minute:'分钟',hour:'小时',day:'天'} as Record<string,string>)[expireStyle.value]||'');

onMounted(async () => { try { stats.value = await publicAPI.getStats(); } catch {} });

function formatSize(b:number):string {
  if(!b) return '0 B'; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB';
  if(b<1073741824) return (b/1048576).toFixed(1)+' MB'; return (b/1073741824).toFixed(1)+' GB';
}
function formatSpeed(bps:number):string {
  if(bps<1024) return bps+' B/s'; if(bps<1048576) return (bps/1024).toFixed(1)+' KB/s'; return (bps/1048576).toFixed(1)+' MB/s';
}
function formatETA(s:number):string {
  if(!isFinite(s)||s<=0) return ''; if(s<60) return Math.ceil(s)+'s'; if(s<3600) return Math.ceil(s/60)+'min'; return (s/3600).toFixed(1)+'h';
}

function triggerFileInput() { fileInput.value?.click(); }
function handleFileSelect(e:Event) { const f=(e.target as HTMLInputElement).files?.[0]; if(f) selectedFile.value = f; }
async function handleDrop(e:DragEvent) {
  const dt=e.dataTransfer; if(!dt) return;
  if(dt.items?.[0]?.webkitGetAsEntry?.()?.isDirectory) { folderEntries.value = await fromDrop(dt); tab.value='folder'; }
  else if(dt.files?.[0]) { selectedFile.value=dt.files[0]; tab.value='file'; }
}
async function pickFolderHandler() { try { folderEntries.value = await pickFolder(); } catch {} }
function clearSelection() { selectedFile.value = null; folderEntries.value = []; errorMsg.value = ''; }

async function doUpload() {
  if(!tsToken.value) { errorMsg.value='请先完成人机验证'; return; }
  if(useEncryption.value && !encryptPassword.value) { errorMsg.value='请设置加密密码'; return; }
  errorMsg.value=''; result.value=null; uploading.value=true;
  uploadProgress.value=0; uploadLoaded.value=0; uploadSpeed.value=0; lastLoaded=0;
  try {
    const fd = new FormData();
    if(useViewLimit.value) { fd.append('expire_style','count'); fd.append('expire_value',maxViews.value.toString()); }
    else if(expireStyle.value==='burn') { fd.append('expire_style','burn'); fd.append('is_burn_after_read','true'); }
    else { fd.append('expire_style',expireStyle.value); fd.append('expire_value',expireValue.value.toString()); }
    if(expireStyle.value==='datetime' && expireDatetime.value && !useViewLimit.value) fd.append('expire_at_datetime',expireDatetime.value);
    let apiResult: any;
    if(tab.value==='folder' && folderEntries.value.length>0) {
      fd.append('is_folder','true'); fd.append('folder_manifest',buildManifest(folderEntries.value));
      fd.append('file',folderEntries.value[0].file,folderEntries.value[0].relativePath);
      uploadTotal.value = folderEntries.value[0].file.size;
      apiResult = await shareAPI.uploadFile(fd);
    } else {
      if(!selectedFile.value) throw new Error('请选择文件');
      let fileData = await selectedFile.value.arrayBuffer();
      if(fileData.byteLength > maxSizeMB*1048576) throw new Error(`文件超过 ${maxSizeMB}MB 限制`);
      if(useEncryption.value && encryptPassword.value) {
        const { encryptedData, params } = await encryptFile(fileData, encryptPassword.value);
        fd.append('file',new Blob([encryptedData]),selectedFile.value.name+'.enc');
        fd.append('encrypted','true'); fd.append('encryption_iv',params.iv); fd.append('encryption_salt',params.salt); fd.append('encryption_key_encrypted',params.encryptedKey);
      } else { fd.append('file',selectedFile.value); }
      uploadTotal.value = selectedFile.value.size;
      speedTimer = setInterval(() => { uploadSpeed.value = uploadLoaded.value - lastLoaded; lastLoaded = uploadLoaded.value; }, 1000);
      apiResult = await shareAPI.uploadFileWithProgress(fd, (pct,loaded,total) => { uploadProgress.value=pct; uploadLoaded.value=loaded; uploadTotal.value=total; });
    }
    result.value = apiResult;
    nextTick().then(() => generateQR(shareUrl.value).catch(()=>{}));
    nextTick().then(() => document.querySelector('.result-card')?.scrollIntoView({ behavior:'smooth' }));
  } catch(err:any) {
    errorMsg.value = err.message || '上传失败';
    if(result.value) { /* keep result */ }
  } finally {
    uploading.value = false;
    if(speedTimer) { clearInterval(speedTimer); speedTimer = null; }
  }
}

function clearAll() {
  result.value=null; errorMsg.value=''; selectedFile.value=null; folderEntries.value=[];
  useEncryption.value=false; encryptPassword.value=''; useViewLimit.value=false; maxViews.value=5;
  tsToken.value=''; clearTurnstileToken(); turnstileRef.value?.reset();
}
async function copyCode() { if(result.value?.code) { await navigator.clipboard.writeText(result.value.code); alert('已复制'); } }
async function copyLink() { await navigator.clipboard.writeText(shareUrl.value); alert('已复制'); }
function goReceive() { if(receiveCode.value.trim()) router.push('/code/'+receiveCode.value.trim()); }
</script>

<style scoped>
/* Layout */
.mobile-tabs { display: none; gap: 4px; margin-bottom: 16px; }
.mobile-tabs button {
  flex:1; padding: 10px; border:1px solid var(--border); border-radius: var(--radius-sm);
  background: transparent; color: var(--text-secondary); font-family: inherit; font-size: 14px; cursor: pointer;
}
.mobile-tabs button.active { border-color: var(--accent); color: var(--accent-light); background: var(--accent-glow); }

.layout { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; min-width: 0; }
.col { min-width: 0; overflow: hidden; }
.col-hidden { display: block !important; }

/* Share column */
.drop-area { padding: 8px 0; }
.drop-zone { border: 2px dashed var(--border); border-radius: var(--radius); padding: 36px 20px; text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s; }
.drop-zone:hover { border-color: var(--accent); background: var(--accent-glow); }
.drop-icon { font-size: 36px; color: var(--text-muted); margin-bottom: 8px; }
.drop-text { color: var(--text-secondary); font-size: 14px; }
.file-chip { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 10px 14px; background: var(--bg-base); border-radius: var(--radius-sm); border: 1px solid var(--border); }
.file-chip-icon { font-size: 18px; }
.file-chip-name { flex: 1; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-chip-size { color: var(--text-muted); font-size: 12px; }
.settings-panel { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
.section { margin: 14px 0; }
.section-label { display: block; font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
.chip-group { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 6px 14px; border: 1px solid var(--border); border-radius: 20px; background: transparent; color: var(--text-secondary); font-family: inherit; font-size: 12.5px; cursor: pointer; transition: all 0.15s; }
.chip:hover { border-color: var(--text-muted); color: var(--text-primary); }
.chip.active { border-color: var(--accent); background: var(--accent-glow); color: var(--accent-light); }
.expiry-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.option { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--text-secondary); cursor: pointer; }
.option:hover { color: var(--text-primary); }
.option input[type="checkbox"] { accent-color: var(--accent); }

.progress-section { margin: 14px 0 8px; }
.progress-bar-wrap { height: 6px; background: var(--bg-input); border-radius: 3px; overflow: hidden; }
.progress-bar { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-light)); border-radius: 3px; transition: width 0.2s ease; }
.progress-stats { display: flex; justify-content: space-between; flex-wrap: wrap; margin-top: 6px; font-size: 12px; color: var(--text-muted); gap: 4px; }

.result-card { text-align: center; }
.success-icon { width: 56px; height: 56px; border-radius: 50%; background: var(--accent-glow); color: var(--accent-light); font-size: 28px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; }
.result-detail { margin: 12px 0; }
.result-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
.result-row span:last-child { color: var(--text-secondary); }
.code-display { display: flex; align-items: center; gap: 8px; margin: 16px 0; justify-content: center; }
.code-value { font-size: 26px; font-weight: 600; letter-spacing: 6px; color: var(--accent-light); font-family: 'SF Mono', monospace; background: var(--bg-base); padding: 6px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); }
.share-link-row { display: flex; gap: 6px; margin-top: 8px; }
.qr-wrap { text-align: center; margin-top: 12px; }
.qr-img { width: 140px; height: 140px; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px; background: #fff; }

.disclaimer { margin-bottom: 16px; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-base); font-size: 12px; color: var(--text-muted); line-height: 1.7; }
.disclaimer-title { font-weight: 600; color: var(--warning); margin-bottom: 4px; font-size: 12px; }
.stats-bar { display: grid; grid-template-columns: repeat(2,1fr); gap: 8px; }
.stat-item { text-align: center; font-size: 11px; color: var(--text-muted); padding: 12px 6px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.stat-num { display: block; font-size: 18px; font-weight: 600; color: var(--accent-light); font-family: 'Newsreader', serif; margin-bottom: 2px; }

/* Responsive */
@media (min-width: 701px) {
  .col-hidden { display: block !important; }
  .code-value { font-size: 28px; letter-spacing: 8px; }
}
@media (max-width: 700px) {
  .mobile-tabs { display: flex; }
  .layout { grid-template-columns: 1fr; }
  .col-hidden { display: none !important; }
  .home { overflow-x: hidden; word-break: break-all; }
  .card { padding: 20px 16px; }
  .code-value { font-size: 20px; letter-spacing: 4px; padding: 4px 10px; }
  .chip { padding: 5px 10px; font-size: 11px; }
  .share-link-row { flex-direction: column; }
  .stats-bar { grid-template-columns: repeat(2, 1fr); gap: 6px; }
}
</style>
