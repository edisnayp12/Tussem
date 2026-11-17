import React, { useState, useMemo } from 'react';
import { Product, User, Category, UserRole } from '../types';
import { useFeedback } from './FeedbackProvider';
import { parseLocaleNumber } from '../utils/browserUtils';

interface InventoryViewProps {
  products: Product[];
  onUpdateProduct: (p: Product) => Promise<void>;
  onAddProduct: (p: any) => Promise<void>;
  onDeleteProduct?: (id: string, name: string) => Promise<void>;
  onResetDemoData?: () => Promise<void>;
  currentUser: User;
}

interface EditDraft {
  product: Product;
  nome: string;
  preco: string;
  preco_custo: string;
  estoque: string;
  categoria: string;
  codigo: string;
  ativo: boolean;
}

const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  onUpdateProduct,
  onAddProduct,
  onDeleteProduct,
  onResetDemoData,
  currentUser
}) => {
  const { showToast, confirmAction } = useFeedback();
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todos');

  const isAdmin = currentUser?.perfil === UserRole.ADMIN || currentUser?.id === 'super-admin';

  const [newProd, setNewProd] = useState({
    nome: '',
    preco: '',
    preco_custo: '',
    estoque: '0',
    categoria: 'Salgados' as string,
    codigo: ''
  });

  const allCategories = useMemo(
    () =>
      Array.from(
        new Set([
          'Salgados',
          'Bebidas',
          'Doces',
          'Combos',
          ...Object.values(Category),
          ...products.map((p) => p.categoria)
        ])
      ).filter(Boolean),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCat = categoryFilter === 'Todos' || p.categoria === categoryFilter;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        (p.nome || '').toLowerCase().includes(q) ||
        (p.codigo || '').toLowerCase().includes(q) ||
        (p.codigo_barras || '').toLowerCase().includes(q)
      );
    });
  }, [products, searchTerm, categoryFilter]);

  const openEditModal = (p: Product) => {
    setEditDraft({
      product: p,
      nome: p.nome || '',
      preco: String(p.preco ?? 0),
      preco_custo: p.preco_custo !== undefined ? String(p.preco_custo) : '',
      estoque: String(p.estoque ?? 0),
      categoria: p.categoria || Category.OTHERS,
      codigo: p.codigo || p.codigo_barras || '',
      ativo: p.ativo !== false
    });
  };

  const handleDelete = async (productId: string, productName: string) => {
    if (!onDeleteProduct) return;
    const confirmed = await confirmAction({
      title: 'Excluir Produto',
      message: `Tem certeza que deseja excluir o produto "${productName}"?`,
      confirmLabel: 'Excluir',
      destructive: true
    });
    if (!confirmed) return;

    setIsSaving(true);
    try {
      await onDeleteProduct(productId, productName);
      showToast(`Produto "${productName}" removido.`, 'success');
    } catch (e: any) {
      showToast('Erro ao excluir: ' + (e.message || 'Erro desconhecido'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddProduct = async () => {
    if (!newProd.nome.trim() || !newProd.preco.trim()) {
      showToast('Preencha nome e preço do produto.', 'warning');
      return;
    }
    const parsedPrice = parseLocaleNumber(newProd.preco);
    if (parsedPrice < 0) {
      showToast('Informe um preço de venda válido.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      await onAddProduct({
        nome: newProd.nome.trim(),
        preco: parsedPrice,
        preco_custo: newProd.preco_custo.trim() ? parseLocaleNumber(newProd.preco_custo) : 0,
        estoque: Math.round(parseLocaleNumber(newProd.estoque)),
        categoria: newProd.categoria || Category.OTHERS,
        codigo: newProd.codigo.trim() || '',
        ativo: true
      });
      setIsAdding(false);
      setNewProd({ nome: '', preco: '', preco_custo: '', estoque: '0', categoria: Category.OTHERS, codigo: '' });
      showToast('Produto cadastrado com sucesso!', 'success');
    } catch (e: any) {
      showToast('Erro ao adicionar produto: ' + (e.message || 'Erro desconhecido'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStock = async () => {
    if (!editDraft) return;
    const cleanNome = editDraft.nome.trim();
    if (!cleanNome) {
      showToast('O nome do produto não pode ficar em branco!', 'warning');
      return;
    }
    const parsedPrice = parseLocaleNumber(editDraft.preco);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      showToast('Informe um preço de venda válido!', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const updated: Product = {
        ...editDraft.product,
        nome: cleanNome,
        preco: parsedPrice,
        preco_custo: editDraft.preco_custo.trim() ? parseLocaleNumber(editDraft.preco_custo) : undefined,
        estoque: Math.round(parseLocaleNumber(editDraft.estoque)),
        categoria: editDraft.categoria.trim() || Category.OTHERS,
        codigo: editDraft.codigo.trim() || '',
        ativo: editDraft.ativo
      };
      await onUpdateProduct(updated);
      setEditDraft(null);
      showToast(`"${cleanNome}" atualizado!`, 'success');
    } catch (e: any) {
      showToast('Erro ao atualizar produto: ' + (e.message || 'Erro desconhecido'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h2 className="text-2xl font-black text-purple-950 dark:text-purple-200 uppercase tracking-tighter">
            Inventário & Precificação
          </h2>
          <p className="text-[10px] text-gray-400 dark:text-purple-300/60 font-bold uppercase mt-1">
            Gestão de Estoque, Preço de Custo e Venda
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && onResetDemoData && (
            <button
              type="button"
              onClick={onResetDemoData}
              className="bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/50 px-4 py-3 rounded-2xl font-black text-[10px] uppercase hover:bg-red-100 transition-all shrink-0"
            >
              <i className="fa-solid fa-rotate-left mr-1.5"></i>
              Resetar dados de demonstração
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="bg-purple-900 dark:bg-purple-700 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:bg-black transition-all shrink-0"
          >
            Novo Item
          </button>
        </div>
      </div>

      {/* Busca e Filtro por Categoria */}
      <div className="bg-white dark:bg-[#160e2b] p-4 rounded-3xl shadow-sm border border-gray-100 dark:border-purple-900/40 space-y-3">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
          <input
            type="text"
            placeholder="Buscar produto por nome ou código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 dark:bg-[#20143a] rounded-2xl pl-10 pr-4 py-3 text-xs font-bold text-gray-900 dark:text-white outline-none"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {['Todos', ...allCategories].map((cat) => (
            <button
              type="button"
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all ${
                categoryFilter === cat
                  ? 'bg-purple-900 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-[#20143a] text-gray-500 dark:text-purple-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredProducts.map((p) => {
          const lucroUnit = (p.preco || 0) - (p.preco_custo || 0);
          const margemPct = p.preco && p.preco > 0 ? (lucroUnit / p.preco) * 100 : 0;
          return (
            <div
              key={p.id}
              className="bg-white dark:bg-[#160e2b] p-6 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40 flex justify-between items-center group hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-4 min-w-0 pr-2">
                <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 flex items-center justify-center text-xl shrink-0">
                  <i className="fa-solid fa-box"></i>
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-gray-800 dark:text-gray-100 uppercase leading-none truncate">
                    {p.nome}
                  </h4>
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
              <div className="text-right shrink-0">
                <div className={`text-2xl font-black ${(p.estoque || 0) <= 5 ? 'text-red-500' : 'text-purple-950 dark:text-purple-200'}`}>
                  {p.estoque || 0}
                </div>
                <button
                  type="button"
                  onClick={() => openEditModal(p)}
                  className="text-[9px] font-black uppercase text-purple-500 hover:text-purple-700 dark:text-purple-300 dark:hover:text-amber-300 underline"
                >
                  Editar Item
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id, p.nome)}
                    className="text-[9px] font-black uppercase text-red-400 hover:text-red-700 underline ml-3"
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
      {editDraft && (
        <div
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto"
          onClick={() => !isSaving && setEditDraft(null)}
        >
          <div
            className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-sm shadow-2xl border border-gray-100 dark:border-purple-900/40 animate-in zoom-in-95 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-black text-purple-950 dark:text-purple-100 uppercase mb-6">Editar Produto</h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">
                  Nome do Produto
                </label>
                <input
                  type="text"
                  placeholder="Nome do Produto / Lanche / Bebida"
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border border-gray-200 dark:border-purple-800/40 rounded-2xl px-4 py-3 font-bold text-sm focus:outline-none focus:border-purple-600"
                  value={editDraft.nome}
                  onChange={(e) => setEditDraft({ ...editDraft, nome: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">
                    Preço Venda (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold"
                    value={editDraft.preco}
                    onChange={(e) => setEditDraft({ ...editDraft, preco: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">
                    Preço Custo (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold"
                    value={editDraft.preco_custo}
                    onChange={(e) => setEditDraft({ ...editDraft, preco_custo: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">
                    Categoria
                  </label>
                  <input
                    type="text"
                    list="inventory-categories"
                    className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold uppercase text-xs"
                    value={editDraft.categoria}
                    onChange={(e) => setEditDraft({ ...editDraft, categoria: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">
                    Cód. Barras (Opc.)
                  </label>
                  <input
                    type="text"
                    placeholder="EAN / Código"
                    className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold text-xs"
                    value={editDraft.codigo}
                    onChange={(e) => setEditDraft({ ...editDraft, codigo: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 bg-gray-50 dark:bg-purple-950/40 p-4 rounded-2xl">
                <input
                  type="checkbox"
                  id="ativo-checkbox"
                  className="w-5 h-5 accent-purple-600 rounded bg-white border-gray-300"
                  checked={editDraft.ativo}
                  onChange={(e) => setEditDraft({ ...editDraft, ativo: e.target.checked })}
                />
                <label htmlFor="ativo-checkbox" className="text-sm font-black text-gray-800 dark:text-gray-200 uppercase">
                  Produto Ativo no PDV
                </label>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 dark:text-purple-300/70 mb-1 block ml-2">
                  Quantidade Atual em Estoque
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-purple-900 dark:text-amber-300 border-none rounded-2xl px-5 py-4 font-bold text-xl"
                  value={editDraft.estoque}
                  onChange={(e) => setEditDraft({ ...editDraft, estoque: e.target.value })}
                />
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleUpdateStock}
                className="w-full bg-purple-900 hover:bg-purple-950 text-white py-5 rounded-2xl font-black uppercase shadow-xl transition-all disabled:opacity-50"
              >
                {isSaving ? 'Salvando...' : 'Confirmar Atualização'}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setEditDraft(null)}
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
        <div
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto"
          onClick={() => !isSaving && setIsAdding(false)}
        >
          <div
            className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-sm shadow-2xl border border-gray-100 dark:border-purple-900/40 animate-in zoom-in-95 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-black text-purple-950 dark:text-purple-100 uppercase mb-6">Novo Produto</h3>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Nome do Lanche/Bebida"
                className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-5 py-4 font-bold"
                value={newProd.nome}
                onChange={(e) => setNewProd({ ...newProd, nome: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Preço Venda (ex: 5,00)"
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold"
                  value={newProd.preco}
                  onChange={(e) => setNewProd({ ...newProd, preco: e.target.value })}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Preço Custo (opc.)"
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold"
                  value={newProd.preco_custo}
                  onChange={(e) => setNewProd({ ...newProd, preco_custo: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Estoque Inicial"
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold"
                  value={newProd.estoque}
                  onChange={(e) => setNewProd({ ...newProd, estoque: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Código Barras (opc.)"
                  className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-4 py-3 font-bold text-xs"
                  value={newProd.codigo}
                  onChange={(e) => setNewProd({ ...newProd, codigo: e.target.value })}
                />
              </div>
              <input
                type="text"
                list="inventory-categories"
                placeholder="Categoria (ex: Lanches, Refrigerantes)"
                className="w-full bg-gray-50 dark:bg-purple-950/40 text-gray-900 dark:text-white border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs"
                value={newProd.categoria}
                onChange={(e) => setNewProd({ ...newProd, categoria: e.target.value })}
              />
              <datalist id="inventory-categories">
                {allCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleAddProduct}
                className="w-full bg-green-600 text-white py-5 rounded-2xl font-black uppercase shadow-xl hover:bg-green-700 transition-all disabled:opacity-50"
              >
                {isSaving ? 'Cadastrando...' : 'Cadastrar no Banco'}
              </button>
              <button
                type="button"
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
