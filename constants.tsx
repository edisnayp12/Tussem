import { Product, User, UserRole } from './types';

export const PDV_CATEGORIES = ['Todos', 'Salgados', 'Bebidas', 'Doces', 'Combos'] as const;

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'demo-1',
    nome: 'Coxinha de Frango',
    categoria: 'Salgados',
    preco: 7.0,
    preco_custo: 3.2,
    codigo: '101',
    estoque: 25,
    estoque_minimo: 5,
    ativo: true
  },
  {
    id: 'demo-2',
    nome: 'Pastel Assado de Carne',
    categoria: 'Salgados',
    preco: 8.0,
    preco_custo: 3.8,
    codigo: '102',
    estoque: 18,
    estoque_minimo: 5,
    ativo: true
  },
  {
    id: 'demo-3',
    nome: 'Pão de Queijo Grande',
    categoria: 'Salgados',
    preco: 5.5,
    preco_custo: 2.3,
    codigo: '103',
    estoque: 30,
    estoque_minimo: 8,
    ativo: true
  },
  {
    id: 'demo-4',
    nome: 'Suco Natural Laranja 300ml',
    categoria: 'Bebidas',
    preco: 6.5,
    preco_custo: 2.8,
    codigo: '201',
    estoque: 20,
    estoque_minimo: 6,
    ativo: true
  },
  {
    id: 'demo-5',
    nome: 'Refrigerante Lata 350ml',
    categoria: 'Bebidas',
    preco: 6.0,
    preco_custo: 3.1,
    codigo: '202',
    estoque: 40,
    estoque_minimo: 10,
    ativo: true
  },
  {
    id: 'demo-6',
    nome: 'Água Mineral 500ml',
    categoria: 'Bebidas',
    preco: 3.5,
    preco_custo: 1.2,
    codigo: '203',
    estoque: 45,
    estoque_minimo: 12,
    ativo: true
  },
  {
    id: 'demo-7',
    nome: 'Brigadeiro Gourmet',
    categoria: 'Doces',
    preco: 4.0,
    preco_custo: 1.5,
    codigo: '301',
    estoque: 24,
    estoque_minimo: 6,
    ativo: true
  },
  {
    id: 'demo-8',
    nome: 'Combo Salgado + Refri Lata',
    categoria: 'Combos',
    preco: 11.5,
    preco_custo: 6.0,
    codigo: '401',
    estoque: 15,
    estoque_minimo: 4,
    ativo: true
  }
];

export interface QuickPinOperator {
  id: string;
  label: string;
  roleLabel: string;
  usuario: string;
  pin: string;
  perfil: UserRole;
  userObj: User;
}

export const DEFAULT_QUICK_OPERATORS: QuickPinOperator[] = [
  {
    id: 'op-caixa-01',
    label: 'Caixa 01',
    roleLabel: 'Operador de Caixa',
    usuario: 'caixa',
    pin: '1234',
    perfil: UserRole.COMMON,
    userObj: {
      id: 'op-caixa-01',
      nome: 'Caixa 01',
      usuario: 'caixa',
      pin: '1234',
      perfil: UserRole.COMMON,
      ativo: true
    }
  },
  {
    id: 'op-caixa-02',
    label: 'Caixa 02',
    roleLabel: 'Operador de Caixa',
    usuario: 'caixa2',
    pin: '1234',
    perfil: UserRole.COMMON,
    userObj: {
      id: 'op-caixa-02',
      nome: 'Caixa 02',
      usuario: 'caixa2',
      pin: '1234',
      perfil: UserRole.COMMON,
      ativo: true
    }
  },
  {
    id: 'op-admin',
    label: 'Administrador',
    roleLabel: 'Gestão & Estoque',
    usuario: 'admin',
    pin: '0000',
    perfil: UserRole.ADMIN,
    userObj: {
      id: 'op-admin',
      nome: 'Administrador',
      usuario: 'admin',
      pin: '0000',
      perfil: UserRole.ADMIN,
      ativo: true
    }
  }
];

export const AUTH_CREDENTIALS = {
  username: 'admin',
  password: '0000'
};
