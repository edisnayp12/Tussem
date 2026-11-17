import { Product, Sale, SaleItem, StockMovement, User, AppSettings, CashShift, CashOutflow } from '../types';
import { INITIAL_PRODUCTS } from '../constants';
import { safeStorage } from '../utils/safeStorage';
import { downloadBlobFile, getLocalDateString } from '../utils/browserUtils';

const STORAGE_KEYS = {
  PRODUCTS: 'tusemm_products',
  SALES: 'tusemm_sales',
  STOCK_HISTORY: 'tusemm_stock_history',
  USERS: 'tusemm_users',
  SETTINGS: 'tusemm_settings',
  CASH_SHIFTS: 'tusemm_cash_shifts',
  CASH_OUTFLOWS: 'tusemm_cash_outflows',
  DEMO_SEEDED: 'tusemm_demo_seeded_v1'
};

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function cloneInitialProducts(): Product[] {
  const nowIso = new Date().toISOString();
  return INITIAL_PRODUCTS.map((p) => ({
    ...p,
    created_at: p.created_at || nowIso
  }));
}

export const storageService = {
  initializeDemoDataIfNeeded: (): { products: Product[]; sales: Sale[] } => {
    const alreadySeeded = safeStorage.getItem(STORAGE_KEYS.DEMO_SEEDED) === '1';
    const existingProducts = safeParseJson<Product[]>(safeStorage.getItem(STORAGE_KEYS.PRODUCTS), []);
    const existingSales = safeParseJson<Sale[]>(safeStorage.getItem(STORAGE_KEYS.SALES), []);

    if (!alreadySeeded && existingProducts.length === 0) {
      const seededProducts = cloneInitialProducts();
      safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(seededProducts));
      if (!safeStorage.getItem(STORAGE_KEYS.SALES)) {
        safeStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify([]));
      }
      safeStorage.setItem(STORAGE_KEYS.DEMO_SEEDED, '1');
      return { products: seededProducts, sales: existingSales };
    }

    if (!alreadySeeded) {
      safeStorage.setItem(STORAGE_KEYS.DEMO_SEEDED, '1');
    }

    return {
      products: existingProducts.length > 0 ? existingProducts : cloneInitialProducts(),
      sales: existingSales
    };
  },

  resetDemoData: (): { products: Product[]; sales: Sale[] } => {
    const freshProducts = cloneInitialProducts();
    safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(freshProducts));
    safeStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify([]));
    safeStorage.setItem(STORAGE_KEYS.STOCK_HISTORY, JSON.stringify([]));
    safeStorage.setItem(STORAGE_KEYS.DEMO_SEEDED, '1');
    return { products: freshProducts, sales: [] };
  },

  applySaleToLocal: (sale: Sale, items: SaleItem[]): { products: Product[]; sales: Sale[] } => {
    const currentProducts = storageService.getProducts();
    const baseProducts = currentProducts.length > 0 ? currentProducts : cloneInitialProducts();

    const updatedProducts = baseProducts.map((prod) => {
      const soldItem = items.find((it) => it.produto_id === prod.id);
      if (!soldItem) return prod;
      const nextStock = Math.max(0, (Number(prod.estoque) || 0) - (Number(soldItem.quantidade) || 1));
      return { ...prod, estoque: nextStock };
    });

    const currentSales = storageService.getSales();
    const updatedSales = [sale, ...currentSales.filter((s) => s.id !== sale.id)];

    storageService.saveProducts(updatedProducts);
    storageService.saveSales(updatedSales);
    safeStorage.setItem(STORAGE_KEYS.DEMO_SEEDED, '1');

    return { products: updatedProducts, sales: updatedSales };
  },

  getProducts: (): Product[] => {
    const list = safeParseJson<Product[]>(safeStorage.getItem(STORAGE_KEYS.PRODUCTS), []);
    if (list.length === 0 && safeStorage.getItem(STORAGE_KEYS.DEMO_SEEDED) !== '1') {
      return storageService.initializeDemoDataIfNeeded().products;
    }
    return list;
  },
  saveProducts: (products: Product[]) => {
    safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    safeStorage.setItem(STORAGE_KEYS.DEMO_SEEDED, '1');
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
    return safeParseJson<AppSettings>(safeStorage.getItem(STORAGE_KEYS.SETTINGS), { cantinaName: 'TUSEMM - Maria Mulambo' });
  },
  saveSettings: (settings: AppSettings) => {
    safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },
  getCashShifts: (): CashShift[] => {
    return safeParseJson<CashShift[]>(safeStorage.getItem(STORAGE_KEYS.CASH_SHIFTS), []);
  },
  saveCashShifts: (shifts: CashShift[]) => {
    safeStorage.setItem(STORAGE_KEYS.CASH_SHIFTS, JSON.stringify(shifts));
  },
  getCashOutflows: (): CashOutflow[] => {
    return safeParseJson<CashOutflow[]>(safeStorage.getItem(STORAGE_KEYS.CASH_OUTFLOWS), []);
  },
  saveCashOutflows: (outflows: CashOutflow[]) => {
    safeStorage.setItem(STORAGE_KEYS.CASH_OUTFLOWS, JSON.stringify(outflows));
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
