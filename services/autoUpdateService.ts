/**
 * Serviço de Gerenciamento e Busca Automática de Atualizações (Web, PWA e Android Capacitor)
 * Garante que navegadores (Chrome, Safari, Firefox, Edge, Samsung Internet), PWAs e o App Android
 * carreguem sempre a versão mais recente publicada, ignorando caches antigos.
 */
import { safeStorage } from '../utils/safeStorage';

const LAST_RELOAD_SESSION_KEY = 'cantina_last_force_reload';
const SAVED_OTA_ORIGIN_KEY = 'cantina_ota_origin';
const RELOAD_COOLDOWN_MS = 8000;
const POLL_INTERVAL_MS = 20000;

const DEFAULT_LIVE_ORIGINS = [
  'https://ais-pre-ls5rl67hj4nqywh5amxbpr-11897027360.us-west2.run.app',
  'https://cantina-tusemm.web.app'
];

export interface VersionInfo {
  version: string;
  buildId?: string;
  serverTime?: string;
  builtAt?: string;
  startedAt?: string;
  name: string;
  targetOrigin?: string;
}

type UpdateCallback = (hasUpdate: boolean, newVersion?: string) => void;
const listeners: Set<UpdateCallback> = new Set();

let configuredLiveUrl = '';
let checkIntervalTimer: any = null;
let isUpdating = false;
let isChecking = false;

export function getRunningBuildId(): string {
  try {
    if (typeof __APP_BUILD_ID__ !== 'undefined' && __APP_BUILD_ID__) {
      return String(__APP_BUILD_ID__);
    }
  } catch {}
  try {
    const winBuild = (window as any).__APP_BUILD_ID__;
    if (winBuild) return String(winBuild);
  } catch {}
  return 'local-dev';
}

export function isCapacitorNative(): boolean {
  try {
    const w = window as any;
    if (w.Capacitor?.isNativePlatform?.()) return true;
    if (w.TusemmAndroid) return true;
    if (
      window.location.hostname === 'localhost' &&
      !window.location.port &&
      /android/i.test(navigator.userAgent)
    ) {
      return true;
    }
  } catch {}
  return false;
}

export function getRuntimePlatformLabel(): string {
  if (isCapacitorNative()) return 'App Android (Nativo)';
  try {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return 'PWA Instalado';
  } catch {}
  return 'Navegador Web';
}

export function setLiveAppUrl(url?: string): void {
  if (!url) {
    configuredLiveUrl = '';
    return;
  }
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/^https?:\/\/.+/i.test(trimmed)) {
    configuredLiveUrl = trimmed;
    safeStorage.setItem(SAVED_OTA_ORIGIN_KEY, trimmed);
  }
}

function getLastReloadTimestamp(): number {
  try {
    return Number(window.sessionStorage.getItem(LAST_RELOAD_SESSION_KEY) || '0');
  } catch {
    return 0;
  }
}

function markReloadTimestamp(): void {
  try {
    window.sessionStorage.setItem(LAST_RELOAD_SESSION_KEY, String(Date.now()));
  } catch {}
}

function isInReloadCooldown(): boolean {
  return Date.now() - getLastReloadTimestamp() < RELOAD_COOLDOWN_MS;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500): Promise<VersionInfo | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache'
      },
      signal: controller?.signal
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.includes('json') && !contentType.includes('text/plain')) {
      return null;
    }
    const data = await res.json();
    if (!data || typeof data.version !== 'string' || data.name !== 'Cantina TUSEMM') {
      return null;
    }
    return data as VersionInfo;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getRemoteOriginCandidates(): string[] {
  const list: string[] = [];
  const pushUnique = (u?: string | null) => {
    if (!u) return;
    const clean = u.trim().replace(/\/+$/, '');
    if (clean && /^https?:\/\//i.test(clean) && !list.includes(clean)) {
      list.push(clean);
    }
  };
  pushUnique(configuredLiveUrl);
  pushUnique(safeStorage.getItem(SAVED_OTA_ORIGIN_KEY));
  DEFAULT_LIVE_ORIGINS.forEach(pushUnique);
  return list;
}

/**
 * Consulta o servidor para verificar a versão mais recente (Web, PWA ou Android OTA)
 */
export async function fetchServerVersion(): Promise<VersionInfo | null> {
  const runningOnBundledCapacitorOrigin =
    isCapacitorNative() && window.location.hostname === 'localhost' && !window.location.port;

  // Quando rodando dentro do Web/PWA (ou Android já carregando a URL remota)
  if (!runningOnBundledCapacitorOrigin && /^https?:$/i.test(window.location.protocol)) {
    const ts = Date.now();
    const fromStatic = await fetchJsonWithTimeout(`/version.json?_nocache=${ts}`);
    if (fromStatic) return fromStatic;

    const fromApi = await fetchJsonWithTimeout(`/api/version?_nocache=${ts}`);
    if (fromApi) return fromApi;
  }

  // Fallback / Android APK rodando localmente (https://localhost) -> busca servidor remoto para OTA
  if (isCapacitorNative() || configuredLiveUrl) {
    const candidates = getRemoteOriginCandidates();
    for (const origin of candidates) {
      if (origin === window.location.origin) continue;
      const ts = Date.now();
      const remoteStatic = await fetchJsonWithTimeout(`${origin}/version.json?_nocache=${ts}`);
      if (remoteStatic) {
        safeStorage.setItem(SAVED_OTA_ORIGIN_KEY, origin);
        return { ...remoteStatic, targetOrigin: origin };
      }
      const remoteApi = await fetchJsonWithTimeout(`${origin}/api/version?_nocache=${ts}`);
      if (remoteApi) {
        safeStorage.setItem(SAVED_OTA_ORIGIN_KEY, origin);
        return { ...remoteApi, targetOrigin: origin };
      }
    }
  }

  return null;
}

/**
 * Limpa todos os caches do Service Worker, CacheStorage e Android WebView nativo
 */
export async function clearAllAppCaches(unregisterWorkers = false): Promise<void> {
  try {
    const w = window as any;
    if (w.TusemmAndroid?.clearWebViewCache) {
      w.TusemmAndroid.clearWebViewCache();
    }
  } catch {}

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (e) {
    console.warn('[AutoUpdate] Erro ao limpar CacheStorage:', e);
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        try {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          if (unregisterWorkers) {
            await reg.unregister().catch(() => {});
          } else {
            await reg.update().catch(() => {});
          }
        } catch {}
      }
    }
  } catch {}
}

/**
 * Força a atualização imediata preservando rota, query params (ex: ?view=reserva) e hash
 */
export async function forceAppUpdate(targetOrigin?: string): Promise<void> {
  if (isUpdating) return;
  isUpdating = true;
  markReloadTimestamp();

  const w = window as any;
  w.__tusemmReloading = true;

  await clearAllAppCaches(true);

  try {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('_v', String(Date.now()));

    const finalUrl = targetOrigin
      ? `${targetOrigin.replace(/\/+$/, '')}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
      : currentUrl.toString();

    if (targetOrigin && w.TusemmAndroid?.clearCacheAndLoad) {
      w.TusemmAndroid.clearCacheAndLoad(finalUrl);
      return;
    }

    window.location.replace(finalUrl);
  } catch {
    window.location.reload();
  }
}

/**
 * Verifica se há uma nova versão no servidor e aplica automaticamente sem depender de cache
 */
export async function checkForAppUpdates(autoReload: boolean = true): Promise<boolean> {
  if (isChecking || isUpdating) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  isChecking = true;
  try {
    const serverInfo = await fetchServerVersion();
    if (!serverInfo || !serverInfo.version) return false;

    const runningBuild = getRunningBuildId();
    const serverVer = serverInfo.version;

    if (serverVer !== runningBuild) {
      if (isInReloadCooldown()) {
        return false;
      }

      console.log(`[AutoUpdate] Nova versão detectada: ${serverVer} (atual em execução: ${runningBuild})`);

      listeners.forEach((cb) => {
        try {
          cb(true, serverVer);
        } catch {}
      });

      if (autoReload) {
        setTimeout(() => {
          forceAppUpdate(serverInfo.targetOrigin).catch(() => {
            window.location.reload();
          });
        }, 700);
      }

      return true;
    }

    return false;
  } finally {
    isChecking = false;
  }
}

/**
 * Inicia o monitoramento contínuo de atualizações para Navegadores, PWAs e App Android
 */
export function initAutoUpdateWatcher(): () => void {
  // Verificação imediata ao abrir o app (aplica automaticamente se houver nova versão)
  checkForAppUpdates(true).catch(() => {});

  if (!checkIntervalTimer) {
    checkIntervalTimer = setInterval(() => {
      checkForAppUpdates(true).catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  const triggerCheck = () => {
    checkForAppUpdates(true).catch(() => {});
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      triggerCheck();
    }
  };

  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      triggerCheck();
    }
  };

  window.addEventListener('focus', triggerCheck);
  window.addEventListener('online', triggerCheck);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('tusemm-app-resume', triggerCheck);
  document.addEventListener('visibilitychange', handleVisibility);

  const handleControllerChange = () => {
    const w = window as any;
    if (w.__tusemmReloading || isInReloadCooldown()) return;
    w.__tusemmReloading = true;
    markReloadTimestamp();
    console.log('[AutoUpdate] Novo Service Worker ativo. Aplicando atualização...');
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('_v', String(Date.now()));
      window.location.replace(u.toString());
    } catch {
      window.location.reload();
    }
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
  }

  return () => {
    if (checkIntervalTimer) {
      clearInterval(checkIntervalTimer);
      checkIntervalTimer = null;
    }
    window.removeEventListener('focus', triggerCheck);
    window.removeEventListener('online', triggerCheck);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('tusemm-app-resume', triggerCheck);
    document.removeEventListener('visibilitychange', handleVisibility);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    }
  };
}

export function subscribeToUpdateNotice(callback: UpdateCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
