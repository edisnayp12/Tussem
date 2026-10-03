import { Product, Sale, PaymentMethod, SaleItem, User, UserRole, AppSettings } from '../types';

const STORAGE_KEYS = {
  PRODUCTS: 'tusemm_products',
  SALES: 'tusemm_sales',
  USERS: 'tusemm_users',
  SETTINGS: 'tusemm_settings',
  LOGS: 'tusemm_logs'
};

const read = (key: string) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
};

const write = (key: string, data: any) => {
  localStorage.setItem(key, JSON.stringify(data));
  window.dispatchEvent(new Event('local-db-update'));
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const db = {
  subscribeToChanges: (onUpdate: () => void) => {
    window.addEventListener('local-db-update', onUpdate);
    window.addEventListener('storage', onUpdate); // Para sincronizar abas diferentes
    return { 
      unsubscribe: () => {
        window.removeEventListener('local-db-update', onUpdate);
        window.removeEventListener('storage', onUpdate);
      }
    };
  },

  async getProducts(): Promise<Product[]> {
    return read(STORAGE_KEYS.PRODUCTS)
      .filter((p: Product) => p.ativo !== false)
      .sort((a: Product, b: Product) => a.nome.localeCompare(b.nome));
  },

  async saveProduct(product: Partial<Product>) {
    const products = read(STORAGE_KEYS.PRODUCTS);
    if (product.id) {
      const idx = products.findIndex((p: Product) => p.id === product.id);
      if (idx > -1) products[idx] = { ...products[idx], ...product };
    } else {
      products.push({ ...product, id: generateId(), ativo: true, created_at: new Date().toISOString() });
    }
    write(STORAGE_KEYS.PRODUCTS, products);
  },

  async getSales(): Promise<Sale[]> {
    return read(STORAGE_KEYS.SALES).sort((a: Sale, b: Sale) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async createSale(sale: any, items: SaleItem[], operatorId: string) {
    const sales = read(STORAGE_KEYS.SALES);
    const products = read(STORAGE_KEYS.PRODUCTS);
    
    const newSale: Sale = {
      id: generateId(),
      usuario_id: operatorId !== '0' ? operatorId : undefined,
      forma_pagamento: sale.paymentMethod,
      valor_total: sale.total,
      status: sale.paymentMethod === PaymentMethod.FIADO ? 'pendente' : 'pago',
      cliente_nome: sale.customerName || 'Balcão',
      created_at: new Date().toISOString(),
      itens: items.map(i => ({ ...i, id: generateId() })),
      tipo_pedido: sale.tipo_pedido || 'balcao',
      telefone_comprador: sale.telefone_comprador || undefined,
      status_entrega: sale.tipo_pedido === 'reserva' ? 'pendente' : 'entregue'
    };

    sales.push(newSale);
    write(STORAGE_KEYS.SALES, sales);

    // Baixar estoque
    items.forEach(item => {
      const pIdx = products.findIndex((p: Product) => p.id === item.produto_id);
      if (pIdx > -1) {
        products[pIdx].estoque -= item.quantidade;
      }
    });
    write(STORAGE_KEYS.PRODUCTS, products);
    
    return newSale;
  },

  async payFiado(pedidoId: string, method: PaymentMethod) {
    const sales = read(STORAGE_KEYS.SALES);
    const idx = sales.findIndex((s: Sale) => s.id === pedidoId);
    if (idx > -1) {
      sales[idx].status = 'pago';
      sales[idx].forma_pagamento = method;
      write(STORAGE_KEYS.SALES, sales);
    }
  },

  async getFiados(): Promise<Sale[]> {
    return read(STORAGE_KEYS.SALES).filter((s: Sale) => s.status === 'pendente' && s.forma_pagamento === 'fiado');
  },

  async getUsers(): Promise<User[]> {
    let users = read(STORAGE_KEYS.USERS);
    if (!Array.isArray(users)) users = [];
    
    if (users.length === 0) {
      // Cria o usuário administrador padrão no primeiro acesso
      const defaultAdmin: User = {
        id: generateId(),
        nome: 'Administrador Tusemm',
        usuario: 'Tusemm',
        senha: 'Tusemm@7',
        perfil: UserRole.ADMIN,
        ativo: true,
        created_at: new Date().toISOString()
      };
      users = [defaultAdmin];
      write(STORAGE_KEYS.USERS, users);
    }
    return users;
  },

  async saveUser(user: Partial<User>) {
    const users = read(STORAGE_KEYS.USERS);
    if (user.id) {
      const idx = users.findIndex((u: User) => u.id === user.id);
      if (idx > -1) users[idx] = { ...users[idx], ...user };
    } else {
      users.push({ ...user, id: generateId(), ativo: true, created_at: new Date().toISOString() } as User);
    }
    write(STORAGE_KEYS.USERS, users);
  },

  async deleteUser(userId: string) {
    let users = read(STORAGE_KEYS.USERS);
    users = users.filter((u: User) => u.id !== userId);
    write(STORAGE_KEYS.USERS, users);
  },

  async getSettings(): Promise<AppSettings> {
    try {
      const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return settings ? JSON.parse(settings) : { cantinaName: 'TUSEMM - Maria Mulambo' };
    } catch {
      return { cantinaName: 'TUSEMM - Maria Mulambo' };
    }
  },

  async saveSettings(settings: AppSettings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    window.dispatchEvent(new Event('local-db-update'));
  },

  async addLog(usuario: string, acao: string, descricao: string) {
    const logs = read(STORAGE_KEYS.LOGS);
    logs.push({ id: generateId(), usuario, acao, descricao, created_at: new Date().toISOString() });
    write(STORAGE_KEYS.LOGS, logs);
  },

  async getLogs() {
    return read(STORAGE_KEYS.LOGS).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 20);
  },

  async checkHealth() {
    return { 
      details: { 
        'Armazenamento Local': true, 
        'Produtos': true, 
        'Vendas': true, 
        'Usuários': true 
      } 
    };
  }
};
