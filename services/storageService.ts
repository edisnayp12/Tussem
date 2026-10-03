
import { Product, Sale, StockMovement, User, AppSettings } from '../types';

const STORAGE_KEYS = {
  PRODUCTS: 'tusemm_products',
  SALES: 'tusemm_sales',
  STOCK_HISTORY: 'tusemm_stock_history',
  USERS: 'tusemm_users',
  SETTINGS: 'tusemm_settings',
};

export const storageService = {
  getProducts: (): Product[] => {
    const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    return data ? JSON.parse(data) : [];
  },
  saveProducts: (products: Product[]) => {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  },
  getSales: (): Sale[] => {
    const data = localStorage.getItem(STORAGE_KEYS.SALES);
    return data ? JSON.parse(data) : [];
  },
  saveSales: (sales: Sale[]) => {
    localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
  },
  // Fix: Module '"../types"' has no exported member 'StockHistory'. Using StockMovement instead.
  getStockHistory: (): StockMovement[] => {
    const data = localStorage.getItem(STORAGE_KEYS.STOCK_HISTORY);
    return data ? JSON.parse(data) : [];
  },
  saveStockHistory: (history: StockMovement[]) => {
    localStorage.setItem(STORAGE_KEYS.STOCK_HISTORY, JSON.stringify(history));
  },
  
  // Usuários
  getUsers: (): User[] => {
    const data = localStorage.getItem(STORAGE_KEYS.USERS);
    return data ? JSON.parse(data) : [];
  },
  saveUsers: (users: User[]) => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  },

  // Configurações
  getSettings: (): AppSettings => {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return data ? JSON.parse(data) : { cantinaName: 'TUSEMM' };
  },
  saveSettings: (settings: AppSettings) => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },
  
  exportBackup: () => {
    const backup = {
      products: storageService.getProducts(),
      sales: storageService.getSales(),
      history: storageService.getStockHistory(),
      users: storageService.getUsers(),
      settings: storageService.getSettings(),
      version: '1.1',
      date: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_cantina_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  },

  importBackup: (jsonData: string): boolean => {
    try {
      const backup = JSON.parse(jsonData);
      if (backup.products && backup.sales) {
        storageService.saveProducts(backup.products);
        storageService.saveSales(backup.sales);
        if (backup.history) storageService.saveStockHistory(backup.history);
        if (backup.users) storageService.saveUsers(backup.users);
        if (backup.settings) storageService.saveSettings(backup.settings);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Erro ao importar backup:", e);
      return false;
    }
  },

  clearAll: () => {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  }
};
