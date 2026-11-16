import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  increment,
  limit
} from 'firebase/firestore';

import firebaseConfig from '../firebase-applet-config.json';
import { Product, Sale, PaymentMethod, SaleItem, User, AppSettings, Customer, CashShift, CashMovement } from '../types';
import { normalizePhone, formatPhone } from '../utils/phoneUtils';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const targetDbId = (firebaseConfig as any).firestoreDatabaseId || '(default)';

// Inicialização com fallback seguro para Safari Privado, Firefox Estrito e Iframes sem IndexedDB
let dbInstance: any;
try {
  dbInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true
    },
    targetDbId
  );
} catch (e) {
  try {
    dbInstance = initializeFirestore(
      app,
      {
        localCache: memoryLocalCache(),
        ignoreUndefinedProperties: true
      },
      targetDbId
    );
  } catch (err) {
    try {
      dbInstance = getFirestore(app, targetDbId);
    } catch {
      dbInstance = getFirestore(app);
    }
  }
}

export { dbInstance };

// Teste inicial de conectividade com o servidor Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(dbInstance, 'settings', 'global'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[Firebase] Modo offline detectado durante verificação inicial.');
    }
  }
}
testConnection();

let authReadyPromise: Promise<void> | null = null;
const ensureAuthReady = (): Promise<void> => {
  if (auth.currentUser) return Promise.resolve();
  if (authReadyPromise) return authReadyPromise;

  authReadyPromise = new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      console.warn('Auth check timed out, resolving anyway to allow app flow.');
      finish();
    }, 12000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        clearTimeout(timeout);
        unsubscribe();
        finish();
      } else {
        try {
          await signInAnonymously(auth);
        } catch (error: any) {
          console.warn('Aviso de autenticação anônima:', error?.message);
          clearTimeout(timeout);
          unsubscribe();
          finish();
        }
      }
    });
  });

  return authReadyPromise;
};

ensureAuthReady();

export const db = {
  ensureAuthReady,

  subscribeToProducts: (onUpdate: (products: Product[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'products'), orderBy('nome'));
    return onSnapshot(
      q,
      (snapshot) => {
        const products = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Product));
        onUpdate(products);
      },
      (error) => {
        console.error('Erro ao ouvir produtos:', error);
        onError && onError(error);
      }
    );
  },

  subscribeToSales: (onUpdate: (sales: Sale[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'sales'), orderBy('created_at', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const sales = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Sale));
        onUpdate(sales);
      },
      (error) => {
        console.error('Erro ao ouvir vendas:', error);
        onError && onError(error);
      }
    );
  },

  subscribeToUsers: (onUpdate: (users: User[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'users'), orderBy('nome'));
    return onSnapshot(
      q,
      (snapshot) => {
        const users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as User));
        onUpdate(users);
      },
      (error) => {
        console.error('Erro ao ouvir usuários:', error);
        onError && onError(error);
      }
    );
  },

  subscribeToCustomers: (onUpdate: (customers: Customer[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'customers'), orderBy('nome'));
    return onSnapshot(
      q,
      (snapshot) => {
        const customers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Customer));
        onUpdate(customers);
      },
      (error) => {
        console.error('Erro ao ouvir clientes:', error);
        onError && onError(error);
      }
    );
  },

  subscribeToSettings: (onUpdate: (settings: AppSettings) => void, onError?: (err: any) => void) => {
    return onSnapshot(
      doc(dbInstance, 'settings', 'global'),
      (docSnap) => {
        if (docSnap.exists()) {
          onUpdate(docSnap.data() as AppSettings);
        } else {
          onUpdate({ cantinaName: 'TUSEMM - Maria Mulambo' });
        }
      },
      (error) => {
        console.error('Erro ao ouvir configurações:', error);
        onError && onError(error);
      }
    );
  },

  async saveOrUpdateCustomer(
    data: { id?: string; nome: string; telefone: string; valorAdicional?: number; origem?: 'reserva' | 'pdv' | 'fiado' | 'manual' },
    operatorName?: string,
    operatorId?: string
  ): Promise<Customer | null> {
    await ensureAuthReady();
    const cleanPhone = normalizePhone(data.telefone);
    const cleanName = (data.nome || '').trim();
    if (!cleanPhone && !cleanName) return null;

    // Se tiver telefone, o ID é o telefone normalizado garantindo unicidade e agrupamento
    const docId = cleanPhone || data.id || cleanName.toLowerCase().replace(/\s+/g, '_');
    const custRef = doc(dbInstance, 'customers', docId);

    try {
      const snap = await getDoc(custRef);
      const nowIso = new Date().toISOString();
      const formatted = cleanPhone ? formatPhone(cleanPhone) : data.telefone;

      if (snap.exists()) {
        const existing = snap.data() as Customer;
        const updates: any = {
          updated_at: nowIso,
          telefone_limpo: cleanPhone || existing.telefone_limpo || '',
          telefone: formatted || existing.telefone || ''
        };
        if (cleanName && cleanName !== 'Balcão' && cleanName !== 'Sem Nome') {
          updates.nome = cleanName;
        }
        if (data.valorAdicional && data.valorAdicional > 0) {
          updates.total_pedidos = (existing.total_pedidos || 0) + 1;
          updates.total_gasto = (existing.total_gasto || 0) + data.valorAdicional;
        }
        await updateDoc(custRef, updates);
        return { ...existing, ...updates, id: docId };
      } else {
        const newCustomer: Customer = {
          id: docId,
          nome: cleanName || 'Cliente',
          telefone: formatted || '',
          telefone_limpo: cleanPhone || '',
          total_pedidos: data.valorAdicional && data.valorAdicional > 0 ? 1 : 0,
          total_gasto: data.valorAdicional || 0,
          created_at: nowIso,
          updated_at: nowIso,
          origem: data.origem || 'reserva'
        };
        await setDoc(custRef, newCustomer);
        // Se mudou de ID sem telefone para ID com telefone, remove registro antigo se existir
        if (data.id && data.id !== docId) {
          deleteDoc(doc(dbInstance, 'customers', data.id)).catch(() => {});
        }
        if (operatorName && operatorId) {
          this.logAction(
            operatorName,
            operatorId,
            'Novo Cliente Cadastrado',
            `Cliente ${newCustomer.nome} (${newCustomer.telefone || 'Sem telefone'}) cadastrado no sistema.`
          ).catch(() => {});
        }
        return newCustomer;
      }
    } catch (err) {
      console.error('Erro ao salvar/atualizar cliente:', err);
      return null;
    }
  },

  async getCustomerByPhone(phone: string): Promise<Customer | null> {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length < 8) return null;

    try {
      const custRef = doc(dbInstance, 'customers', cleanPhone);
      const snap = await getDoc(custRef);
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() } as Customer;
      }

      const q = query(collection(dbInstance, 'customers'), where('telefone_limpo', '==', cleanPhone));
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        const firstDoc = querySnap.docs[0];
        return { id: firstDoc.id, ...firstDoc.data() } as Customer;
      }

      const allCustomers = await getDocs(collection(dbInstance, 'customers'));
      for (const d of allCustomers.docs) {
        const c = d.data() as Customer;
        const otherClean = c.telefone_limpo || normalizePhone(c.telefone);
        if (otherClean && (otherClean.endsWith(cleanPhone) || cleanPhone.endsWith(otherClean))) {
          return { id: d.id, ...c } as Customer;
        }
      }
    } catch (err) {
      console.warn('Erro ao buscar cliente por telefone:', err);
    }
    return null;
  },

  async deleteCustomer(customerId: string, customerName?: string, operatorName?: string, operatorId?: string) {
    await ensureAuthReady();
    await deleteDoc(doc(dbInstance, 'customers', customerId));
    if (operatorName && operatorId) {
      await this.logAction(operatorName, operatorId, 'Exclusão de Cliente', `Cliente Removido: ${customerName || customerId}`);
    }
  },

  async saveProduct(product: Partial<Product>, operatorName?: string, operatorId?: string) {
    await ensureAuthReady();
    try {
      const prodRef = product.id ? doc(dbInstance, 'products', product.id) : doc(collection(dbInstance, 'products'));
      const payload: any = { ...product, id: prodRef.id };
      if (!product.id) {
        payload.created_at = new Date().toISOString();
        if (payload.ativo === undefined) payload.ativo = true;
      }
      await setDoc(prodRef, payload, { merge: true });

      const opName = operatorName || 'Operador';
      const opId = operatorId || '0';
      const isEdit = !!product.id;
      const precoVenda = (Number(product.preco) || 0).toFixed(2);
      const precoCusto = product.preco_custo !== undefined ? ` | Custo: R$ ${(Number(product.preco_custo) || 0).toFixed(2)}` : '';
      const acao = isEdit ? 'Edição de Produto' : 'Novo Produto';
      const detalhes = isEdit
        ? `Produto "${product.nome || 'Sem Nome'}" atualizado (Venda: R$ ${precoVenda}${precoCusto} | Estoque: ${product.estoque ?? 0})`
        : `Produto "${product.nome || 'Sem Nome'}" cadastrado (Venda: R$ ${precoVenda}${precoCusto} | Estoque inicial: ${product.estoque ?? 0})`;

      this.logAction(opName, opId, acao, detalhes).catch((err) => console.error('Log silenciado:', err));
    } catch (e: any) {
      console.error('Firestore Save Error:', e);
      throw new Error(e.message || 'Erro de permissão ou conexão.');
    }
  },

  async deleteProduct(productId: string, productName: string, operatorName: string, operatorId: string) {
    await ensureAuthReady();
    await deleteDoc(doc(dbInstance, 'products', productId));
    await this.logAction(
      operatorName || 'Operador',
      operatorId || '0',
      'Exclusão de Produto',
      `Produto excluído do estoque: ${productName || productId}`
    );
  },

  async createSale(sale: any, items: SaleItem[], operatorId: string | null, operatorName?: string): Promise<Sale> {
    await ensureAuthReady();
    const batch = writeBatch(dbInstance);

    const saleRef = doc(collection(dbInstance, 'sales'));
    const newSale: any = {
      id: saleRef.id,
      usuario_id: operatorId && operatorId !== '0' ? operatorId : null,
      forma_pagamento: sale.paymentMethod,
      valor_total: Number(sale.total) || 0,
      status: sale.paymentMethod === PaymentMethod.FIADO || sale.tipo_pedido === 'reserva' ? 'pendente' : 'pago',
      cliente_nome:
        sale.customerName && typeof sale.customerName === 'string' && sale.customerName.trim()
          ? sale.customerName.trim()
          : 'Balcão',
      created_at: new Date().toISOString(),
      itens: items.map((i) => ({
        id: doc(collection(dbInstance, 'sales')).id,
        produto_id: i.produto_id,
        nome: i.nome || '',
        preco_unitario: Number(i.preco_unitario) || 0,
        quantidade: Number(i.quantidade) || 1,
        subtotal: Number(i.subtotal) || 0
      })),
      tipo_pedido: sale.tipo_pedido || 'balcao',
      status_entrega: sale.tipo_pedido === 'reserva' ? 'pendente' : 'entregue'
    };

    const rawTel = sale.telefone_comprador && typeof sale.telefone_comprador === 'string' ? sale.telefone_comprador.trim() : '';
    const cleanTel = normalizePhone(rawTel);
    if (cleanTel) {
      newSale.telefone_comprador = formatPhone(cleanTel) || rawTel;
      newSale.telefone_limpo = cleanTel;
    } else if (rawTel) {
      newSale.telefone_comprador = rawTel;
    }

    batch.set(saleRef, newSale);

    for (const item of items) {
      if (item.produto_id) {
        const pRef = doc(dbInstance, 'products', item.produto_id);
        const qtd = Number(item.quantidade) || 1;
        batch.update(pRef, { estoque: increment(-qtd) });
      }
    }

    await batch.commit();

    if (newSale.cliente_nome && newSale.cliente_nome !== 'Balcão' && (cleanTel || newSale.cliente_nome.length >= 2)) {
      this.saveOrUpdateCustomer(
        {
          nome: newSale.cliente_nome,
          telefone: cleanTel || newSale.telefone_comprador || '',
          valorAdicional: Number(sale.total) || 0,
          origem: sale.tipo_pedido === 'reserva' ? 'reserva' : sale.paymentMethod === PaymentMethod.FIADO ? 'fiado' : 'pdv'
        },
        operatorName || 'Caixa',
        operatorId || '0'
      ).catch((err) => console.warn('Erro ao sincronizar cliente da venda:', err));
    }

    const formaLabel = (sale.paymentMethod || '').toUpperCase();
    const tipoOrigem = sale.tipo_pedido === 'reserva' ? 'Reserva Online' : 'PDV Balcão';
    const acaoLabel = sale.paymentMethod === PaymentMethod.FIADO ? 'Venda Fiada Registrada' : 'Venda Concluída';
    const opNome = operatorName || (sale.tipo_pedido === 'reserva' ? `Reserva (${newSale.cliente_nome})` : 'Caixa Balcão');

    this.logAction(
      opNome,
      operatorId || '0',
      acaoLabel,
      `[${tipoOrigem}] R$ ${(Number(sale.total) || 0).toFixed(2)} (${formaLabel}) - Cliente: ${newSale.cliente_nome}`
    ).catch((err) => console.error('Log venda silenciado:', err));

    return newSale as Sale;
  },

  async payFiado(pedidoId: string, method: PaymentMethod, operatorName?: string, operatorId?: string) {
    await ensureAuthReady();
    await updateDoc(doc(dbInstance, 'sales', pedidoId), {
      status: 'pago',
      pago_com: method
    });
    this.logAction(
      operatorName || 'Operador',
      operatorId || '0',
      'Baixa de Fiado',
      `Fiado #${pedidoId.slice(-6).toUpperCase()} quitado com sucesso via ${(method || '').toUpperCase()}`
    ).catch((err) => console.error('Log fiado silenciado:', err));
  },

  async updateSale(pedidoId: string, data: any, operatorName?: string, operatorId?: string) {
    await ensureAuthReady();
    await updateDoc(doc(dbInstance, 'sales', pedidoId), data);
    if (data.status_entrega === 'entregue') {
      this.logAction(
        operatorName || 'Cozinha / KDS',
        operatorId || '0',
        'Entrega Confirmada',
        `Pedido #${pedidoId.slice(-6).toUpperCase()} marcado como entregue.`
      ).catch(() => {});
    } else if (data.status === 'pago') {
      this.logAction(
        operatorName || 'Cozinha / KDS',
        operatorId || '0',
        'Baixa de Pagamento',
        `Pedido #${pedidoId.slice(-6).toUpperCase()} marcado como pago.`
      ).catch(() => {});
    }
  },

  async updateSaleContact(
    saleId: string,
    telefone: string,
    cliente_nome?: string,
    operatorName?: string,
    operatorId?: string
  ) {
    await ensureAuthReady();
    const rawTel = (telefone || '').trim();
    const cleanTel = normalizePhone(rawTel);
    const formattedTel = cleanTel ? formatPhone(cleanTel) : rawTel;
    const updates: any = {
      telefone_comprador: formattedTel,
      telefone_limpo: cleanTel || ''
    };
    const cleanName = (cliente_nome || '').trim();
    if (cleanName) {
      updates.cliente_nome = cleanName;
    }
    await updateDoc(doc(dbInstance, 'sales', saleId), updates);

    if (cleanName && cleanName !== 'Balcão' && cleanName !== 'Sem Nome' && (cleanTel || rawTel)) {
      this.saveOrUpdateCustomer(
        {
          nome: cleanName,
          telefone: cleanTel || rawTel,
          origem: 'pdv'
        },
        operatorName,
        operatorId
      ).catch(() => {});
    }

    this.logAction(
      operatorName || 'Operador',
      operatorId || '0',
      'Contato da Venda Atualizado',
      `Telefone ${formattedTel || 'removido'} vinculado à venda #${saleId.slice(-6).toUpperCase()}`
    ).catch(() => {});
  },

  async updateFiadoCustomer(
    saleIds: string[],
    cliente_nome: string,
    telefone_comprador?: string,
    operatorName?: string,
    operatorId?: string
  ) {
    await ensureAuthReady();
    const cleanNome = (cliente_nome || '').trim() || 'Sem Nome';
    const rawTel = (telefone_comprador || '').trim();
    const cleanTel = normalizePhone(rawTel);
    const formattedTel = cleanTel ? formatPhone(cleanTel) : rawTel;

    const batch = writeBatch(dbInstance);
    for (const id of saleIds) {
      const sRef = doc(dbInstance, 'sales', id);
      batch.update(sRef, {
        cliente_nome: cleanNome,
        telefone_comprador: formattedTel,
        telefone_limpo: cleanTel || ''
      });
    }
    await batch.commit();

    if (cleanNome !== 'Sem Nome' && (cleanTel || rawTel)) {
      this.saveOrUpdateCustomer(
        {
          nome: cleanNome,
          telefone: cleanTel || rawTel,
          origem: 'fiado'
        },
        operatorName,
        operatorId
      ).catch(() => {});
    }

    this.logAction(
      operatorName || 'Operador',
      operatorId || '0',
      'Edição de Fiado',
      `Dados do cliente fiado atualizados: ${cleanNome} (Tel: ${formattedTel || 'Não informado'}) em ${saleIds.length} venda(s)`
    ).catch((err) => console.error('Log fiado silenciado:', err));
  },

  async deleteUser(userId: string, userName: string, operatorName: string, operatorId: string) {
    await ensureAuthReady();
    await deleteDoc(doc(dbInstance, 'users', userId));
    await this.logAction(operatorName, operatorId, 'Exclusão de Usuário', `Usuário Removido: ${userName}`);
  },

  async saveUser(user: Partial<User>, operatorName?: string, operatorId?: string) {
    await ensureAuthReady();
    try {
      const userRef = user.id ? doc(dbInstance, 'users', user.id) : doc(collection(dbInstance, 'users'));
      const payload = { ...user, id: userRef.id };
      await setDoc(userRef, payload, { merge: true });

      if (operatorName && operatorId) {
        await this.logAction(operatorName, operatorId, user.id ? 'Edição de Usuário' : 'Novo Usuário', `Usuário: ${user.usuario}`);
      }
    } catch (e: any) {
      console.error('Erro ao salvar usuário:', e);
      throw e;
    }
  },

  async saveSettings(settings: AppSettings, operatorName?: string, operatorId?: string) {
    await ensureAuthReady();
    await setDoc(doc(dbInstance, 'settings', 'global'), settings, { merge: true });
    if (operatorName && operatorId) {
      await this.logAction(operatorName, operatorId, 'Alteração de Configurações', 'Configurações globais atualizadas');
    }
  },

  async loginAsSuperAdmin(email: string, pass: string) {
    try {
      const fullEmail = email.includes('@') ? email : `${email}@gmail.com`;
      const userCredential = await signInWithEmailAndPassword(auth, fullEmail, pass);
      return userCredential.user;
    } catch (e: any) {
      console.error('Super Admin Login Error:', e);
      throw new Error('Erro na autenticação mestra: ' + (e.message || 'Senha incorreta.'));
    }
  },

  async logout() {
    await signOut(auth);
    authReadyPromise = null;
    await signInAnonymously(auth).catch(() => {});
  },

  async checkHealth() {
    try {
      const testRef = doc(dbInstance, 'settings', 'global');
      await getDoc(testRef);
      return {
        details: {
          Status: 'OK',
          'ID do Projeto': (firebaseConfig as any).projectId,
          Auth: auth.currentUser?.isAnonymous ? 'Anônimo' : auth.currentUser?.email || 'Nenhum'
        }
      };
    } catch (e: any) {
      console.error('Health check error:', e);
      return {
        details: {
          Erro: 'Falha na Conexão',
          Código: e.code || 'Desconhecido',
          Aviso: 'Verifique se o Banco de Dados existe e as regras foram publicadas.'
        }
      };
    }
  },

  async logAction(userName: string, userId: string, action: string, details: string) {
    try {
      const logRef = doc(collection(dbInstance, 'logs'));
      const nowIso = new Date().toISOString();
      const logData = {
        id: logRef.id,
        usuario_nome: userName || 'Sistema',
        usuario_id: userId || '0',
        acao: action,
        detalhes: details,
        data: nowIso,
        created_at: nowIso
      };
      await setDoc(logRef, logData);
      return logData;
    } catch (e) {
      console.error('Erro ao registrar log de auditoria:', e);
      return null;
    }
  },

  subscribeToLogs: (onUpdate: (logs: any[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'logs'), limit(300));
    return onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          const welcomeRef = doc(collection(dbInstance, 'logs'));
          setDoc(welcomeRef, {
            id: welcomeRef.id,
            usuario_nome: 'Sistema TUSEMM',
            usuario_id: '0',
            acao: 'Auditoria Ativada',
            detalhes: 'Monitoramento de alterações e auditoria de vendas iniciado com sucesso.',
            data: new Date().toISOString()
          }).catch(() => {});
        }

        const logs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        logs.sort((a: any, b: any) => {
          const timeA = new Date(a.data || a.created_at || 0).getTime();
          const timeB = new Date(b.data || b.created_at || 0).getTime();
          return timeB - timeA;
        });
        onUpdate(logs);
      },
      (error) => {
        console.error('Erro ao ouvir logs:', error);
        onError && onError(error);
      }
    );
  },

  subscribeToCashShifts: (onUpdate: (shifts: CashShift[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'cash_shifts'), limit(100));
    return onSnapshot(
      q,
      (snapshot) => {
        const shifts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as CashShift));
        shifts.sort((a, b) => new Date(b.aberto_em).getTime() - new Date(a.aberto_em).getTime());
        onUpdate(shifts);
      },
      (error) => {
        console.error('Erro ao ouvir turnos de caixa:', error);
        onError && onError(error);
      }
    );
  },

  async openCashShift(valorAbertura: number, operadorNome: string, operadorId: string): Promise<CashShift> {
    await ensureAuthReady();
    const shiftRef = doc(collection(dbInstance, 'cash_shifts'));
    const newShift: CashShift = {
      id: shiftRef.id,
      status: 'aberto',
      aberto_em: new Date().toISOString(),
      aberto_por_nome: operadorNome,
      aberto_por_id: operadorId,
      valor_abertura: Number(valorAbertura) || 0,
      movimentacoes: [],
      total_sangrias: 0,
      total_suprimentos: 0
    };
    await setDoc(shiftRef, newShift);
    await this.logAction(
      operadorNome,
      operadorId,
      'Abertura de Caixa',
      `Turno de caixa aberto com troco inicial de R$ ${(Number(valorAbertura) || 0).toFixed(2)}`
    );
    return newShift;
  },

  async addCashMovement(
    shiftId: string,
    tipo: 'sangria' | 'suprimento',
    valor: number,
    motivo: string,
    operadorNome: string,
    operadorId: string
  ) {
    await ensureAuthReady();
    const shiftRef = doc(dbInstance, 'cash_shifts', shiftId);
    const snap = await getDoc(shiftRef);
    if (!snap.exists()) throw new Error('Turno de caixa não encontrado.');
    const shift = snap.data() as CashShift;
    const movement: CashMovement = {
      id: Math.random().toString(36).substring(2, 9),
      tipo,
      valor: Number(valor) || 0,
      motivo: motivo.trim() || (tipo === 'sangria' ? 'Retirada de dinheiro (Sangria)' : 'Reforço de troco (Suprimento)'),
      data: new Date().toISOString(),
      operador_nome: operadorNome,
      operador_id: operadorId
    };
    const currentMovements = shift.movimentacoes || [];
    const updatedMovements = [...currentMovements, movement];
    const totalSangrias = updatedMovements.filter((m) => m.tipo === 'sangria').reduce((a, b) => a + (Number(b.valor) || 0), 0);
    const totalSuprimentos = updatedMovements.filter((m) => m.tipo === 'suprimento').reduce((a, b) => a + (Number(b.valor) || 0), 0);

    await updateDoc(shiftRef, {
      movimentacoes: updatedMovements,
      total_sangrias: totalSangrias,
      total_suprimentos: totalSuprimentos
    });

    const label = tipo === 'sangria' ? 'Sangria de Caixa' : 'Suprimento de Caixa';
    await this.logAction(operadorNome, operadorId, label, `R$ ${(Number(valor) || 0).toFixed(2)} - ${movement.motivo}`);
  },

  async closeCashShift(
    shiftId: string,
    valorInformado: number,
    valorCalculado: number,
    totaisVendas: any,
    obs: string,
    operadorNome: string,
    operadorId: string
  ) {
    await ensureAuthReady();
    const shiftRef = doc(dbInstance, 'cash_shifts', shiftId);
    const diferenca = Number((valorInformado - valorCalculado).toFixed(2));
    const updateData: Partial<CashShift> = {
      status: 'fechado',
      fechado_em: new Date().toISOString(),
      fechado_por_nome: operadorNome,
      fechado_por_id: operadorId,
      valor_fechamento_informado: Number(valorInformado) || 0,
      valor_fechamento_calculado: Number(valorCalculado) || 0,
      diferenca: diferenca,
      total_vendas_dinheiro: totaisVendas.dinheiro || 0,
      total_vendas_pix: totaisVendas.pix || 0,
      total_vendas_debito: totaisVendas.debito || 0,
      total_vendas_credito: totaisVendas.credito || 0,
      total_vendas_fiado: totaisVendas.fiado || 0
    };
    if (obs && obs.trim()) {
      updateData.observacoes_fechamento = obs.trim();
    }
    await updateDoc(shiftRef, updateData);
    const diffStatus =
      diferenca === 0
        ? 'Conferência Exata'
        : diferenca > 0
          ? `Sobra de R$ ${diferenca.toFixed(2)}`
          : `Falta de R$ ${Math.abs(diferenca).toFixed(2)}`;
    await this.logAction(
      operadorNome,
      operadorId,
      'Fechamento de Caixa',
      `Turno encerrado. Informado: R$ ${valorInformado.toFixed(2)} | Esperado: R$ ${valorCalculado.toFixed(2)} (${diffStatus})`
    );
  }
};
