import React, { useState, useEffect, useCallback } from 'react';
import { Product, Sale, PaymentMethod, User, AppSettings, UserRole, Customer, AuditLog } from './types';
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

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos (600.000 ms)
const SESSION_USER_KEY = 'cantina_user_session';
const SESSION_ACTIVITY_KEY = 'cantina_last_activity';

const getInitialUser = (): User | null => {
  try {
    const savedUser = localStorage.getItem(SESSION_USER_KEY);
    const lastActivity = localStorage.getItem(SESSION_ACTIVITY_KEY);
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

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(getInitialUser);
  const [activeTab, setActiveTab] = useState('home');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [fiados, setFiados] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ cantinaName: 'TUSEMM - Maria Mulambo' });
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState<'healthy' | 'warning' | 'error' | 'syncing'>('healthy');
  const [lastSync, setLastSync] = useState(new Date());
  const [loginData, setLoginData] = useState({ user: '', pass: '' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [inactivityNotice, setInactivityNotice] = useState(false);

  // Logout com controle de inatividade
  const handleLogout = useCallback(async (isAuto = false) => {
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_ACTIVITY_KEY);
    setCurrentUser(null);
    try {
      await db.logout();
    } catch (err) {
      console.error("Erro ao deslogar:", err);
    }
    if (isAuto) {
      setInactivityNotice(true);
    }
  }, []);

  // Monitoramento de inatividade (10 minutos)
  useEffect(() => {
    if (!currentUser) return;

    let lastRecorded = Date.now();
    const recordActivity = () => {
      const now = Date.now();
      if (now - lastRecorded > 3000) {
        lastRecorded = now;
        localStorage.setItem(SESSION_ACTIVITY_KEY, now.toString());
      }
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    activityEvents.forEach(evt => window.addEventListener(evt, recordActivity, { passive: true }));

    // Intervalo para verificar a inatividade a cada 5 segundos
    const checkInterval = setInterval(() => {
      const last = Number(localStorage.getItem(SESSION_ACTIVITY_KEY) || Date.now());
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
        
        unsubProducts = db.subscribeToProducts((p) => { setProducts(p); setLastSync(new Date()); }, handleError);
        unsubSales = db.subscribeToSales((s) => { 
          setSales(s); 
          setFiados(s.filter(sale => 
            sale.status === 'pendente' && 
            (
              (sale.tipo_pedido === 'reserva' && sale.status_entrega === 'entregue') ||
              (sale.tipo_pedido !== 'reserva' && sale.forma_pagamento === PaymentMethod.FIADO)
            )
          ));
          setLastSync(new Date()); 
        }, handleError);
        unsubCustomers = db.subscribeToCustomers((c) => { setCustomers(c); setLastSync(new Date()); }, handleError);
        unsubUsers = db.subscribeToUsers((u) => { setUsers(u); setLastSync(new Date()); }, handleError);
        unsubSettings = db.subscribeToSettings((set) => { 
          setSettings(set); 
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
      unsubUsers && unsubUsers();
      unsubSettings && unsubSettings();
      unsubLogs && unsubLogs();
    };
  }, [currentUser]);

  const saveUserSession = (user: User) => {
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    localStorage.setItem(SESSION_ACTIVITY_KEY, Date.now().toString());
    setCurrentUser(user);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setInactivityNotice(false);
    
    const userLower = loginData.user.trim().toLowerCase();

    // Login como Super Admin
    if (userLower === 'tusemmaxe@gmail.com' || userLower === 'tusemmaxe') {
      try {
        await db.loginAsSuperAdmin('tusemmaxe@gmail.com', loginData.pass);
        const adminUser: User = { id: 'super-admin', nome: 'Dono TUSEMM', usuario: 'tusemmaxe', perfil: UserRole.ADMIN, ativo: true };
        saveUserSession(adminUser);
        db.logAction('Dono TUSEMM', 'super-admin', 'Login Super Admin', 'Acesso autenticado com e-mail master').catch(() => {});
        return;
      } catch (e: any) {
        setLoginError(e.message || 'Erro ao autenticar administrador');
        return;
      }
    }

    const foundUser = users.find(u => u.usuario === loginData.user && u.ativo);
    
    if (foundUser && foundUser.senha === loginData.pass) {
      saveUserSession(foundUser);
      db.logAction(foundUser.nome, foundUser.id, 'Login no Sistema', `Usuário ${foundUser.nome} logou com perfil ${foundUser.perfil.toUpperCase()}`).catch(() => {});
      if (foundUser.perfil === UserRole.KDS) {
        setActiveTab('kds');
      }
    } else if (loginData.user === 'Tusemm' && loginData.pass === 'Tusemm@7') {
      const masterUser: User = { id: '0', nome: 'Master Admin', usuario: 'Tusemm', perfil: UserRole.ADMIN, ativo: true };
      saveUserSession(masterUser);
      db.logAction('Master Admin', '0', 'Login Master', 'Acesso com usuário mestre Tusemm').catch(() => {});
    } else {
      setLoginError('Credenciais inválidas ou usuário inativo.');
    }
  };

  const handleCompleteSale = async (data: any) => {
    if (!currentUser && window.location.pathname !== '/reserva') return;
    try {
      const saleItems = data.items.map((i: any) => ({
        produto_id: i.produto_id,
        nome: i.nome || '',
        preco_unitario: Number(i.preco_unitario) || 0,
        quantidade: Number(i.quantidade) || 1,
        subtotal: Number(i.subtotal) || 0
      }));
      await db.createSale(data, saleItems, currentUser?.id || null);
    } catch (e: any) {
      alert("Erro ao registrar venda: " + (e.message || "Erro inesperado"));
      throw e;
    }
  };

  const onUpdateSettings = async (newSettings: AppSettings) => {
    if (!currentUser) return;
    setSettings(newSettings);
    try {
      await db.saveSettings(newSettings, currentUser.nome, currentUser.id);
    } catch (e) {
      console.error("Failed to update settings:", e);
    }
  };

  const handleSaveCustomer = async (data: { nome: string; telefone: string }) => {
    await db.saveOrUpdateCustomer(data, currentUser?.nome, currentUser?.id);
  };

  const handleDeleteCustomer = async (customerId: string, customerName: string) => {
    await db.deleteCustomer(customerId, customerName, currentUser?.nome, currentUser?.id);
  };

  const isReservaRoute = window.location.pathname === '/reserva';

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

  if (isReservaRoute) {
    return <ReservaView products={products} settings={settings} onReserve={handleCompleteSale} />;
  }

  if (!currentUser) return (
    <div className="min-h-screen bg-[#0a0510] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="w-full max-w-sm bg-white rounded-[48px] p-12 shadow-[0_25px_100px_rgba(0,0,0,0.5)] z-10 animate-in zoom-in-95 duration-500">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-purple-950 text-white rounded-[32px] flex items-center justify-center text-4xl font-black mx-auto mb-6 shadow-2xl rotate-3">M</div>
          <h1 className="text-3xl font-black text-purple-950 uppercase tracking-tight leading-none">Cantina <br/>TUSEMM</h1>
          <p className="text-[9px] text-gray-400 font-black uppercase mt-3 tracking-[0.2em]">Gestão Profissional</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-5">
          {inactivityNotice && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-2xl text-xs font-bold text-center leading-snug animate-in fade-in">
              ⏰ Sua sessão foi encerrada após 10 minutos sem uso. Faça login para continuar.
            </div>
          )}
          {loginError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-xs font-bold text-center leading-snug animate-in fade-in">
              ⚠️ {loginError}
            </div>
          )}
          <input 
            type="text" 
            placeholder="Usuário" 
            className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-100 rounded-3xl px-8 py-5 font-bold outline-none text-purple-950" 
            value={loginData.user} 
            onChange={e => {
              setLoginError(null);
              setLoginData({...loginData, user: e.target.value});
            }} 
          />
          <input 
            type="password" 
            placeholder="Senha" 
            className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-100 rounded-3xl px-8 py-5 font-bold outline-none text-purple-950" 
            value={loginData.pass} 
            onChange={e => {
              setLoginError(null);
              setLoginData({...loginData, pass: e.target.value});
            }} 
          />
          <button type="submit" className="w-full bg-purple-950 text-white py-6 rounded-3xl font-black uppercase tracking-[0.1em] shadow-2xl active:scale-95 transition-all mt-6 text-sm">Entrar</button>
        </form>
      </div>
    </div>
  );

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab} 
      onLogout={() => handleLogout(false)} 
      settings={settings} 
      currentUser={currentUser} 
      dbStatus={dbStatus}
      lastSyncAt={lastSync}
    >
      {activeTab === 'home' && <DashboardView sales={sales} products={products} setActiveTab={setActiveTab} />}
      {activeTab === 'venda' && (
        <SalesView 
          products={products} 
          settings={settings} 
          fiados={fiados}
          customers={customers}
          onCompleteSale={handleCompleteSale} 
        />
      )}
      {activeTab === 'fiado' && (
        <FiadoView 
          fiados={fiados} 
          products={products}
          settings={settings} 
          onPayDebt={(pid, m) => db.payFiado(pid, m, currentUser?.nome, currentUser?.id)} 
          onUpdateFiadoCustomer={async (saleIds, nome, telefone) => {
            await db.updateFiadoCustomer(saleIds, nome, telefone, currentUser?.nome, currentUser?.id);
          }}
          onAddFiadoSale={handleCompleteSale}
          onNavigateToPDV={() => setActiveTab('venda')}
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
          onUpdateProduct={(p) => db.saveProduct(p, currentUser.nome, currentUser.id)} 
          onAddProduct={(p) => db.saveProduct(p, currentUser.nome, currentUser.id)} 
          onDeleteProduct={(id, name) => db.deleteProduct(id, name, currentUser.nome, currentUser.id)}
          currentUser={currentUser} 
        />
      )}
      {activeTab === 'relatorios' && <ReportsView sales={sales} users={users} />}
      {activeTab === 'kds' && <KdsView sales={sales} onUpdateSale={async (id, data) => await db.updateSale(id, data)} currentUser={currentUser} />}
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
        />
      )}
    </Layout>
  );
};

export default App;
