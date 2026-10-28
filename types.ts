
export enum PaymentMethod {
  PIX = 'pix',
  CASH = 'dinheiro',
  DEBIT = 'debito',
  CREDIT = 'credito',
  FIADO = 'fiado'
}

export enum UserRole {
  ADMIN = 'admin',
  COMMON = 'comum',
  KDS = 'kds'
}

export enum Category {
  SNACK = 'Lanches',
  SODA = 'Refrigerantes',
  BEER = 'Cerveja',
  DRINK = 'Drinks',
  COFFEE = 'Café',
  MILK_COFFEE = 'Café com Leite',
  OTHERS = 'Outros'
}

export interface User {
  id: string;
  nome: string;
  usuario: string;
  email?: string;
  senha?: string;
  perfil: UserRole;
  ativo: boolean;
  created_at?: string;
}

export interface AppSettings {
  cantinaName: string;
  mercadoPagoToken?: string;
  pixModo?: 'mercadopago' | 'manual';
  pixChave?: string;
  pixTitular?: string;
  pixCidade?: string;
  categoriasPersonalizadas?: string[];
  tema?: 'light' | 'dark';
}

export interface Product {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  estoque: number;
  categoria: string;
  ativo: boolean;
  codigo?: string;
  codigo_barras?: string;
  estoque_minimo?: number;
  preco_custo?: number;
  created_at?: string;
}

export interface SaleItem {
  id?: string;
  pedido_id?: string;
  produto_id: string;
  nome?: string; // Virtual para UI
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
}

export interface Sale {
  id: string;
  cliente_id?: string;
  usuario_id?: string;
  status: 'pago' | 'pendente' | 'cancelado';
  valor_total: number;
  forma_pagamento: PaymentMethod;
  pago_com?: PaymentMethod;
  created_at: string;
  itens?: SaleItem[];
  cliente_nome?: string; // Virtual para UI
  numero_venda?: number; 
  tipo_pedido?: 'balcao' | 'reserva';
  status_entrega?: 'pendente' | 'entregue';
  telefone_comprador?: string;
}

export interface StockMovement {
  id: string;
  produto_id: string;
  tipo: 'entrada' | 'saida' | 'ajuste';
  quantidade: number;
  motivo: string;
  usuario: string;
  data: string;
}

export interface AuditLog {
  id: string;
  usuario_nome: string;
  usuario_id: string;
  acao: string;
  detalhes: string;
  data: string;
}

export interface Customer {
  id: string; // normalizado (somente dígitos)
  nome: string;
  telefone: string;
  telefone_limpo: string;
  total_pedidos?: number;
  total_gasto?: number;
  total_fiado_aberto?: number;
  created_at: string;
  updated_at?: string;
  origem?: 'reserva' | 'pdv' | 'fiado' | 'manual';
}

export interface CashMovement {
  id: string;
  tipo: 'sangria' | 'suprimento';
  valor: number;
  motivo: string;
  data: string;
  operador_nome: string;
  operador_id: string;
}

export interface CashShift {
  id: string;
  status: 'aberto' | 'fechado';
  aberto_em: string;
  aberto_por_nome: string;
  aberto_por_id: string;
  valor_abertura: number; // Fundo de troco inicial
  fechado_em?: string;
  fechado_por_nome?: string;
  fechado_por_id?: string;
  valor_fechamento_informado?: number; // Valor contado em dinheiro
  valor_fechamento_calculado?: number; // Valor esperado em dinheiro
  diferenca?: number; // Sobra (+) ou falta (-)
  observacoes_fechamento?: string;
  movimentacoes?: CashMovement[];
  total_vendas_dinheiro?: number;
  total_vendas_pix?: number;
  total_vendas_debito?: number;
  total_vendas_credito?: number;
  total_vendas_fiado?: number;
  total_sangrias?: number;
  total_suprimentos?: number;
}

