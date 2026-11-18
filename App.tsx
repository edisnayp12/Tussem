import React, { useState, useEffect, useCallback } from 'react';
import { Product, Sale, PaymentMethod, User, AppSettings, UserRole, Customer, AuditLog, CashShift, CashOutflow, CashMovement } from './types';
import { db } from './services/firebaseService';
import Layout from './components/Layout';
import DashboardView from './components/DashboardView';
import SalesView from './components/SalesView';
import InventoryView from './components/InventoryView';
import FiadoView from './components/FiadoView';
import CustomersView from './components/CustomersView';
import ReportsView from './components/ReportsView';
import SettingsView from './components/SettingsView';
import LogView from './components/LogView';
import ReservaView from './components/ReservaView';
import KdsView from './components/KdsView';
import CashRegisterView from './components/CashRegisterView';
import AIAssistantModal from './components/AIAssistantModal';
import LoginScreen from './components/LoginScreen';
import { safeStorage } from './utils/safeStorage';
import { storageService } from './services/storageService';
import { FeedbackProvider, useFeedback } from './components/FeedbackProvider';
import { 
  initAutoUpdateWatcher, 
  subscribeToUpdateNotice, 
  checkForAppUpdates, 
  forceAppUpdate,
  setLiveAppUrl
} from './services/autoUpdateService';

const isCurrentRouteReserva = (): boolean => {
  try {
    const pathClean = window.location.pathname.toLowerCase().replace(/\/+$/, '');
    return (
      pathClean === '/reserva' ||
      window.location.hash.toLowerCase().includes('reserva') ||
      new URLSearchParams(window.location.search).get('view') === 'reserva'
    );
  } catch {
    return false;
  }
};

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos (600.000 ms)
const SESSION_USER_KEY = 'cantina_user_session';
const SESSION_ACTIVITY_KEY = 'cantina_last_activity';

const getInitialUser = (): User | null => {
  try {
    const savedUser = safeStorage.getItem(SESSION_USER_KEY);
    const lastActivity = safeStorage.getItem(SESSION_ACTIVITY_KEY);
    if (savedUser && lastActivity) {
      const elapsed = Date.now() - Number(lastActivity);
      if (elapsed < INACTIVITY_TIMEOUT_MS) {
        return JSON.parse(savedUser);
      }
    }
  } catch (err) {
    console.error("Erro ao carregar sessão existente:", err);
  }
  return null;
};

const getInitialTheme = (): 'light' | 'dark' => {
  try {
    return (safeStorage.getItem('cantina_theme') as 'light' | 'dark') || 'light';
  } catch {
    return 'light';
  }
};

const computePendingFiados = (allSales: Sale[]): Sale[] =>
  allSales.filter(
    (sale) =>
      sale.status === 'pendente' &&
      (sale.forma_pagamento === PaymentMethod.FIADO ||
        (sale.tipo_pedido === 'reserva' && sale.status_entrega === 'entregue'))
  );

const AppContent: React.FC = () => {
  const { showToast, confirmAction } = useFeedback();
  const initialDemo = React.useMemo(() => storageService.initializeDemoDataIfNeeded(), []);
  const [currentUser, setCurrentUser] = useState<User | null>(getInitialUser);
  const [activeTab, setActiveTab] = useState<string>('venda');
  const [products, setProducts] = useState<Product[]>(initialDemo.products);
  const [sales, setSales] = useState<Sale[]>(initialDemo.sales);
  const [fiados, setFiados] = useState<Sale[]>(() => computePendingFiados(initialDemo.sales));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shifts, setShifts] = useState<CashShift[]>(() => storageService.getCashShifts());
  const [cashOutflows, setCashOutflows] = useState<CashOutflow[]>(() => storageService.getCashOutflows());
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => ({ 
    cantinaName: 'TUSEMM - Maria Mulambo',
    tema: getInitialTheme()
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState<'healthy' | 'warning' | 'error' | 'syncing'>('healthy');
  const [lastSync, setLastSync] = useState(new Date());
  const [inactivityNotice, setInactivityNotice] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Monitoramento de atualizações contínuo (polled a cada 30s + ao focar/reabrir a aba)
  useEffect(() => {
    const stopWatcher = initAutoUpdateWatcher();
    const unsubNotice = subscribeToUpdateNotice((hasUpdate, version) => {
      if (hasUpdate) {
        setUpdateNotice(`Nova versão detectada (${version || 'recente'})! Atualizando sistema...`);
      }
    });

    return () => {
      stopWatcher();
      unsubNotice();
    };
  }, []);

  const handleManualCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateNotice('Verificando atualizações no servidor...');
    try {
      const hasNew = await checkForAppUpdates(true);
      if (!hasNew) {
        setUpdateNotice('Você já está na versão mais recente do sistema!');
        setTimeout(() => setUpdateNotice(null), 3000);
      }
    } catch (e) {
      console.error('Erro ao buscar atualizações:', e);
      setUpdateNotice('Não foi possível verificar atualizações no momento.');
      setTimeout(() => setUpdateNotice(null), 3000);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleForceUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateNotice('Limpando todos os caches e baixando última versão...');
    try {
      await forceAppUpdate();
    } catch (e) {
      console.error('Erro na atualização forçada:', e);
      window.location.reload();
    }
  };

  // Sincroniza URL remota de OTA (Android/PWA) quando carregada do Firestore
  useEffect(() => {
    if (settings.liveAppUrl) {
      setLiveAppUrl(settings.liveAppUrl);
      checkForAppUpdates(true).catch(() => {});
    }
  }, [settings.liveAppUrl]);

  // Efeito para sincronizar e aplicar tema no DOM e meta tag
  useEffect(() => {
    const activeTheme = settings.tema || getInitialTheme();
    try {
      if (activeTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {}
    safeStorage.setItem('cantina_theme', activeTheme);
    try {
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', activeTheme === 'dark' ? '#0d081a' : '#4c1d95');
      }
    } catch (e) {}
  }, [settings.tema]);

  const handleToggleTheme = () => {
    const nextTheme: 'light' | 'dark' = settings.tema === 'dark' ? 'light' : 'dark';
    const updated: AppSettings = { ...settings, tema: nextTheme };
    setSettings(updated);
    try {
      if (nextTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {}
    safeStorage.setItem('cantina_theme', nextTheme);
    if (currentUser) {
      onUpdateSettings(updated);
    }
  };

  // Logout com controle de inatividade
  const handleLogout = useCallback(async (isAuto = false) => {
    if (currentUser) {
      db.logAction(
        currentUser.nome, 
        currentUser.id, 
        isAuto ? 'Logout por Inatividade' : 'Logout do Sistema', 
        isAuto ? 'Sessão encerrada automaticamente após 10 minutos de inatividade.' : `Operador ${currentUser.nome} encerrou a sessão.`
      ).catch(() => {});
    }
    safeStorage.removeItem(SESSION_USER_KEY);
    safeStorage.removeItem(SESSION_ACTIVITY_KEY);
    setCurrentUser(null);
    try {
      await db.logout();
    } catch (err) {
      console.error("Erro ao deslogar:", err);
    }
    if (isAuto) {
      setInactivityNotice(true);
    }
  }, [currentUser]);

  // Monitoramento de inatividade (10 minutos)
  useEffect(() => {
    if (!currentUser) return;

    let lastRecorded = Date.now();
    const recordActivity = () => {
      const now = Date.now();
      if (now - lastRecorded > 3000) {
        lastRecorded = now;
        safeStorage.setItem(SESSION_ACTIVITY_KEY, now.toString());
      }
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    activityEvents.forEach(evt => window.addEventListener(evt, recordActivity, { passive: true }));

    // Intervalo para verificar a inatividade a cada 5 segundos
    const checkInterval = setInterval(() => {
      const last = Number(safeStorage.getItem(SESSION_ACTIVITY_KEY) || Date.now());
      const elapsed = Date.now() - last;
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        clearInterval(checkInterval);
        handleLogout(true);
      }
    }, 5000);

    return () => {
      activityEvents.forEach(evt => window.removeEventListener(evt, recordActivity));
      clearInterval(checkInterval);
    };
  }, [currentUser, handleLogout]);

  useEffect(() => {
    // Timeout para evitar tela de carregamento presa
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000); 

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    let unsubProducts: any;
    let unsubSales: any;
    let unsubCustomers: any;
    let unsubShifts: any;
    let unsubOutflows: any;
    let unsubUsers: any;
    let unsubSettings: any;
    let unsubLogs: any;

    const handleError = (err: any) => {
      console.warn("Firebase Sync Notice:", err);
      setDbStatus('warning');
      setIsLoading(false);
    };

    const initFirebaseListeners = async () => {
      const safetyTimer = setTimeout(() => {
        setIsLoading(false);
      }, 2500);

      try {
        await db.ensureAuthReady();
        clearTimeout(safetyTimer);
        
        unsubProducts = db.subscribeToProducts((p) => {
          if (p.length > 0) {
            setProducts(p);
            storageService.saveProducts(p);
          } else {
            const localProds = storageService.initializeDemoDataIfNeeded().products;
            setProducts(localProds);
            if (localProds.length > 0) {
              db.seedDemoProducts(localProds).catch(() => {});
            }
          }
          setLastSync(new Date());
        }, handleError);
        unsubSales = db.subscribeToSales((s) => {
          const localSales = storageService.getSales();
          const cloudIds = new Set(s.map((item) => item.id));
          const merged = [
            ...s,
            ...localSales.filter((ls) => ls.id.startsWith('LOCAL-') && !cloudIds.has(ls.id))
          ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

          setSales(merged);
          setFiados(computePendingFiados(merged));
          storageService.saveSales(merged);
          setLastSync(new Date());
        }, handleError);
        unsubCustomers = db.subscribeToCustomers((c) => { setCustomers(c); setLastSync(new Date()); }, handleError);
        unsubShifts = db.subscribeToCashShifts((sh) => {
          const localShifts = storageService.getCashShifts();
          const cloudIds = new Set(sh.map((item) => item.id));
          const merged = [
            ...sh,
            ...localShifts.filter((ls) => ls.id.startsWith('LOCAL-') && !cloudIds.has(ls.id))
          ].sort((a, b) => new Date(b.aberto_em).getTime() - new Date(a.aberto_em).getTime());
          setShifts(merged);
          storageService.saveCashShifts(merged);
          setLastSync(new Date());
        }, handleError);
        unsubOutflows = db.subscribeToCashOutflows((outs) => {
          const localOuts = storageService.getCashOutflows();
          const cloudIds = new Set(outs.map((item) => item.id));
          const merged = [
            ...outs,
            ...localOuts.filter((lo) => lo.id.startsWith('LOCAL-') && !cloudIds.has(lo.id))
          ].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
          setCashOutflows(merged);
          storageService.saveCashOutflows(merged);
          setLastSync(new Date());
        }, handleError);
        unsubUsers = db.subscribeToUsers((u) => { setUsers(u); setLastSync(new Date()); }, handleError);
        unsubSettings = db.subscribeToSettings((set) => { 
          setSettings(prev => ({
            ...prev,
            ...set,
            tema: set.tema || prev.tema || getInitialTheme()
          })); 
          setLastSync(new Date()); 
          setIsLoading(false); 
        }, handleError);

        unsubLogs = (db as any).subscribeToLogs(
          (l: AuditLog[]) => setLogs(l), 
          (err: any) => console.error("Logs error:", err)
        );

        setDbStatus('healthy');
      } catch (e: any) {
        console.warn("Firebase init notice:", e);
        setDbStatus('warning');
        setIsLoading(false);
      }
    };

    initFirebaseListeners();

    return () => {
      unsubProducts && unsubProducts();
      unsubSales && unsubSales();
      unsubCustomers && unsubCustomers();
      unsubShifts && unsubShifts();
      unsubOutflows && unsubOutflows();
      unsubUsers && unsubUsers();
      unsubSettings && unsubSettings();
      unsubLogs && unsubLogs();
    };
  }, [currentUser]);

  const saveUserSession = (user: User) => {
    safeStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    safeStorage.setItem(SESSION_ACTIVITY_KEY, Date.now().toString());
    setCurrentUser(user);
  };

  const handleLoginSuccess = (user: User, methodLabel: string) => {
    setInactivityNotice(false);
    saveUserSession(user);
    db.logAction(
      user.nome || user.usuario,
      user.id,
      'Login no Sistema',
      `Operador ${user.nome || user.usuario} entrou via ${methodLabel} (${user.perfil.toUpperCase()})`
    ).catch(() => {});

    if (user.perfil === UserRole.KDS) {
      setActiveTab('kds');
    } else {
      setActiveTab('venda');
    }
  };

  const handleSuperAdminLogin = async (email: string, pass: string) => {
    await db.loginAsSuperAdmin(email, pass);
    const adminUser: User = {
      id: 'super-admin',
      nome: 'Dono TUSEMM',
      usuario: 'tusemmaxe',
      perfil: UserRole.ADMIN,
      ativo: true
    };
    handleLoginSuccess(adminUser, 'E-mail Master');
  };

  const handleCompleteSale = async (data: any): Promise<Sale | void> => {
    const isReserva = isCurrentRouteReserva();
    if (!currentUser && !isReserva) return;

    const saleItems: any[] = (data.items || []).map((i: any) => ({
      produto_id: i.produto_id,
      nome: i.nome || '',
      preco_unitario: Number(i.preco_unitario) || 0,
      quantidade: Number(i.quantidade) || 1,
      subtotal: Number(i.subtotal) || 0
    }));

    const localSaleId = `LOCAL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const localSaleRecord: Sale = {
      id: localSaleId,
      usuario_id: currentUser?.id,
      operador_nome: currentUser?.nome || currentUser?.usuario || (isReserva ? 'Reserva Online' : 'Operador'),
      forma_pagamento: data.paymentMethod,
      valor_total: Number(data.total) || 0,
      valor_recebido: data.valor_recebido,
      troco: data.troco,
      status: data.paymentMethod === PaymentMethod.FIADO || data.tipo_pedido === 'reserva' ? 'pendente' : 'pago',
      cliente_nome: data.customerName?.trim() || 'Balcão',
      telefone_comprador: data.telefone_comprador,
      created_at: nowIso,
      itens: saleItems,
      tipo_pedido: data.tipo_pedido || 'balcao',
      status_entrega: data.tipo_pedido === 'reserva' ? 'pendente' : 'entregue'
    };

    try {
      const savedSale = await db.createSale(
        { ...data, created_at: nowIso },
        saleItems,
        currentUser?.id || null,
        currentUser?.nome || currentUser?.usuario
      );
      const localAfter = storageService.applySaleToLocal(savedSale, saleItems);
      setProducts(localAfter.products);
      setSales(localAfter.sales);
      setFiados(computePendingFiados(localAfter.sales));
      return savedSale;
    } catch (e: any) {
      console.warn('Persistência offline/local aplicada para venda:', e?.message);
      const localAfter = storageService.applySaleToLocal(localSaleRecord, saleItems);
      setProducts(localAfter.products);
      setSales(localAfter.sales);
      setFiados(computePendingFiados(localAfter.sales));
      return localSaleRecord;
    }
  };

  const handleResetDemoData = async () => {
    const confirmed = await confirmAction({
      title: 'Resetar dados de demonstração',
      message: 'Isso restaurará os 8 produtos iniciais com seus estoques originais e limpará o histórico local de vendas de demonstração. Deseja continuar?',
      confirmLabel: 'Resetar Dados',
      destructive: true
    });
    if (!confirmed) return;

    const reset = storageService.resetDemoData();
    setProducts(reset.products);
    setSales(reset.sales);
    setFiados([]);

    try {
      await db.resetDemoDataInCloud(reset.products, currentUser?.nome, currentUser?.id);
    } catch (err) {
      console.warn('Reset aplicado localmente:', err);
    }
    showToast('Dados de demonstração restaurados com sucesso!', 'success');
  };

  const onUpdateSettings = async (newSettings: AppSettings) => {
    if (!currentUser) return;
    setSettings(newSettings);
    if (newSettings.tema) {
      safeStorage.setItem('cantina_theme', newSettings.tema);
      try {
        if (newSettings.tema === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } catch (e) {}
    }
    try {
      await db.saveSettings(newSettings, currentUser.nome, currentUser.id);
    } catch (e) {
      console.error("Failed to update settings:", e);
    }
  };

  const handleSaveCustomer = async (data: { id?: string; nome: string; telefone: string }) => {
    await db.saveOrUpdateCustomer(data, currentUser?.nome, currentUser?.id);
  };

  const handleDeleteCustomer = async (customerId: string, customerName: string) => {
    await db.deleteCustomer(customerId, customerName, currentUser?.nome, currentUser?.id);
  };

  const handleUpdateSaleContact = async (saleId: string, telefone: string, cliente_nome?: string) => {
    await db.updateSaleContact(saleId, telefone, cliente_nome, currentUser?.nome, currentUser?.id);
  };

  const handleUpdateSale = async (saleId: string, data: any) => {
    const { logDetalhes, ...saleUpdates } = data || {};
    setSales((prev) => {
      const next = prev.map((s) => (s.id === saleId ? { ...s, ...saleUpdates } : s));
      storageService.saveSales(next);
      setFiados(computePendingFiados(next));
      return next;
    });

    if (!saleId.startsWith('LOCAL-')) {
      await db.updateSale(
        saleId,
        { ...saleUpdates, ...(logDetalhes ? { logDetalhes } : {}) },
        currentUser?.nome,
        currentUser?.id
      );
    }
  };

  const handleFinalizeKdsWithUnclaimed = async (
    saleId: string,
    payload: {
      itens: any[];
      restoreStock: boolean;
      valor_total: number;
      valor_original?: number;
      status: 'pago' | 'pendente' | 'cancelado';
      forma_pagamento?: PaymentMethod;
      forma_pagamento_original?: PaymentMethod;
      possui_nao_retirado: boolean;
      motivo_nao_retirado?: string;
      logDetalhes?: string;
    }
  ) => {
    setSales((prev) => {
      const next = prev.map((s) =>
        s.id === saleId
          ? {
              ...s,
              itens: payload.itens,
              status_entrega: 'entregue' as const,
              possui_nao_retirado: payload.possui_nao_retirado,
              valor_total: payload.valor_total,
              ...(payload.valor_original !== undefined ? { valor_original: payload.valor_original } : {}),
              status: payload.status,
              ...(payload.forma_pagamento ? { forma_pagamento: payload.forma_pagamento } : {}),
              ...(payload.forma_pagamento_original ? { forma_pagamento_original: payload.forma_pagamento_original } : {}),
              ...(payload.motivo_nao_retirado ? { motivo_nao_retirado: payload.motivo_nao_retirado } : {})
            }
          : s
      );
      storageService.saveSales(next);
      setFiados(computePendingFiados(next));
      return next;
    });

    if (payload.restoreStock) {
      const restoreMap: Record<string, number> = {};
      (payload.itens || []).forEach((it: any) => {
        const unclaimed = Math.max(0, Number(it.quantidade_nao_retirada) || 0);
        if (it.produto_id && unclaimed > 0) {
          restoreMap[it.produto_id] = (restoreMap[it.produto_id] || 0) + unclaimed;
        }
      });
      if (Object.keys(restoreMap).length > 0) {
        setProducts((prev) => {
          const nextProducts = prev.map((p) => {
            const addQty = restoreMap[p.id];
            if (!addQty) return p;
            return { ...p, estoque: (Number(p.estoque) || 0) + addQty };
          });
          storageService.saveProducts(nextProducts);
          return nextProducts;
        });
      }
    }

    if (!saleId.startsWith('LOCAL-')) {
      await db.finalizeKdsOrder(saleId, payload, currentUser?.nome, currentUser?.id);
    }
  };

  const currentShift = shifts.find((s) => s.status === 'aberto') || null;

  const handleOpenCashShift = async (valorAbertura: number) => {
    if (!currentUser) return;
    const opName = currentUser.nome || currentUser.usuario;
    const opId = currentUser.id || '0';
    try {
      const created = await db.openCashShift(valorAbertura, opName, opId);
      setShifts((prev) => {
        const next = [created, ...prev.filter((s) => s.id !== created.id)];
        storageService.saveCashShifts(next);
        return next;
      });
    } catch (e: any) {
      const localShift: CashShift = {
        id: `LOCAL-SHIFT-${Date.now().toString(36)}`,
        status: 'aberto',
        aberto_em: new Date().toISOString(),
        aberto_por_nome: opName,
        aberto_por_id: opId,
        valor_abertura: Number(valorAbertura) || 0,
        movimentacoes: [],
        total_sangrias: 0,
        total_suprimentos: 0,
        total_saidas: 0
      };
      setShifts((prev) => {
        const next = [localShift, ...prev];
        storageService.saveCashShifts(next);
        return next;
      });
      console.warn('Turno salvo localmente:', e?.message);
    }
  };

  const handleAddCashMovement = async (tipo: 'sangria' | 'suprimento', valor: number, motivo: string) => {
    if (!currentUser || !currentShift) return;
    const opName = currentUser.nome || currentUser.usuario;
    const opId = currentUser.id || '0';
    const applyLocally = (mov: CashMovement) => {
      setShifts((prev) => {
        const next = prev.map((sh) => {
          if (sh.id !== currentShift.id) return sh;
          const updatedMovs = [...(sh.movimentacoes || []).filter((m) => m.id !== mov.id), mov];
          return {
            ...sh,
            movimentacoes: updatedMovs,
            total_sangrias: updatedMovs.filter((m) => m.tipo === 'sangria').reduce((a, b) => a + (Number(b.valor) || 0), 0),
            total_suprimentos: updatedMovs.filter((m) => m.tipo === 'suprimento').reduce((a, b) => a + (Number(b.valor) || 0), 0),
            total_saidas: updatedMovs.filter((m) => m.tipo === 'saida').reduce((a, b) => a + (Number(b.valor) || 0), 0)
          };
        });
        storageService.saveCashShifts(next);
        return next;
      });
    };

    if (currentShift.id.startsWith('LOCAL-')) {
      applyLocally({
        id: `LOCAL-MOV-${Date.now().toString(36)}`,
        tipo,
        valor,
        motivo: motivo.trim() || (tipo === 'sangria' ? 'Retirada de dinheiro (Sangria)' : 'Reforço de troco (Suprimento)'),
        data: new Date().toISOString(),
        operador_nome: opName,
        operador_id: opId
      });
      return;
    }

    try {
      const mov = await db.addCashMovement(currentShift.id, tipo, valor, motivo, opName, opId);
      applyLocally(mov);
    } catch (e: any) {
      applyLocally({
        id: `LOCAL-MOV-${Date.now().toString(36)}`,
        tipo,
        valor,
        motivo: motivo.trim() || (tipo === 'sangria' ? 'Retirada de dinheiro (Sangria)' : 'Reforço de troco (Suprimento)'),
        data: new Date().toISOString(),
        operador_nome: opName,
        operador_id: opId
      });
      console.warn('Movimentação salva localmente:', e?.message);
    }
  };

  const handleRemoveCashMovement = async (shiftId: string, movementId: string) => {
    if (!currentUser) return;
    const opName = currentUser.nome || currentUser.usuario;
    const opId = currentUser.id || '0';

    setShifts((prev) => {
      const next = prev.map((sh) => {
        if (sh.id !== shiftId) return sh;
        const updatedMovs = (sh.movimentacoes || []).filter((m) => m.id !== movementId);
        return {
          ...sh,
          movimentacoes: updatedMovs,
          total_sangrias: updatedMovs.filter((m) => m.tipo === 'sangria').reduce((a, b) => a + (Number(b.valor) || 0), 0),
          total_suprimentos: updatedMovs.filter((m) => m.tipo === 'suprimento').reduce((a, b) => a + (Number(b.valor) || 0), 0),
          total_saidas: updatedMovs.filter((m) => m.tipo === 'saida').reduce((a, b) => a + (Number(b.valor) || 0), 0)
        };
      });
      storageService.saveCashShifts(next);
      return next;
    });

    if (!shiftId.startsWith('LOCAL-')) {
      await db.removeCashMovement(shiftId, movementId, opName, opId).catch((err) => console.warn(err));
    }
  };

  const handleAddCashOutflow = async (data: { categoria: string; valor: number; motivo: string }) => {
    if (!currentUser) return;
    const opName = currentUser.nome || currentUser.usuario;
    const opId = currentUser.id || '0';
    const nowIso = new Date().toISOString();
    const openShiftId = currentShift?.id || null;

    const applyOutflowLocally = (outflow: CashOutflow) => {
      setCashOutflows((prev) => {
        const next = [outflow, ...prev.filter((o) => o.id !== outflow.id)].sort(
          (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()
        );
        storageService.saveCashOutflows(next);
        return next;
      });

      if (openShiftId) {
        const mov: CashMovement = {
          id: outflow.id,
          tipo: 'saida',
          categoria: outflow.categoria,
          valor: outflow.valor,
          motivo: outflow.motivo,
          data: outflow.data,
          operador_nome: outflow.operador_nome,
          operador_id: outflow.operador_id
        };
        setShifts((prev) => {
          const next = prev.map((sh) => {
            if (sh.id !== openShiftId) return sh;
            const updatedMovs = [...(sh.movimentacoes || []).filter((m) => m.id !== mov.id), mov];
            return {
              ...sh,
              movimentacoes: updatedMovs,
              total_saidas: updatedMovs.filter((m) => m.tipo === 'saida').reduce((a, b) => a + (Number(b.valor) || 0), 0)
            };
          });
          storageService.saveCashShifts(next);
          return next;
        });
      }
    };

    try {
      const saved = await db.addCashOutflow({
        categoria: data.categoria,
        valor: data.valor,
        motivo: data.motivo,
        operador_nome: opName,
        operador_id: opId,
        shift_id: openShiftId && !openShiftId.startsWith('LOCAL-') ? openShiftId : null,
        data: nowIso
      });
      applyOutflowLocally({ ...saved, shift_id: openShiftId });
    } catch (e: any) {
      const localOutflow: CashOutflow = {
        id: `LOCAL-OUT-${Date.now().toString(36)}`,
        shift_id: openShiftId,
        categoria: data.categoria,
        valor: Number(data.valor) || 0,
        motivo: data.motivo,
        data: nowIso,
        operador_nome: opName,
        operador_id: opId
      };
      applyOutflowLocally(localOutflow);
      console.warn('Saída salva localmente:', e?.message);
    }

    showToast(`Saída de R$ ${Number(data.valor).toFixed(2)} lançada no caixa!`, 'success');
  };

  const handleDeleteCashOutflow = async (outflow: CashOutflow) => {
    if (!currentUser) return;
    const opName = currentUser.nome || currentUser.usuario;
    const opId = currentUser.id || '0';

    setCashOutflows((prev) => {
      const next = prev.filter((o) => o.id !== outflow.id);
      storageService.saveCashOutflows(next);
      return next;
    });

    if (outflow.shift_id) {
      setShifts((prev) => {
        const next = prev.map((sh) => {
          if (sh.id !== outflow.shift_id || sh.status !== 'aberto') return sh;
          const updatedMovs = (sh.movimentacoes || []).filter((m) => m.id !== outflow.id);
          return {
            ...sh,
            movimentacoes: updatedMovs,
            total_saidas: updatedMovs.filter((m) => m.tipo === 'saida').reduce((a, b) => a + (Number(b.valor) || 0), 0)
          };
        });
        storageService.saveCashShifts(next);
        return next;
      });
    }

    if (!outflow.id.startsWith('LOCAL-')) {
      await db.deleteCashOutflow(outflow, opName, opId).catch((err) => console.warn(err));
    }
  };

  const handleCloseCashShift = async (
    valorInformado: number,
    valorCalculado: number,
    totaisVendas: any,
    obs: string
  ) => {
    if (!currentUser || !currentShift) return;
    const opName = currentUser.nome || currentUser.usuario;
    const opId = currentUser.id || '0';
    const diferenca = Number((valorInformado - valorCalculado).toFixed(2));
    const closedAt = new Date().toISOString();

    setShifts((prev) => {
      const next = prev.map((sh) =>
        sh.id === currentShift.id
          ? {
              ...sh,
              status: 'fechado' as const,
              fechado_em: closedAt,
              fechado_por_nome: opName,
              fechado_por_id: opId,
              valor_fechamento_informado: valorInformado,
              valor_fechamento_calculado: valorCalculado,
              diferenca,
              observacoes_fechamento: obs.trim() || undefined,
              total_vendas_dinheiro: totaisVendas.dinheiro || 0,
              total_vendas_pix: totaisVendas.pix || 0,
              total_vendas_debito: totaisVendas.debito || 0,
              total_vendas_credito: totaisVendas.credito || 0,
              total_vendas_fiado: totaisVendas.fiado || 0,
              total_saidas: totaisVendas.saidas ?? sh.total_saidas ?? 0
            }
          : sh
      );
      storageService.saveCashShifts(next);
      return next;
    });

    if (!currentShift.id.startsWith('LOCAL-')) {
      await db
        .closeCashShift(currentShift.id, valorInformado, valorCalculado, totaisVendas, obs, opName, opId)
        .catch((err) => console.warn(err));
    }
  };

  const isReservaRoute = isCurrentRouteReserva();

  if (isReservaRoute) {
    if (isLoading && products.length === 0) {
      return (
        <div className="min-h-[100dvh] bg-gray-50 dark:bg-[#0d081a] flex flex-col items-center justify-center text-purple-950 dark:text-white p-6 text-center">
          <div className="w-16 h-16 border-4 border-purple-200 dark:border-purple-900 border-t-purple-600 rounded-full animate-spin mb-4"></div>
          <h2 className="text-xl font-black uppercase tracking-tight">Carregando Cardápio...</h2>
          <p className="text-xs text-gray-400 dark:text-purple-300/60 mt-1 uppercase font-bold tracking-widest">{settings.cantinaName}</p>
        </div>
      );
    }
    return (
      <>
        <ReservaView products={products} settings={settings} onReserve={async (d) => { await handleCompleteSale(d); }} />
        {updateNotice && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[250] max-w-md w-[92%] bg-purple-950 text-white px-5 py-4 rounded-3xl shadow-2xl border border-purple-500/40 flex items-center gap-4 animate-in slide-in-from-top-4 duration-300 backdrop-blur-md">
            <div className="w-10 h-10 rounded-2xl bg-purple-800/80 flex items-center justify-center shrink-0">
              <i className={`fa-solid fa-arrows-rotate text-purple-200 text-base ${isCheckingUpdate ? 'animate-spin' : ''}`}></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-purple-300">Atualização do Sistema</p>
              <p className="text-xs font-bold text-white mt-0.5 leading-snug truncate">{updateNotice}</p>
            </div>
          </div>
        )}
      </>
    );
  }

  if (isLoading && !currentUser) return (
    <div className="min-h-screen bg-purple-950 flex flex-col items-center justify-center text-white p-6 text-center">
      <div className="relative mb-8">
        <div className="w-20 h-20 border-4 border-white/10 rounded-full"></div>
        <div className="w-20 h-20 border-4 border-t-purple-400 border-white/0 rounded-full animate-spin absolute top-0 left-0"></div>
      </div>
      <h1 className="text-3xl font-black uppercase tracking-[0.2em] mb-2">TUSEMM</h1>
      <p className="text-[10px] opacity-40 font-black uppercase tracking-[0.3em]">Conectando ao Firebase...</p>
    </div>
  );

  if (!currentUser) return (
    <LoginScreen
      cantinaName={settings.cantinaName}
      users={users}
      inactivityNotice={inactivityNotice}
      onLoginSuccess={handleLoginSuccess}
      onSuperAdminLogin={handleSuperAdminLogin}
    />
  );

  return (
    <>
      <Layout 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={() => handleLogout(false)} 
        settings={settings} 
        currentUser={currentUser} 
        dbStatus={dbStatus}
        lastSyncAt={lastSync}
        onToggleTheme={handleToggleTheme}
        onOpenAI={() => setIsAIOpen(true)}
        onForceUpdate={handleManualCheckUpdate}
        isCheckingUpdate={isCheckingUpdate}
      >
        {activeTab === 'home' && <DashboardView sales={sales} products={products} setActiveTab={setActiveTab} />}
        {activeTab === 'venda' && (
          <SalesView 
            products={products} 
            settings={settings} 
            fiados={fiados}
            customers={customers}
            sales={sales}
            currentUser={currentUser}
            hasOpenShift={Boolean(currentShift)}
            onCompleteSale={handleCompleteSale}
            onUpdateSaleContact={handleUpdateSaleContact}
            onAddCashOutflow={handleAddCashOutflow}
            onOpenAdminPanel={() => setActiveTab('estoque')}
          />
        )}
        {activeTab === 'caixa' && (
          <CashRegisterView 
            shifts={shifts}
            currentShift={currentShift}
            outflows={cashOutflows}
            sales={sales}
            currentUser={currentUser}
            onOpenShift={handleOpenCashShift}
            onAddMovement={handleAddCashMovement}
            onRemoveMovement={handleRemoveCashMovement}
            onAddOutflow={handleAddCashOutflow}
            onDeleteOutflow={handleDeleteCashOutflow}
            onCloseShift={handleCloseCashShift}
          />
        )}
        {activeTab === 'fiado' && (
          <FiadoView 
            fiados={fiados} 
            allSales={sales}
            customers={customers}
            products={products} 
            settings={settings} 
            onPayDebt={async (pid, m) => {
              setSales((prev) => {
                const next = prev.map((s) => (s.id === pid ? { ...s, status: 'pago' as const, pago_com: m } : s));
                storageService.saveSales(next);
                setFiados(computePendingFiados(next));
                return next;
              });
              if (!pid.startsWith('LOCAL-')) {
                await db.payFiado(pid, m, currentUser?.nome, currentUser?.id);
              }
            }} 
            onUpdateFiadoCustomer={async (saleIds, nome, telefone) => {
              await db.updateFiadoCustomer(saleIds, nome, telefone, currentUser?.nome, currentUser?.id);
            }}
            onAddFiadoSale={async (d) => { await handleCompleteSale(d); }}
            onNavigateToPDV={() => setActiveTab('venda')}
            onLogBatchDispatch={async (count, total) => {
              await db.logAction(
                currentUser?.nome || 'Operador', 
                currentUser?.id || '0', 
                'Cobrança em Massa de Fiados', 
                `Disparo de cobrança WhatsApp para ${count} cliente(s) no total de R$ ${total.toFixed(2)}`
              );
            }}
          />
        )}
        {activeTab === 'clientes' && (
          <CustomersView 
            customers={customers} 
            sales={sales} 
            currentUser={currentUser} 
            onSaveCustomer={handleSaveCustomer} 
            onDeleteCustomer={handleDeleteCustomer}
            onSelectCustomerForSale={() => setActiveTab('venda')}
          />
        )}
        {activeTab === 'estoque' && (
          <InventoryView 
            products={products} 
            onUpdateProduct={async (p) => {
              setProducts((prev) => {
                const updated = prev.map((item) => (item.id === p.id ? p : item));
                storageService.saveProducts(updated);
                return updated;
              });
              await db.saveProduct(p, currentUser?.nome, currentUser?.id).catch(() => {});
            }} 
            onAddProduct={async (p) => {
              const tempId = p.id || `LOCAL-PROD-${Date.now().toString(36)}`;
              const newItem: Product = { ...p, id: tempId, created_at: new Date().toISOString() };
              setProducts((prev) => {
                const updated = [...prev, newItem];
                storageService.saveProducts(updated);
                return updated;
              });
              await db.saveProduct(p, currentUser?.nome, currentUser?.id).catch(() => {});
            }} 
            onDeleteProduct={async (id, name) => {
              setProducts((prev) => {
                const updated = prev.filter((item) => item.id !== id);
                storageService.saveProducts(updated);
                return updated;
              });
              await db.deleteProduct(id, name, currentUser?.nome || 'Operador', currentUser?.id || '0').catch(() => {});
            }}
            onResetDemoData={handleResetDemoData}
            currentUser={currentUser!} 
          />
        )}
        {activeTab === 'relatorios' && (
          <ReportsView
            sales={sales}
            users={users}
            products={products}
            customers={customers}
            settings={settings}
            onUpdateSaleContact={handleUpdateSaleContact}
          />
        )}
        {activeTab === 'kds' && (
          <KdsView
            sales={sales}
            onUpdateSale={handleUpdateSale}
            onFinalizeWithUnclaimed={handleFinalizeKdsWithUnclaimed}
            currentUser={currentUser}
          />
        )}
        {activeTab === 'logs' && <LogView logs={logs} />}
        {activeTab === 'config' && (
          <SettingsView 
            users={users} 
            currentUser={currentUser} 
            settings={settings} 
            onUpdateSettings={onUpdateSettings} 
            onAddUser={(u) => db.saveUser(u, currentUser.nome, currentUser.id)} 
            onRemoveUser={(id) => {
              const u = users.find(user => user.id === id);
              db.deleteUser(id, u?.nome || 'Desconhecido', currentUser.nome, currentUser.id);
            }} 
            onViewLogs={() => setActiveTab('logs')}
            onViewCustomers={() => setActiveTab('clientes')}
            onForceUpdate={handleForceUpdate}
            onCheckUpdate={handleManualCheckUpdate}
            onResetDemoData={handleResetDemoData}
            isCheckingUpdate={isCheckingUpdate}
          />
        )}
      </Layout>

      {/* Notificação Flutuante de Atualização */}
      {updateNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[250] max-w-md w-[92%] bg-purple-950 text-white px-5 py-4 rounded-3xl shadow-2xl border border-purple-500/40 flex items-center gap-4 animate-in slide-in-from-top-4 duration-300 backdrop-blur-md">
          <div className="w-10 h-10 rounded-2xl bg-purple-800/80 flex items-center justify-center shrink-0">
            <i className={`fa-solid fa-arrows-rotate text-purple-200 text-base ${isCheckingUpdate ? 'animate-spin' : ''}`}></i>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider text-purple-300">Atualização do Sistema</p>
            <p className="text-xs font-bold text-white mt-0.5 leading-snug truncate">{updateNotice}</p>
          </div>
          <button 
            onClick={() => setUpdateNotice(null)} 
            className="text-purple-300 hover:text-white p-2 text-xs"
            title="Fechar aviso"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}

      <AIAssistantModal 
        isOpen={isAIOpen}
        onClose={() => setIsAIOpen(false)}
        sales={sales}
        products={products}
        fiados={fiados}
        customers={customers}
        settings={settings}
      />
    </>
  );
};

const App: React.FC = () => (
  <FeedbackProvider>
    <AppContent />
  </FeedbackProvider>
);

export default App;
