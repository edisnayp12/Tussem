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

// Inicialização com Cache Offline otimizada para Android
const dbInstance = initializeFirestore(app, {
  localCache: persistentLocalCache({})
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
          console.error("Falha fatal na autenticação do Firebase:", error);
          resolved = true;
          clearTimeout(timeout);
          unsubscribe();
          // Rejeitamos com uma mensagem clara se não conseguirmos nem login anônimo
          reject(new Error(`Falha ao conectar com o Firebase: ${error.message}. Verifique se o login anônimo está ativado.`));
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
    const newSale: Sale = {
      id: saleRef.id,
      usuario_id: (operatorId && operatorId !== '0') ? operatorId : null,
      forma_pagamento: sale.paymentMethod,
      valor_total: sale.total,
      status: (sale.paymentMethod === PaymentMethod.FIADO || sale.tipo_pedido === 'reserva') ? 'pendente' : 'pago',
      cliente_nome: sale.customerName || 'Balcão',
      created_at: new Date().toISOString(),
      itens: items.map(i => ({ ...i, id: doc(collection(dbInstance, 'sales')).id })),
      tipo_pedido: sale.tipo_pedido || 'balcao',
      telefone_comprador: sale.telefone_comprador || undefined,
      status_entrega: sale.tipo_pedido === 'reserva' ? 'pendente' : 'entregue'
    };

    batch.set(saleRef, newSale);

    // Usa increment() para diminuir estoque mesmo offline, sem precisar ler dados antes
    for(const item of items) {
      if(item.produto_id) {
        const pRef = doc(dbInstance, 'products', item.produto_id);
        batch.update(pRef, { estoque: increment(-item.quantidade) });
      }
    }
    
    await batch.commit();
    return newSale;
  },

  async payFiado(pedidoId: string, method: PaymentMethod) {
    await updateDoc(doc(dbInstance, 'sales', pedidoId), {
      status: 'pago',
      pago_com: method
    });
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
    const logRef = doc(collection(dbInstance, 'logs'));
    const logData = {
      id: logRef.id,
      usuario_nome: userName,
      usuario_id: userId,
      acao: action,
      detalhes: details,
      data: new Date().toISOString()
    };
    await setDoc(logRef, logData);
  },

  subscribeToLogs: (onUpdate: (logs: any[]) => void, onError?: (err: any) => void) => {
    const q = query(collection(dbInstance, 'logs'), orderBy('data', 'desc'), where('data', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())); // Mostra ultimos 7 dias por performance
    return onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      onUpdate(logs);
    }, (error) => {
      console.error("Erro ao ouvir logs:", error);
      onError && onError(error);
    });
  }
};
