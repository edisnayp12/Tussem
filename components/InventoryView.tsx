
import React, { useState } from 'react';
import { Product, User, Category, UserRole } from '../types';

interface InventoryViewProps {
  products: Product[];
  onUpdateProduct: (p: Product) => Promise<void>;
  onAddProduct: (p: any) => Promise<void>;
  onDeleteProduct?: (id: string, name: string) => Promise<void>;
  currentUser: User;
}

const InventoryView: React.FC<InventoryViewProps> = ({ products, onUpdateProduct, onAddProduct, onDeleteProduct, currentUser }) => {
  const [editing, setEditing] = useState<Product | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const isAdmin = currentUser?.perfil === UserRole.ADMIN || currentUser?.id === 'super-admin';
  
  const [newProd, setNewProd] = useState({
    nome: '',
    preco: '',
    preco_custo: '',
    estoque: '0',
    categoria: Category.OTHERS as string
  });

  const allCategories = Array.from(new Set([...Object.values(Category), ...products.map(p => p.categoria)])).filter(Boolean);

  const handleDelete = async (productId: string, productName: string) => {
    if (!onDeleteProduct) return;
    if (confirm(`Tem certeza que deseja excluir o produto "${productName}"?`)) {
      setIsSaving(true);
      try {
        await onDeleteProduct(productId, productName);
      } catch (e: any) {
        alert("Erro ao excluir: " + e.message);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleAddProduct = async () => {
    if (!newProd.nome || !newProd.preco) return alert("Preencha nome e preço!");
    setIsSaving(true);
    try {
      await onAddProduct({
        ...newProd,
        preco: parseFloat(newProd.preco) || 0,
        preco_custo: newProd.preco_custo ? parseFloat(newProd.preco_custo) : 0,
        estoque: parseInt(newProd.estoque) || 0,
        ativo: true
      });
      setIsAdding(false);
      setNewProd({ nome: '', preco: '', preco_custo: '', estoque: '0', categoria: Category.OTHERS });
    } catch (e: any) {
      alert("Erro ao adicionar produto: " + (e.message || "Erro desconhecido"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStock = async () => {
    if (!editing) return;
    setIsSaving(true);
    try {
      await onUpdateProduct(editing);
      setEditing(null);
    } catch (e: any) {
      alert("Erro ao atualizar produto: " + (e.message || "Erro desconhecido"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black text-purple-950 dark:text-purple-200 uppercase tracking-tighter">Inventário & Precificação</h2>
          <p className="text-[10px] text-gray-400 dark:text-purple-300/60 font-bold uppercase mt-1">Gestão de Estoque, Preço de Custo e Venda</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-purple-900 dark:bg-purple-700 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:bg-black transition-all"
        >
          Novo Item
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {products.map(p => {
          const lucroUnit = (p.preco || 0) - (p.preco_custo || 0);
          const margemPct = p.preco && p.preco > 0 ? (lucroUnit / p.preco) * 100 : 0;
          return (
            <div key={p.id} className="bg-white dark:bg-[#160e2b] p-6 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40 flex justify-between items-center group hover:shadow-md transition-all">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 flex items-center justify-center text-xl">
                  <i className="fa-solid fa-box"></i>
                </div>
                <div>
                  <h4 className="text-sm font-black text-gray-800 dark:text-gray-100 uppercase leading-none">{p.nome}</h4>
                  <p className="text-[10px] font-bold text-gray-400 dark:text-purple-300/60 uppercase mt-2">
                    Venda: <span className="text-purple-900 dark:text-amber-300 font-black">R$ {(p.preco || 0).toFixed(2)}</span>
                    {p.preco_custo !== undefined && p.preco_custo > 0 && (
                      <span className="ml-2 text-gray-400 dark:text-purple-400">
                        • Custo: R$ {(p.preco_custo || 0).toFixed(2)} ({margemPct.toFixed(0)}% mg)
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-2xl font-black ${(p.estoque || 0) <= 5 ? 'text-red-500' : 'text-purple-950 dark:text-purple-200'}`}>
                  {p.estoque || 0}
                </div>
                <button 
                  onClick={() => setEditing(p)} 
                  className="text-[8px] font-black uppercase text-purple-500 hover:text-purple-700 dark:text-purple-300 dark:hover:text-amber-300 underline"
                >
                  Editar Item
                </button>
                {isAdmin && (
                  <button 
                    onClick={() => handleDelete(p.id, p.nome)}
                    className="text-[8px] font-black uppercase text-red-400 hover:text-red-700 underline ml-3"
                  >
                    Excluir
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de Entrada de Estoque / Edição */}
      {editing && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-sm shadow-2xl border border-gray-100 dark:border-purple-900/40 animate-in zoom-in-95">
            <h3 className="text-xl font-black text-purple-950 dark:text-purple-100 uppercase mb-6">Editar {editing.nome}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">Preço Venda (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold" 
                    value={editing.preco} 
                    onChange={e => setEditing({...editing, preco: parseFloat(e.target.value) || 0})} 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">Preço Custo (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    placeholder="0.00"
                    className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold" 
                    value={editing.preco_custo ?? ''} 
                    onChange={e => setEditing({...editing, preco_custo: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0})} 
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">Categoria</label>
                <input 
                  type="text"
                  list="inventory-categories"
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs" 
                  value={editing.categoria || ''} 
                  onChange={e => setEditing({...editing, categoria: e.target.value})} 
                />
              </div>
              <div className="flex items-center gap-3 bg-gray-50 dark:bg-purple-950/40 p-4 rounded-2xl">
                 <input 
                   type="checkbox" 
                   id="ativo-checkbox"
                   className="w-5 h-5 accent-purple-600 rounded bg-white border-gray-300"
                   checked={editing.ativo !== false}
                   onChange={e => setEditing({...editing, ativo: e.target.checked})}
                 />
                 <label htmlFor="ativo-checkbox" className="text-sm font-black text-gray-800 dark:text-gray-200 uppercase">
                    Produto Ativo no PDV
                 </label>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">Quantidade Atual em Estoque</label>
                <input 
                  type="number" 
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-purple-900 dark:text-amber-300 border-none rounded-2xl px-5 py-4 font-bold text-xl" 
                  value={editing.estoque} 
                  onChange={e => setEditing({...editing, estoque: parseInt(e.target.value) || 0})} 
                />
              </div>
              <button 
                disabled={isSaving}
                onClick={handleUpdateStock} 
                className="w-full bg-purple-900 hover:bg-purple-950 text-white py-5 rounded-2xl font-black uppercase shadow-xl transition-all disabled:opacity-50"
              >
                {isSaving ? 'Salvando...' : 'Confirmar Atualização'}
              </button>
              <button 
                disabled={isSaving}
                onClick={() => setEditing(null)} 
                className="w-full text-[10px] font-bold text-gray-400 uppercase mt-2"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Novo Produto */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-sm shadow-2xl border border-gray-100 dark:border-purple-900/40 animate-in zoom-in-95">
            <h3 className="text-xl font-black text-purple-950 dark:text-purple-100 uppercase mb-6">Novo Produto</h3>
            <div className="space-y-4">
              <input type="text" placeholder="Nome do Lanche/Bebida" className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-5 py-4 font-bold" value={newProd.nome} onChange={e => setNewProd({...newProd, nome: e.target.value})} />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.01" placeholder="Preço Venda" className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold" value={newProd.preco} onChange={e => setNewProd({...newProd, preco: e.target.value})} />
                <input type="number" step="0.01" placeholder="Preço Custo (opcional)" className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold" value={newProd.preco_custo} onChange={e => setNewProd({...newProd, preco_custo: e.target.value})} />
              </div>
              <input type="number" placeholder="Estoque Inicial" className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-5 py-4 font-bold" value={newProd.estoque} onChange={e => setNewProd({...newProd, estoque: e.target.value})} />
              <input type="text" list="inventory-categories" placeholder="Categoria (ex: Doces, Salgados)" className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs" value={newProd.categoria} onChange={e => setNewProd({...newProd, categoria: e.target.value})} />
              <datalist id="inventory-categories">
                 {allCategories.map(c => <option key={c} value={c} />)}
              </datalist>
              <button 
                disabled={isSaving}
                onClick={handleAddProduct} 
                className="w-full bg-green-600 text-white py-5 rounded-2xl font-black uppercase shadow-xl hover:bg-green-700 transition-all disabled:opacity-50"
              >
                {isSaving ? 'Cadastrando...' : 'Cadastrar no Banco'}
              </button>
              <button 
                disabled={isSaving}
                onClick={() => setIsAdding(false)} 
                className="w-full text-[10px] font-bold text-gray-400 uppercase mt-2"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryView;
