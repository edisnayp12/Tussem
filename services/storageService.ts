import { Product, Sale, StockMovement, User, AppSettings } from '../types';
import { safeStorage } from '../utils/safeStorage';
import { downloadBlobFile, getLocalDateString } from '../utils/browserUtils';

const STORAGE_KEYS = {
  PRODUCTS: 'tusemm_products',
  SALES: 'tusemm_sales',
  STOCK_HISTORY: 'tusemm_stock_history',
  USERS: 'tusemm_users',
  SETTINGS: 'tusemm_settings'
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const storageService = {
  getProducts: (): Product[] => {
    return safeParseJson<Product[]>(safeStorage.getItem(STORAGE_KEYS.PRODUCTS), []);
  },
  saveProducts: (products: Product[]) => {
    safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  },
  getSales: (): Sale[] => {
    return safeParseJson<Sale[]>(safeStorage.getItem(STORAGE_KEYS.SALES), []);
  },
  saveSales: (sales: Sale[]) => {
    safeStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
  },
  getStockHistory: (): StockMovement[] => {
    return safeParseJson<StockMovement[]>(safeStorage.getItem(STORAGE_KEYS.STOCK_HISTORY), []);
  },
  saveStockHistory: (history: StockMovement[]) => {
    safeStorage.setItem(STORAGE_KEYS.STOCK_HISTORY, JSON.stringify(history));
  },
  getUsers: (): User[] => {
    return safeParseJson<User[]>(safeStorage.getItem(STORAGE_KEYS.USERS), []);
  },
  saveUsers: (users: User[]) => {
    safeStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  },
  getSettings: (): AppSettings => {
    return safeParseJson<AppSettings>(safeStorage.getItem(STORAGE_KEYS.SETTINGS), { cantinaName: 'TUSEMM' });
  },
  saveSettings: (settings: AppSettings) => {
    safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
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
    downloadBlobFile(
      JSON.stringify(backup, null, 2),
      `backup_cantina_${getLocalDateString()}.json`,
      'application/json;charset=utf-8;'
    );
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
      console.error('Erro ao importar backup:', e);
      return false;
    }
  },

  clearAll: () => {
    Object.values(STORAGE_KEYS).forEach((key) => safeStorage.removeItem(key));
  }
};
