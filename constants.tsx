
import { Category, Product } from './types';

// Fix: Object literal may only specify known properties. Using correct property names from Product interface.
export const INITIAL_PRODUCTS: Product[] = [
  { id: '1', nome: 'Coxinha', categoria: Category.SNACK, preco: 7.00, codigo: '101', estoque: 20, estoque_minimo: 5, ativo: true },
  { id: '2', nome: 'Refrigerante Lata', categoria: Category.SODA, preco: 6.00, codigo: '102', estoque: 50, estoque_minimo: 10, ativo: true },
  { id: '3', nome: 'Cerveja Skol', categoria: Category.BEER, preco: 8.00, codigo: '103', estoque: 48, estoque_minimo: 12, ativo: true },
  { id: '4', nome: 'Drink Especial', categoria: Category.DRINK, preco: 15.00, codigo: '104', estoque: 30, estoque_minimo: 5, ativo: true },
  { id: '5', nome: 'Café Simples', categoria: Category.COFFEE, preco: 3.00, codigo: '105', estoque: 100, estoque_minimo: 20, ativo: true },
  { id: '6', nome: 'Café com Leite', categoria: Category.MILK_COFFEE, preco: 5.00, codigo: '106', estoque: 80, estoque_minimo: 15, ativo: true },
];

export const AUTH_CREDENTIALS = {
  username: 'Admin',
  password: 'Admin123'
};
