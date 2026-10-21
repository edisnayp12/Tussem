
import React from 'react';
import { AppSettings, UserRole, User } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  settings: AppSettings;
  currentUser: User | null;
  dbStatus?: 'healthy' | 'warning' | 'error' | 'syncing';
  lastSyncAt?: Date;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  activeTab, 
  setActiveTab, 
  onLogout, 
  settings, 
  currentUser, 
  dbStatus = 'healthy',
  lastSyncAt = new Date()
}) => {
  const isAdmin = currentUser?.perfil === UserRole.ADMIN || currentUser?.usuario === 'Tusemm';

  const menuItems = [
    { id: 'home', icon: 'fa-house', label: 'Início', minRole: UserRole.COMMON },
    { id: 'venda', icon: 'fa-shopping-cart', label: 'Venda', minRole: UserRole.COMMON },
    { id: 'fiado', icon: 'fa-user-clock', label: 'Fiados', minRole: UserRole.COMMON },
    { id: 'clientes', icon: 'fa-users', label: 'Clientes', minRole: UserRole.ADMIN },
    { id: 'kds', icon: 'fa-bell-concierge', label: 'KDS', minRole: UserRole.KDS },
    { id: 'estoque', icon: 'fa-boxes-stacked', label: 'Estoque', minRole: UserRole.ADMIN },
    { id: 'relatorios', icon: 'fa-chart-line', label: 'Relatórios', minRole: UserRole.ADMIN },
    { id: 'logs', icon: 'fa-clipboard-list', label: 'Logs', minRole: UserRole.ADMIN },
    { id: 'config', icon: 'fa-gear', label: 'Config', minRole: UserRole.ADMIN },
  ].filter(item => {
    if (isAdmin) return true;
    if (currentUser?.perfil === UserRole.KDS) {
      return item.id === 'kds';
    }
    return item.minRole === UserRole.COMMON || (item.minRole === UserRole.KDS && currentUser?.perfil === UserRole.KDS);
  });

  const cantinaInitial = (settings.cantinaName || 'C')[0].toUpperCase();

  const statusColors = {
    healthy: 'bg-green-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    syncing: 'bg-blue-400'
  };

  const statusLabels = {
    healthy: 'Online',
    warning: 'Atenção',
    error: 'Offline',
    syncing: 'Sync'
  };

  const formattedSync = lastSyncAt.toLocaleTimeString('pt-BR', { 
    hour: '2-digit', 
    minute: '2-digit'
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 select-none">
      <header className="bg-purple-900 text-white shadow-xl p-4 flex justify-between items-center sticky top-0 z-50 print:hidden pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-purple-900 font-black text-xl shadow-inner rotate-3">
            {cantinaInitial}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black leading-tight tracking-tight uppercase">{settings.cantinaName}</h1>
              <div className="flex items-center gap-1 bg-black/20 px-2 py-0.5 rounded-full">
                <span className={`w-1 h-1 rounded-full ${statusColors[dbStatus]} animate-pulse`}></span>
                <span className="text-[7px] font-black uppercase opacity-60">{statusLabels[dbStatus]}</span>
              </div>
            </div>
            <p className="text-[8px] opacity-40 uppercase font-black tracking-widest">Sinc: {formattedSync} • {currentUser?.usuario}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:block">
            <PWAInstallButton />
          </div>
          <button 
            onClick={onLogout}
            className="bg-red-500/10 hover:bg-red-500 text-white w-10 h-10 flex items-center justify-center rounded-xl transition-all border border-white/5 active:scale-90"
          >
            <i className="fa-solid fa-power-off text-sm"></i>
          </button>
        </div>
      </header>

      {/* Mobile Install Prompt (only shows if needed on mobile) */}
      <div className="md:hidden block w-full p-4 empty:hidden bg-white border-b border-gray-100 flex justify-center sticky top-[72px] z-40 shadow-sm">
        <PWAInstallButton />
      </div>

      <main className="flex-1 p-4 pb-28 md:pb-6 max-w-5xl mx-auto w-full md:pl-28">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-2xl border-t border-gray-100 flex justify-around items-center p-2 pb-[max(0.7rem,env(safe-area-inset-bottom))] z-50 shadow-[0_-5px_25px_rgba(0,0,0,0.1)] md:hidden">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center flex-1 py-2 rounded-2xl transition-all active:scale-90 ${
              activeTab === item.id 
                ? 'text-purple-700 bg-purple-50' 
                : 'text-gray-400'
            }`}
          >
            <i className={`fa-solid ${item.icon} text-lg mb-1`}></i>
            <span className="text-[8px] font-black uppercase tracking-widest">{item.label}</span>
          </button>
        ))}
      </nav>

      <nav className="hidden md:flex fixed left-6 top-28 bottom-8 w-20 bg-white/90 backdrop-blur-md rounded-[32px] shadow-2xl flex-col items-center py-10 gap-8 border border-gray-100">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all relative group active:scale-90 ${
              activeTab === item.id 
                ? 'bg-purple-700 text-white shadow-lg' 
                : 'text-gray-300 hover:text-purple-600 hover:bg-purple-50'
            }`}
          >
            <i className={`fa-solid ${item.icon} text-xl`}></i>
            <span className="absolute left-16 bg-gray-900 text-white text-[9px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap font-black uppercase">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Layout;
