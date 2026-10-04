
import React, { useState, useEffect, useCallback } from 'react';
import { Product, Sale, PaymentMethod, User, AppSettings, UserRole } from './types';
import { db } from './services/firebaseService';
import firebaseConfig from './firebase-applet-config.json';
import Layout from './components/Layout';
import DashboardView from './components/DashboardView';
import SalesView from './components/SalesView';
import InventoryView from './components/InventoryView';
import FiadoView from './components/FiadoView';
import ReportsView from './components/ReportsView';
import SettingsView from './components/SettingsView';
import LogView from './components/LogView';
import { AuditLog } from './types';
import ReservaView from './components/ReservaView';
import KdsView from './components/KdsView';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('home');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [fiados, setFiados] = useState<Sale[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ cantinaName: 'TUSEMM - Maria Mulambo' });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<'healthy' | 'warning' | 'error' | 'syncing'>('healthy');
  const [lastSync, setLastSync] = useState(new Date());
  const [loginData, setLoginData] = useState({ user: '', pass: '' });

  useEffect(() => {
    // Timeout para evitar carregamento infinito
    const timer = setTimeout(() => {
      if (isLoading && !loadError) {
        setIsLoading(false);
        setLoadError("O banco de dados demorou mais de 15 segundos para responder. Clique abaixo para tentar entrar mesmo assim ou verifique sua internet.");
      }
    }, 15000); 

    return () => clearTimeout(timer);
  }, [isLoading, loadError]);

  useEffect(() => {
    setIsLoading(true);
    let unsubProducts: any;
    let unsubSales: any;
    let unsubUsers: any;
    let unsubSettings: any;
    let unsubLogs: any;

    const handleError = (err: any) => {
      console.error("Firebase Sync Error:", err);
      setDbStatus('error');
      
      const errorMsg = err.code || err.message || "Erro desconhecido";
      
      if (err.code === 'permission-denied') {
        setLoadError(`Acesso negado ao Firebase (Permission Denied). Tente logar como tusemmaxe para liberar.`);
      } else {
        setLoadError(`Erro de Sincronização: ${errorMsg}`);
      }
      setIsLoading(false);
    };

    const initFirebaseListeners = async () => {
      try {
        await db.ensureAuthReady(); // Aguarda a autenticação (anônima ou logado) terminar
        
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
        unsubUsers = db.subscribeToUsers((u) => { setUsers(u); setLastSync(new Date()); }, handleError);
        unsubSettings = db.subscribeToSettings((set) => { 
          setSettings(set); 
          setLastSync(new Date()); 
          setIsLoading(false); // Só remove o loading quando as configurações chegam
        }, handleError);

        // Somente donos veem logs
        if (currentUser && (currentUser.perfil === UserRole.ADMIN || currentUser.id === 'super-admin')) {
          unsubLogs = (db as any).subscribeToLogs((l: AuditLog[]) => setLogs(l), (err: any) => console.error("Logs error:", err));
        }

        setDbStatus('healthy');
      } catch (e: any) {
        console.error(e);
        setDbStatus('error');
        setLoadError(e.message);
        setIsLoading(false);
      }
    };

    initFirebaseListeners();

    return () => {
      unsubProducts && unsubProducts();
      unsubSales && unsubSales();
      unsubUsers && unsubUsers();
      unsubSettings && unsubSettings();
      unsubLogs && unsubLogs();
    };
  }, [currentUser]); // Re-run if user changes to subscribe to logs if needed

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const userLower = loginData.user.trim().toLowerCase();

    // Tenta primeiro o login como Super Admin (E-mail Real no Firebase)
    if (userLower === 'tusemmaxe@gmail.com' || userLower === 'tusemmaxe') {
      try {
        await db.loginAsSuperAdmin('tusemmaxe@gmail.com', loginData.pass);
        setCurrentUser({ id: 'super-admin', nome: 'Dono TUSEMM', usuario: 'tusemmaxe', perfil: UserRole.ADMIN, ativo: true });
        return;
      } catch (e: any) {
        alert(e.message);
        return;
      }
    }

    // Se não for o dono, tenta o login master antigo ou usuários comuns
    const foundUser = users.find(u => u.usuario === loginData.user && u.ativo);
    
    if (foundUser && foundUser.senha === loginData.pass) {
      setCurrentUser(foundUser);
      if (foundUser.perfil === UserRole.KDS) {
        setActiveTab('kds');
      }
    } else if (loginData.user === 'Tusemm' && loginData.pass === 'Tusemm@7') {
      setCurrentUser({ id: '0', nome: 'Master Admin', usuario: 'Tusemm', perfil: UserRole.ADMIN, ativo: true });
    } else {
      alert('Credenciais inválidas ou usuário inativo.');
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

  if (loadError && !currentUser && !isReservaRoute) return (
    <div className="min-h-screen bg-red-950 flex flex-col items-center justify-center text-white p-8 text-center">
      <i className="fa-solid fa-triangle-exclamation text-6xl mb-6 text-red-400"></i>
      <h1 className="text-2xl font-black uppercase mb-4">Erro de Conexão</h1>
      <p className="text-sm opacity-80 mb-2 max-w-xs">{loadError}</p>
      <p className="text-[10px] opacity-40 mb-8 font-mono">Projeto: {firebaseConfig.projectId}</p>
      <div className="space-y-4 w-full max-w-xs">
        <button 
          onClick={() => { setLoadError(null); setIsLoading(true); window.location.reload(); }}
          className="w-full bg-white text-red-950 py-4 rounded-3xl font-black uppercase text-xs"
        >
          Tentar Reconectar
        </button>
        <button 
          onClick={() => { 
            setLoadError(null); 
            setIsLoading(false); 
            // Força o status como healthy se o usuário decidir ignorar para tentar logar
            setDbStatus('warning');
          }}
          className="w-full bg-red-800 text-white py-4 rounded-3xl font-black uppercase text-xs opacity-50"
        >
          Ignorar e Ir para Login
        </button>
      </div>
      <p className="text-[8px] uppercase font-black opacity-30 mt-10 tracking-widest">Verifique se o Login Anônimo está ativo no Console do Firebase</p>
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
          <input 
            type="text" 
            placeholder="Usuário" 
            className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-100 rounded-3xl px-8 py-5 font-bold outline-none text-purple-950" 
            value={loginData.user} 
            onChange={e => setLoginData({...loginData, user: e.target.value})} 
          />
          <input 
            type="password" 
            placeholder="Senha" 
            className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-100 rounded-3xl px-8 py-5 font-bold outline-none text-purple-950" 
            value={loginData.pass} 
            onChange={e => setLoginData({...loginData, pass: e.target.value})} 
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
      onLogout={async () => {
        await db.logout();
        setCurrentUser(null);
      }} 
      settings={settings} 
      currentUser={currentUser} 
      dbStatus={dbStatus}
      lastSyncAt={lastSync}
    >
      {activeTab === 'home' && <DashboardView sales={sales} products={products} setActiveTab={setActiveTab} />}
      {activeTab === 'venda' && <SalesView products={products} settings={settings} onCompleteSale={handleCompleteSale} />}
      {activeTab === 'fiado' && <FiadoView fiados={fiados} settings={settings} onPayDebt={(pid, m) => db.payFiado(pid, m)} />}
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
        />
      )}
    </Layout>
  );
};

export default App;
