/**
 * Serviço de Gerenciamento e Busca Automática de Atualizações
 * Garante que o aplicativo web / PWA busque atualizações automaticamente
 * sem que o usuário fique preso em versões antigas em cache.
 */

const LOCAL_STORAGE_VERSION_KEY = 'cantina_app_version';

export interface VersionInfo {
  version: string;
  serverTime: string;
  startedAt: string;
  name: string;
}

type UpdateCallback = (hasUpdate: boolean, newVersion?: string) => void;
const listeners: Set<UpdateCallback> = new Set();

let currentKnownVersion: string | null = null;
let checkIntervalTimer: any = null;
let isUpdating = false;

// Inicializa a versão salva
try {
  currentKnownVersion = localStorage.getItem(LOCAL_STORAGE_VERSION_KEY);
} catch (e) {}

/**
 * Consulta o servidor para verificar a versão atual da aplicação
 */
export async function fetchServerVersion(): Promise<VersionInfo | null> {
  try {
    // Adiciona timestamp para furar qualquer cache de proxy, navegador ou CDN
    const res = await fetch(`/api/version?_nocache=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data as VersionInfo;
  } catch (err) {
    // Falha silenciosa em caso de offline
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
      await Promise.all(keys.map(key => caches.delete(key)));
      console.log('[AutoUpdate] CacheStorage limpo com sucesso.');
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
  } catch (e) {}
}

/**
 * Força a atualização imediata da aplicação com recarregamento da página
 */
export async function forceAppUpdate(): Promise<void> {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const serverInfo = await fetchServerVersion();
    if (serverInfo?.version) {
      localStorage.setItem(LOCAL_STORAGE_VERSION_KEY, serverInfo.version);
    }
  } catch (e) {}

  await clearAllAppCaches();

  // Força recarregamento furando o cache
  const cleanUrl = window.location.origin + window.location.pathname;
  window.location.href = `${cleanUrl}?v=${Date.now()}`;
}

/**
 * Verifica se há uma nova versão e notifica listeners ou atualiza automaticamente
 */
export async function checkForAppUpdates(autoReload: boolean = true): Promise<boolean> {
  const serverInfo = await fetchServerVersion();
  if (!serverInfo || !serverInfo.version) return false;

  const serverVer = serverInfo.version;

  // Primeira vez abrindo a aplicação
  if (!currentKnownVersion) {
    currentKnownVersion = serverVer;
    try {
      localStorage.setItem(LOCAL_STORAGE_VERSION_KEY, serverVer);
    } catch (e) {}
    return false;
  }

  // Detectou versão mais recente!
  if (currentKnownVersion !== serverVer) {
    console.log(`[AutoUpdate] Nova versão detectada: ${serverVer} (atual: ${currentKnownVersion})`);
    
    listeners.forEach(cb => {
      try { cb(true, serverVer); } catch (e) {}
    });

    if (autoReload) {
      try {
        localStorage.setItem(LOCAL_STORAGE_VERSION_KEY, serverVer);
      } catch (e) {}
      
      // Pequeno delay para exibir notificação visual na tela
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
  // 1. Checagem inicial na inicialização
  checkForAppUpdates(false).catch(() => {});

  // 2. Checagem periódica a cada 30 segundos
  if (!checkIntervalTimer) {
    checkIntervalTimer = setInterval(() => {
      checkForAppUpdates(true).catch(() => {});
    }, 30000);
  }

  // 3. Checagem imediata quando o usuário volta para a aba ou desbloqueia o celular
  const handleVisibilityOrFocus = () => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdates(true).catch(() => {});
    }
  };

  window.addEventListener('focus', handleVisibilityOrFocus);
  document.addEventListener('visibilitychange', handleVisibilityOrFocus);

  // 4. Se o Service Worker mudar de versão ativa, recarrega automaticamente
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[AutoUpdate] Service Worker assumiu o controle. Recarregando...');
      window.location.reload();
    });
  }

  return () => {
    if (checkIntervalTimer) {
      clearInterval(checkIntervalTimer);
      checkIntervalTimer = null;
    }
    window.removeEventListener('focus', handleVisibilityOrFocus);
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
  };
}

export function subscribeToUpdateNotice(callback: UpdateCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
