
import React, { useState, useEffect } from 'react';
import { User, AppSettings, UserRole } from '../types';
import { db } from '../services/firebaseService';
import { storageService } from '../services/storageService';

import { safeStorage } from '../utils/safeStorage';

interface SettingsViewProps {
  users: User[];
  currentUser: User | null;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddUser: (user: any) => void;
  onRemoveUser: (userId: string) => void;
  onViewLogs: () => void;
  onViewCustomers?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ users, currentUser, settings, onUpdateSettings, onAddUser, onRemoveUser, onViewLogs, onViewCustomers }) => {
  const [dbHealth, setDbHealth] = useState<any>({});
  const [appSettings, setAppSettings] = useState(settings);
  const [themeNotice, setThemeNotice] = useState<string | null>(null);

  useEffect(() => {
    setAppSettings(settings);
  }, [settings]);

  const activeTheme = appSettings.tema || (safeStorage.getItem('cantina_theme') as 'light' | 'dark') || 'light';

  const handleSelectTheme = (newTheme: 'light' | 'dark') => {
    const updated = { ...appSettings, tema: newTheme };
    setAppSettings(updated);
    try {
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {}
    safeStorage.setItem('cantina_theme', newTheme);
    onUpdateSettings(updated);
    setThemeNotice(newTheme === 'dark' ? 'Tema Escuro (TUSEMM Noite) ativado com sucesso!' : 'Tema Claro ativado com sucesso!');
    setTimeout(() => setThemeNotice(null), 3000);
  };
  
  useEffect(() => {
    refreshHealth();
  }, []);

  const refreshHealth = () => {
    db.checkHealth().then(r => setDbHealth(r.details));
  };

  const handleExport = () => {
    storageService.exportBackup();
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const success = storageService.importBackup(event.target?.result as string);
        if (success) {
          alert('Backup importado com sucesso! O aplicativo será recarregado.');
          window.location.reload();
        } else {
          alert('Erro ao importar backup. Arquivo inválido.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ nome: '', usuario: '', senha: '', perfil: UserRole.COMMON });

  const handleAddUser = () => {
    if (!newUser.nome || !newUser.usuario || !newUser.senha) return alert("Preencha todos os campos!");
    onAddUser({ ...newUser, ativo: true });
    setIsAddingUser(false);
    setNewUser({ nome: '', usuario: '', senha: '', perfil: UserRole.COMMON });
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black text-purple-950 uppercase tracking-tighter">Ajustes</h2>
          <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Configurações de Sistema</p>
        </div>
        <button onClick={refreshHealth} className="bg-purple-100 text-purple-600 p-3 rounded-xl hover:bg-purple-200">
          <i className="fa-solid fa-rotate"></i>
        </button>
      </div>

      {/* Seletor de Tema (Aparência) */}
      <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
          <div>
            <h3 className="text-sm font-black text-purple-900 uppercase flex items-center gap-2">
              <i className="fa-solid fa-palette text-purple-600"></i> Aparência e Tema
            </h3>
            <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">
              Alterne as cores visuais mantendo a identidade da Cantina TUSEMM
            </p>
          </div>
          <span className="self-start sm:self-auto text-[9px] font-black px-3 py-1.5 rounded-full uppercase bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border border-purple-200 dark:border-purple-800">
            {activeTheme === 'dark' ? '🌙 Modo Noite Ativo' : '☀️ Modo Dia Ativo'}
          </span>
        </div>

        {themeNotice && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-950/60 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <i className="fa-solid fa-circle-check text-green-600 dark:text-green-400"></i>
            {themeNotice}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Opção Claro */}
          <button
            type="button"
            onClick={() => handleSelectTheme('light')}
            className={`flex flex-col p-5 rounded-2xl border-2 text-left transition-all relative overflow-hidden active:scale-98 ${
              activeTheme === 'light'
                ? 'border-purple-600 bg-purple-50/50 shadow-md ring-2 ring-purple-400/20'
                : 'border-gray-200 hover:border-purple-300 bg-gray-50'
            }`}
          >
            {activeTheme === 'light' && (
              <span className="absolute top-3 right-3 text-purple-700 bg-purple-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-black shadow-sm">
                <i className="fa-solid fa-check"></i>
              </span>
            )}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-amber-500 text-lg shadow-sm">
                <i className="fa-solid fa-sun"></i>
              </div>
              <div>
                <span className="text-xs font-black uppercase text-gray-900 block">Tema Claro</span>
                <span className="text-[9px] text-gray-500 font-bold uppercase">Padrão Luminoso</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-600 leading-snug">
              Fundo claro suave, cards brancos nítidos e a clássica identidade roxa da Cantina TUSEMM.
            </p>
            <div className="mt-4 flex gap-1.5 items-center p-2 rounded-xl bg-white border border-gray-200">
              <div className="w-4 h-4 rounded-full bg-purple-900" title="Roxo TUSEMM"></div>
              <div className="w-4 h-4 rounded-full bg-amber-400" title="Dourado"></div>
              <div className="w-4 h-4 rounded-full bg-emerald-500" title="Verde"></div>
              <div className="w-4 h-4 rounded-full bg-gray-100 border border-gray-300"></div>
              <span className="text-[8px] font-black text-gray-500 uppercase ml-auto">Paleta Dia</span>
            </div>
          </button>

          {/* Opção Escuro */}
          <button
            type="button"
            onClick={() => handleSelectTheme('dark')}
            className={`flex flex-col p-5 rounded-2xl border-2 text-left transition-all relative overflow-hidden active:scale-98 ${
              activeTheme === 'dark'
                ? 'border-purple-500 bg-[#1c1236] shadow-md ring-2 ring-purple-500/30'
                : 'border-gray-200 hover:border-purple-400 bg-gray-50'
            }`}
          >
            {activeTheme === 'dark' && (
              <span className="absolute top-3 right-3 text-white bg-purple-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-black shadow-md">
                <i className="fa-solid fa-check"></i>
              </span>
            )}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[#0e081c] border border-purple-800/60 flex items-center justify-center text-purple-300 text-lg shadow-sm">
                <i className="fa-solid fa-moon"></i>
              </div>
              <div>
                <span className="text-xs font-black uppercase text-purple-950 dark:text-purple-100 block">Tema Escuro</span>
                <span className="text-[9px] text-purple-600 dark:text-purple-300 font-bold uppercase">TUSEMM Noite</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-purple-200/80 leading-snug">
              Fundo preto-violeta profundo, alto contraste e conforto visual sem perder o brilho da marca.
            </p>
            <div className="mt-4 flex gap-1.5 items-center p-2 rounded-xl bg-[#140c26] border border-purple-900/50">
              <div className="w-4 h-4 rounded-full bg-[#3b1275]" title="Roxo Meia-Noite"></div>
              <div className="w-4 h-4 rounded-full bg-amber-400" title="Dourado"></div>
              <div className="w-4 h-4 rounded-full bg-emerald-400" title="Verde"></div>
              <div className="w-4 h-4 rounded-full bg-[#0d081a] border border-purple-800"></div>
              <span className="text-[8px] font-black text-purple-300 uppercase ml-auto">Paleta Noite</span>
            </div>
          </button>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
        <h3 className="text-sm font-black text-purple-900 uppercase mb-6">Configurações Gerais</h3>
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">Nome da Cantina</label>
            <input 
              type="text" 
              className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold text-gray-700"
              value={appSettings.cantinaName || ''}
              onChange={e => setAppSettings({...appSettings, cantinaName: e.target.value})}
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">Modo de Operação PIX</label>
            <select 
              className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold text-gray-700"
              value={appSettings.pixModo || 'mercadopago'} 
              onChange={(e: any) => setAppSettings({...appSettings, pixModo: e.target.value})}
            >
              <option value="mercadopago">Automático (Mercado Pago)</option>
              <option value="manual">Manual (Chave Fixa + QR Code Dinâmico)</option>
            </select>
          </div>

          {(!appSettings.pixModo || appSettings.pixModo === 'mercadopago') && (
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">Mercado Pago - Access Token (Pix)</label>
              <input 
                type="password" 
                placeholder="APP_USR-..."
                className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold text-gray-700"
                value={appSettings.mercadoPagoToken || ''}
                onChange={e => setAppSettings({...appSettings, mercadoPagoToken: e.target.value})}
              />
            </div>
          )}

          {appSettings.pixModo === 'manual' && (
            <div className="space-y-3 bg-purple-50 p-4 rounded-3xl border border-purple-100">
              <div>
                 <label className="text-[10px] font-black text-purple-900 uppercase ml-2 mb-1 block">Chave PIX (CPF/CNPJ/Email/Telefone)</label>
                 <input type="text" placeholder="Ex: 123.456.789-00 ou email@pix.com" value={appSettings.pixChave || ''} onChange={e => setAppSettings({...appSettings, pixChave: e.target.value})} className="w-full bg-white border-none rounded-2xl px-5 py-4 font-bold text-gray-700 shadow-sm" />
              </div>
              <div>
                 <label className="text-[10px] font-black text-purple-900 uppercase ml-2 mb-1 block">Nome do Titular do PIX</label>
                 <input type="text" placeholder="João da Silva" value={appSettings.pixTitular || ''} onChange={e => setAppSettings({...appSettings, pixTitular: e.target.value})} className="w-full bg-white border-none rounded-2xl px-5 py-4 font-bold text-gray-700 shadow-sm" maxLength={25} />
              </div>
              <div>
                 <label className="text-[10px] font-black text-purple-900 uppercase ml-2 mb-1 block">Cidade</label>
                 <input type="text" placeholder="São Paulo" value={appSettings.pixCidade || ''} onChange={e => setAppSettings({...appSettings, pixCidade: e.target.value})} className="w-full bg-white border-none rounded-2xl px-5 py-4 font-bold text-gray-700 shadow-sm" maxLength={15} />
              </div>
            </div>
          )}

          <button 
            onClick={() => onUpdateSettings(appSettings)}
            className="w-full bg-purple-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:bg-black transition-all"
          >
            Salvar Configurações
          </button>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
        <h3 className="text-sm font-black text-purple-900 mb-6 uppercase">Saúde do Banco Local</h3>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(dbHealth).map(([table, ok]) => (
            <div key={table} className={`p-4 rounded-2xl border flex items-center justify-between ${ok ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
              <span className="text-[10px] font-black uppercase text-gray-500">{table}</span>
              <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}></span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button onClick={handleExport} className="w-full bg-purple-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:bg-black transition-all">Exportar Backup</button>
          <button onClick={handleImport} className="w-full bg-gray-200 text-purple-950 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:bg-gray-300 transition-all">Importar Backup</button>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button onClick={onViewCustomers} className="w-full bg-purple-50 text-purple-900 py-4 rounded-2xl font-black text-[10px] uppercase border border-purple-100 hover:bg-purple-100 transition-all flex items-center justify-center gap-2">
            <i className="fa-solid fa-users"></i> Base de Clientes
          </button>
          <button onClick={onViewLogs} className="w-full bg-purple-50 text-purple-900 py-4 rounded-2xl font-black text-[10px] uppercase border border-purple-100 hover:bg-purple-100 transition-all flex items-center justify-center gap-2">
            <i className="fa-solid fa-clipboard-list"></i> Logs do Sistema
          </button>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-black text-purple-900 uppercase">Usuários</h3>
          <button 
            onClick={() => setIsAddingUser(true)}
            className="bg-purple-900 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-md"
          >
            Novo Usuário
          </button>
        </div>
        <div className="space-y-3">
          {users.map(u => (
            <div key={u.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl">
              <div>
                <span className="font-black text-purple-950 text-sm uppercase">{u.usuario}</span>
                <span className="ml-2 text-[8px] font-black bg-purple-200 text-purple-700 px-2 py-0.5 rounded-full uppercase">{u.perfil}</span>
              </div>
              {u.usuario !== 'Tusemm' && (
                <button 
                  onClick={() => onRemoveUser(u.id)}
                  className="text-red-500 hover:text-red-700 p-2"
                >
                  <i className="fa-solid fa-trash-can text-xs"></i>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {isAddingUser && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-black text-purple-950 uppercase mb-6">Novo Usuário</h3>
            <div className="space-y-4">
              <input type="text" placeholder="Nome Completo" className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold" value={newUser.nome} onChange={e => setNewUser({...newUser, nome: e.target.value})} />
              <input type="text" placeholder="Usuário (Login)" className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold" value={newUser.usuario} onChange={e => setNewUser({...newUser, usuario: e.target.value})} />
              <input type="password" placeholder="Senha" className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold" value={newUser.senha} onChange={e => setNewUser({...newUser, senha: e.target.value})} />
              <select className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs" value={newUser.perfil} onChange={e => setNewUser({...newUser, perfil: e.target.value as UserRole})}>
                <option value={UserRole.COMMON}>Comum (Vendedor)</option>
                <option value={UserRole.ADMIN}>Administrador</option>
                <option value={UserRole.KDS}>KDS (Cozinha/Entrega)</option>
              </select>
              <button 
                onClick={handleAddUser} 
                className="w-full bg-purple-900 text-white py-5 rounded-2xl font-black uppercase shadow-xl hover:bg-black transition-all"
              >
                Criar Usuário
              </button>
              <button 
                onClick={() => setIsAddingUser(false)} 
                className="w-full text-[10px] font-bold text-gray-400 uppercase mt-2"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Rodapé de Versão */}
      <div className="pt-8 pb-4 text-center">
        <p className="text-[8px] font-black text-gray-300 uppercase tracking-[0.4em]">TUSEMM Sistema v2.0.1 • Online Sync</p>
      </div>
    </div>
  );
};

export default SettingsView;
