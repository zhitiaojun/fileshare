<template>
  <div class="turnstile-wrapper" v-if="siteKey && siteKey !== 'your-turnstile-site-key'">
    <div ref="widgetContainer" class="cf-turnstile"></div>
    <p v-if="error" class="turnstile-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps<{ siteKey: string; theme?: string }>();
const emit = defineEmits<{ verified: [token: string]; error: [msg: string] }>();

const widgetContainer = ref<HTMLElement>();
const error = ref('');
let widgetId: string | null = null;
let scriptLoaded = false;

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).turnstile) { scriptLoaded = true; resolve(); return; }
    const s = document.createElement('script');
    s.src = TURNSTILE_SCRIPT; s.async = true; s.defer = true;
    s.onload = () => { scriptLoaded = true; resolve(); };
    document.head.appendChild(s);
  });
}

function renderWidget(theme: string) {
  if (!widgetContainer.value || !(window as any).turnstile) return;
  // Remove old widget
  if (widgetId) { (window as any).turnstile.remove(widgetId); widgetId = null; }
  try {
    widgetId = (window as any).turnstile.render(widgetContainer.value, {
      sitekey: props.siteKey,
      theme: theme || 'auto',
      size: 'normal',
      callback: (token: string) => { error.value = ''; emit('verified', token); },
      'error-callback': () => { error.value = '人机验证失败，请刷新重试'; emit('error', 'Turnstile error'); },
      'expired-callback': () => { error.value = '验证已过期，请重新验证'; },
    });
  } catch { error.value = '验证组件加载失败'; }
}

onMounted(() => {
  loadScript()
    .then(() => nextTick())
    .then(() => new Promise(r => setTimeout(r, 100)))
    .then(() => renderWidget(props.theme || 'auto'))
    .catch(() => { error.value = '验证组件加载失败'; });
});

// Re-render when theme changes
watch(() => props.theme, (t) => { if (scriptLoaded) renderWidget(t || 'auto'); });

onUnmounted(() => { if (widgetId && (window as any).turnstile) (window as any).turnstile.remove(widgetId); });

function reset() {
  if (widgetId && (window as any).turnstile) (window as any).turnstile.reset(widgetId);
  error.value = '';
}
defineExpose({ reset });
</script>

<style scoped>
.turnstile-wrapper { margin: 16px 0; display: flex; flex-direction: column; align-items: center; }
.turnstile-error { color: var(--danger); font-size: 12px; margin-top: 6px; }
</style>
