import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  signInWithEmailAndPassword, signOut 
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, query, where, orderBy, 
  onSnapshot, getDocs, getDoc, setDoc, updateDoc, deleteDoc, 
  addDoc, serverTimestamp, writeBatch, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
  increment
} from 'firebase/firestore';

import firebaseConfig from '../firebase-applet-config.json';
import { Product, Sale, PaymentMethod, SaleItem, User, UserRole, AppSettings } from '../types';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Inicialização com Cache Offline otimizada para Android e proteção contra campos undefined
const dbInstance = initializeFirestore(app, {
  localCache: persistentLocalCache({}),
  ignoreUndefinedProperties: true
}, firebaseConfig.firestoreDatabaseId || '(default)');

export { dbInstance };

// Helper para timeout em operações do Firebase
const withTimeout = async (promise: Promise<any>, timeoutMs: number = 10000) => {
  let timeoutHandle: any;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("O banco de dados não respondeu a tempo (Timeout).")), timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle);
    throw error;
  }
};

let authReadyPromise: Promise<void> | null = null;
const ensureAuthReady = () => {
  if (authReadyPromise) return authReadyPromise;
  
  authReadyPromise = new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.warn("Auth check timed out, resolving anyway to allow app flow.");
        resolved = true;
        resolve();
      }
    }, 15000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        console.log("Auth State Changed: Logged In as ", user.isAnonymous ? "Anonymous" : user.email);
        resolved = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      } else {
        console.log("Auth State Changed: No User. Attempting Anonymous Login...");
        try {
          await signInAnonymously(auth);
        } catch (error: any) {
          console.warn("Aviso de autenticação anônima (prosseguindo para login):", error.message);
          resolved = true;
          clearTimeout(timeout);
          unsubscribe();
          resolve();
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
    return onSnapshot(q, (snapshot) => {
      const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      onUpdate(products);
    }, (error) => {
      console.error("Erro ao ouvir produtos:", error);
      onError && onError(error);
    });
  },

  subscribeToSales: (onUpdate: (sales: Sale[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'sales'), orderBy('created_at', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const sales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
      onUpdate(sales);
    }, (error) => {
      console.error("Erro ao ouvir vendas:", error);
      onError && onError(error);
    });
  },

  subscribeToUsers: (onUpdate: (users: User[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'users'), orderBy('nome'));
    return onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      onUpdate(users);
    }, (error) => {
      console.error("Erro ao ouvir usuários:", error);
      onError && onError(error);
    });
  },
  
  subscribeToSettings: (onUpdate: (settings: AppSettings) => void, onError?: (err: any) => void) => {
    return onSnapshot(doc(dbInstance, 'settings', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        onUpdate(docSnap.data() as AppSettings);
      } else {
        onUpdate({ cantinaName: 'TUSEMM - Maria Mulambo' });
      }
    }, (error) => {
      console.error("Erro ao ouvir configurações:", error);
      onError && onError(error);
    });
  },

  async saveProduct(product: Partial<Product>, operatorName?: string, operatorId?: string) {
    try {
      const prodRef = product.id ? doc(dbInstance, 'products', product.id) : doc(collection(dbInstance, 'products'));
      const payload = { ...product, id: prodRef.id };
      if (!product.id) {
         payload.created_at = new Date().toISOString();
         if(payload.ativo === undefined) payload.ativo = true;
      }
      await setDoc(prodRef, payload, { merge: true });
      
      if (operatorName && operatorId) {
        // Logar sem travar a operação principal
        this.logAction(operatorName, operatorId, product.id ? 'Edição de Produto' : 'Novo Produto', `Produto: ${product.nome || 'N/A'}`)
          .catch(err => console.error("Log silenciado:", err));
      }
    } catch (e: any) {
      console.error("Firestore Save Error:", e);
      throw new Error(e.message || "Erro de permissão ou conexão.");
    }
  },

  async deleteProduct(productId: string, productName: string, operatorName: string, operatorId: string) {
    await deleteDoc(doc(dbInstance, 'products', productId));
    await this.logAction(operatorName, operatorId, 'Exclusão de Produto', `Produto: ${productName}`);
  },

  async createSale(sale: any, items: SaleItem[], operatorId: string | null) {
    const batch = writeBatch(dbInstance);

    const saleRef = doc(collection(dbInstance, 'sales'));
    const newSale: any = {
      id: saleRef.id,
      usuario_id: (operatorId && operatorId !== '0') ? operatorId : null,
      forma_pagamento: sale.paymentMethod,
      valor_total: Number(sale.total) || 0,
      status: (sale.paymentMethod === PaymentMethod.FIADO || sale.tipo_pedido === 'reserva') ? 'pendente' : 'pago',
      cliente_nome: (sale.customerName && typeof sale.customerName === 'string' && sale.customerName.trim()) ? sale.customerName.trim() : 'Balcão',
      created_at: new Date().toISOString(),
      itens: items.map(i => ({
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

    if (sale.telefone_comprador && typeof sale.telefone_comprador === 'string' && sale.telefone_comprador.trim()) {
      newSale.telefone_comprador = sale.telefone_comprador.trim();
    }

    batch.set(saleRef, newSale);

    // Usa increment() para diminuir estoque mesmo offline, sem precisar ler dados antes
    for(const item of items) {
      if(item.produto_id) {
        const pRef = doc(dbInstance, 'products', item.produto_id);
        const qtd = Number(item.quantidade) || 1;
        batch.update(pRef, { estoque: increment(-qtd) });
      }
    }
    
    await batch.commit();

    // Registra log de auditoria da venda sem bloquear
    const formaLabel = (sale.paymentMethod || '').toUpperCase();
    const tipoOrigem = sale.tipo_pedido === 'reserva' ? 'Reserva' : 'PDV Balcão';
    const acaoLabel = sale.paymentMethod === PaymentMethod.FIADO ? 'Venda Fiada Registrada' : 'Venda Concluída';
    this.logAction(
      newSale.cliente_nome || 'Caixa Balcão',
      operatorId || '0',
      acaoLabel,
      `[${tipoOrigem}] R$ ${(Number(sale.total) || 0).toFixed(2)} (${formaLabel}) - Cliente: ${newSale.cliente_nome}`
    ).catch(err => console.error("Log venda silenciado:", err));

    return newSale as Sale;
  },

  async payFiado(pedidoId: string, method: PaymentMethod, operatorName?: string, operatorId?: string) {
    await updateDoc(doc(dbInstance, 'sales', pedidoId), {
      status: 'pago',
      pago_com: method
    });
    this.logAction(
      operatorName || 'Operador',
      operatorId || '0',
      'Baixa de Fiado',
      `Fiado #${pedidoId.slice(-6).toUpperCase()} quitado com sucesso via ${(method || '').toUpperCase()}`
    ).catch(err => console.error("Log fiado silenciado:", err));
  },

  async updateSale(pedidoId: string, data: any) {
    await updateDoc(doc(dbInstance, 'sales', pedidoId), data);
  },

  async deleteUser(userId: string, userName: string, operatorName: string, operatorId: string) {
    await deleteDoc(doc(dbInstance, 'users', userId));
    await this.logAction(operatorName, operatorId, 'Exclusão de Usuário', `Usuário Removido: ${userName}`);
  },

  async saveUser(user: Partial<User>, operatorName?: string, operatorId?: string) {
     try {
       const userRef = user.id ? doc(dbInstance, 'users', user.id) : doc(collection(dbInstance, 'users'));
       const payload = { ...user, id: userRef.id };
       await setDoc(userRef, payload, { merge: true });
       
       if (operatorName && operatorId) {
         await this.logAction(operatorName, operatorId, user.id ? 'Edição de Usuário' : 'Novo Usuário', `Usuário: ${user.usuario}`);
       }
     } catch (e: any) {
       console.error("Erro ao salvar usuário:", e);
       throw e;
     }
  },

  async saveSettings(settings: AppSettings, operatorName?: string, operatorId?: string) {
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
      console.error("Super Admin Login Error:", e);
      throw new Error("Erro na autenticação mestra: " + (e.message || "Senha incorreta."));
    }
  },

  async logout() {
    await signOut(auth);
    await signInAnonymously(auth); // Volta para anonimo para manter conexao dos funcionarios
  },

  async checkHealth() {
    try {
      const testRef = doc(dbInstance, 'settings', 'global');
      await getDoc(testRef);
      return { 
        details: { 
          'Status': 'OK', 
          'ID do Projeto': (firebaseConfig as any).projectId,
          'Auth': auth.currentUser?.isAnonymous ? 'Anônimo' : (auth.currentUser?.email || 'Nenhum')
        } 
      };
    } catch (e: any) {
      console.error("Health check error:", e);
      return { 
        details: { 
          'Erro': 'Falha na Conexão', 
          'Código': e.code || 'Desconhecido',
          'Aviso': 'Verifique se o Banco de Dados existe e as regras foram publicadas.'
        } 
      };
    }
  },

  async logAction(userName: string, userId: string, action: string, details: string) {
    try {
      const logRef = doc(collection(dbInstance, 'logs'));
      const logData = {
        id: logRef.id,
        usuario_nome: userName || 'Sistema',
        usuario_id: userId || '0',
        acao: action,
        detalhes: details,
        data: new Date().toISOString()
      };
      await setDoc(logRef, logData);
    } catch (e) {
      console.error("Erro ao registrar log de auditoria:", e);
    }
  },

  subscribeToLogs: (onUpdate: (logs: any[]) => void, onError?: (err: any) => void) => {
    // Consulta direta sem necessidade de índice composto customizado no Firestore
    const q = query(collection(dbInstance, 'logs'), limit(300));
    return onSnapshot(q, (snapshot) => {
      // Se a coleção estiver vazia, cria um registro inicial de boas-vindas
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
      
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Ordenação na memória por data decrescente (mais recente primeiro)
      logs.sort((a: any, b: any) => {
        const timeA = new Date(a.data || a.created_at || 0).getTime();
        const timeB = new Date(b.data || b.created_at || 0).getTime();
        return timeB - timeA;
      });
      onUpdate(logs);
    }, (error) => {
      console.error("Erro ao ouvir logs:", error);
      onError && onError(error);
    });
  }
};
