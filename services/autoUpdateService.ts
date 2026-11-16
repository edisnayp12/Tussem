/**
 * Serviço de Gerenciamento e Busca Automática de Atualizações
 * Garante que o aplicativo web / PWA busque atualizações automaticamente
 * sem que o usuário fique preso em versões antigas em cache.
 */
import { safeStorage } from '../utils/safeStorage';

const LOCAL_STORAGE_VERSION_KEY = 'cantina_app_version';

export interface VersionInfo {
  version: string;
  serverTime: string;
  startedAt: string;
  name: string;
}

type UpdateCallback = (hasUpdate: boolean, newVersion?: string) => void;
const listeners: Set<UpdateCallback> = new Set();

let currentKnownVersion: string | null = safeStorage.getItem(LOCAL_STORAGE_VERSION_KEY);
let checkIntervalTimer: any = null;
let isUpdating = false;

/**
 * Consulta o servidor para verificar a versão atual da aplicação
 */
export async function fetchServerVersion(): Promise<VersionInfo | null> {
  try {
    const res = await fetch(`/api/version?_nocache=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache'
      }
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data as VersionInfo;
  } catch {
    return null;
  }
}

/**
 * Limpa todos os caches do Service Worker e do navegador
 */
export async function clearAllAppCaches(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (e) {
    console.warn('[AutoUpdate] Erro ao limpar caches:', e);
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.update().catch(() => {});
      }
    }
  } catch {}
}

/**
 * Força a atualização imediata preservando rota, query params (ex: ?view=reserva) e hash
 */
export async function forceAppUpdate(): Promise<void> {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const serverInfo = await fetchServerVersion();
    if (serverInfo?.version) {
      safeStorage.setItem(LOCAL_STORAGE_VERSION_KEY, serverInfo.version);
    }
  } catch {}

  await clearAllAppCaches();

  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

/**
 * Verifica se há uma nova versão e notifica listeners ou atualiza automaticamente
 */
export async function checkForAppUpdates(autoReload: boolean = true): Promise<boolean> {
  const serverInfo = await fetchServerVersion();
  if (!serverInfo || !serverInfo.version) return false;

  const serverVer = serverInfo.version;

  if (!currentKnownVersion) {
    currentKnownVersion = serverVer;
    safeStorage.setItem(LOCAL_STORAGE_VERSION_KEY, serverVer);
    return false;
  }

  if (currentKnownVersion !== serverVer) {
    console.log(`[AutoUpdate] Nova versão detectada: ${serverVer} (atual: ${currentKnownVersion})`);

    listeners.forEach((cb) => {
      try {
        cb(true, serverVer);
      } catch {}
    });

    if (autoReload) {
      safeStorage.setItem(LOCAL_STORAGE_VERSION_KEY, serverVer);
      setTimeout(async () => {
        await forceAppUpdate();
      }, 1200);
    }

    return true;
  }

  return false;
}

/**
 * Inicia o monitoramento contínuo de atualizações do sistema
 */
export function initAutoUpdateWatcher(): () => void {
  checkForAppUpdates(false).catch(() => {});

  if (!checkIntervalTimer) {
    checkIntervalTimer = setInterval(() => {
      checkForAppUpdates(true).catch(() => {});
    }, 30000);
  }

  const handleVisibilityOrFocus = () => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdates(true).catch(() => {});
    }
  };

  window.addEventListener('focus', handleVisibilityOrFocus);
  document.addEventListener('visibilitychange', handleVisibilityOrFocus);

  const handleControllerChange = () => {
    const w = window as any;
    if (w.__tusemmReloading) return;
    w.__tusemmReloading = true;
    console.log('[AutoUpdate] Service Worker assumiu o controle. Recarregando...');
    window.location.reload();
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
  }

  return () => {
    if (checkIntervalTimer) {
      clearInterval(checkIntervalTimer);
      checkIntervalTimer = null;
    }
    window.removeEventListener('focus', handleVisibilityOrFocus);
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    }
  };
}

export function subscribeToUpdateNotice(callback: UpdateCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
