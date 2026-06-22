<template>
  <div class="app-shell">
    <header class="nav">
      <router-link to="/" class="nav-brand">
        <span class="brand-icon">&#9670;</span>
        <span class="brand-text">FileShare</span>
      </router-link>
      <nav class="nav-links">
        <button class="theme-btn" @click="cycleTheme" :title="themeLabel">
          {{ themeIcon }}
        </button>
        <router-link to="/">首页</router-link>
      </nav>
    </header>
    <main class="main">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <footer class="footer">
      <span>FileShare &middot; 安全便捷的文件分享 &middot; <a href="https://github.com/zhitiaojun/fileshare" target="_blank" rel="noopener" style="color:var(--text-muted);text-underline-offset:2px">GitHub</a></span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';

const THEME_KEY = 'theme';
const theme = ref(localStorage.getItem(THEME_KEY) || 'system');

const themeIcon = computed(() =>
  theme.value === 'light' ? '☀' : theme.value === 'dark' ? '☽' : '◐'
);
const themeLabel = computed(() =>
  theme.value === 'light' ? '浅色' : theme.value === 'dark' ? '深色' : '自动'
);

function isSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function setDark(on: boolean) {
  document.documentElement.classList.toggle('dark', on);
}

function applyTheme(t: string) {
  theme.value = t;
  localStorage.setItem(THEME_KEY, t);
  document.documentElement.setAttribute('data-theme', t);

  if (t === 'dark') setDark(true);
  else if (t === 'light') setDark(false);
  else setDark(isSystemDark()); // 'system'
}

function cycleTheme() {
  const next: Record<string, string> = { system: 'light', light: 'dark', dark: 'system' };
  applyTheme(next[theme.value] || 'system');
}

// Listen for system changes
onMounted(() => {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem(THEME_KEY) === 'system') applyTheme('system');
  });
});
</script>

<style>
/* ── Global resets within App ── */
.app-shell {
  display: flex; flex-direction: column; min-height: 100vh;
  background: var(--bg-base); color: var(--text-primary);
  transition: background-color 0.3s, color 0.3s;
}

/* ── Navigation ── */
.nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; height: 56px;
  background: var(--bg-card); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 100;
  transition: background-color 0.25s, border-color 0.25s;
}
.nav-brand {
  display: flex; align-items: center; gap: 10px;
  text-decoration: none; color: var(--text-primary);
  font-family: 'Newsreader', Georgia, serif; font-size: 19px; font-weight: 500;
}
.brand-icon { color: var(--accent); font-size: 22px; }
.brand-text { letter-spacing: -0.3px; }
.nav-links { display: flex; gap: 4px; align-items: center; }
.theme-btn {
  background: transparent; border: none; color: var(--text-secondary);
  font-size: 18px; cursor: pointer; padding: 6px 10px; border-radius: 20px;
  transition: all 0.2s; line-height: 1;
}
.theme-btn:hover { color: var(--accent-light); background: var(--bg-hover); }
.nav-links a {
  color: var(--text-secondary); text-decoration: none;
  padding: 6px 16px; border-radius: 20px; font-size: 13.5px; font-weight: 500;
  transition: all 0.2s;
}
.nav-links a:hover { color: var(--text-primary); background: var(--bg-hover); }
.nav-links a.router-link-active { color: var(--accent-light); background: var(--accent-glow); }

/* ── Main ── */
.main {
  flex: 1; max-width: 960px; width: 100%; margin: 0 auto; padding: 32px 16px 48px;
}

/* ── Footer ── */
.footer {
  text-align: center; padding: 20px;
  color: var(--text-muted); font-size: 12px;
  border-top: 1px solid var(--border);
}

/* ── Page transitions ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ── Shared component classes ── */
.card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 28px;
  box-shadow: var(--shadow); margin-bottom: 20px;
  transition: background-color 0.25s, border-color 0.25s, box-shadow 0.25s;
}
.input, .input-sm {
  width: 100%; padding: 11px 14px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text-primary);
  font-family: inherit; font-size: 14px;
  transition: border-color 0.2s, background-color 0.25s, color 0.25s;
}
.input:focus, .input-sm:focus { outline: none; border-color: var(--border-focus); }
.card-header { margin-bottom: 24px; }
.card-title {
  font-family: 'Newsreader', Georgia, serif;
  font-size: 22px; font-weight: 500; color: var(--text-primary);
  letter-spacing: -0.2px;
}
.card-subtitle { color: var(--text-secondary); font-size: 13.5px; margin-top: 4px; }

/* ── Buttons ── */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 20px; border: none; border-radius: var(--radius-sm);
  font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.2s; white-space: nowrap;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary {
  background: linear-gradient(135deg, var(--accent), #b45309);
  color: #fff; box-shadow: 0 2px 8px var(--accent-glow);
}
.btn-primary:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
.btn-outline {
  background: transparent; color: var(--text-primary);
  border: 1px solid var(--border);
}
.btn-outline:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-light); }
.btn-ghost {
  background: transparent; color: var(--text-secondary);
}
.btn-ghost:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }
.btn-sm { padding: 5px 12px; font-size: 12px; border-radius: var(--radius-xs); }
.btn-xs { padding: 3px 8px; font-size: 11px; border-radius: 4px; }
.btn-danger { background: var(--danger-bg); color: var(--danger); }
.btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.2); }
.btn-lg { width: 100%; padding: 14px; font-size: 16px; font-weight: 600; }

/* ── Inputs ── */
.input, .input-sm {
  width: 100%; padding: 11px 14px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text-primary);
  font-family: inherit; font-size: 14px; transition: border-color 0.2s;
}
.input:focus, .input-sm:focus { outline: none; border-color: var(--border-focus); }
.input::placeholder { color: var(--text-muted); }
.input-sm { padding: 7px 10px; font-size: 13px; }

/* ── Tabs ── */
.tabs { display: flex; gap: 4px; margin-bottom: 24px; background: var(--bg-base); border-radius: var(--radius-sm); padding: 4px; }
.tabs button {
  flex: 1; padding: 9px 14px; border: none; border-radius: 6px;
  background: transparent; color: var(--text-secondary);
  font-family: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer;
  transition: all 0.2s;
}
.tabs button:hover { color: var(--text-primary); }
.tabs button.active { background: var(--bg-card); color: var(--accent-light); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }

/* ── Error / Success messages ── */
.error-msg { color: var(--danger); font-size: 13px; margin-top: 12px; padding: 10px 14px; background: var(--danger-bg); border-radius: var(--radius-sm); border: 1px solid rgba(239,68,68,0.2); }
.success-msg { color: var(--success); font-size: 13px; padding: 10px 14px; background: var(--success-bg); border-radius: var(--radius-sm); border: 1px solid rgba(101,163,13,0.2); }

/* ── Misc ── */
.hint { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
.loading { text-align: center; padding: 48px 20px; color: var(--text-muted); font-size: 15px; }
.empty { text-align: center; padding: 40px; color: var(--text-muted); }
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500;
}
.badge-success { background: var(--success-bg); color: var(--success); }
.badge-danger { background: var(--danger-bg); color: var(--danger); }
.badge-warning { background: var(--warning-bg); color: var(--warning); }
</style>
