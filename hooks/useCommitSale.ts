// hooks/useCommitSale.ts
// Hook para chamar a Edge Function commit_sale e gerenciar UI otimista.
import { useCallback, useRef, useState } from 'react';
import supabase from '../services/supabaseClient';

export type SaleItem = {
  product_id: string;
  quantity: number;
  price: number;
};

export type SalePayload = {
  customer_id: string;
  items: SaleItem[];
  metadata?: Record<string, any> | null;
};

export type CommitResult = {
  sale_id: string;
  total: number;
} | null;

export default function useCommitSale(options?: { revalidateProducts?: boolean }) {
  const inFlight = useRef(false);
  const lastCall = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CommitResult | null>(null);

  const commitSale = useCallback(
    async (payload: SalePayload) => {
      const now = Date.now();
      
      // Prevenção de cliques duplos (debounce básico)
      if (lastCall.current && now - lastCall.current < 1500) {
        return Promise.reject(new Error('Por favor, aguarde antes de enviar novamente.'));
      }
      if (inFlight.current) {
        return Promise.reject(new Error('Uma requisição já está em andamento.'));
      }

      inFlight.current = true;
      lastCall.current = now;
      setLoading(true);
      setError(null);

      try {
        // Chama a Edge Function 'commit_sale'
        const { data: resData, error: resError } = await supabase.functions.invoke('commit_sale', {
          method: 'POST',
          body: { sale: payload },
        });

        if (resError) {
          throw new Error(resError.message ?? 'Erro na Edge Function');
        }

        const result = resData?.result ?? resData;
        setData(result ?? null);

        // Revalidação opcional de estoque após a venda
        if (options?.revalidateProducts) {
          try {
            const ids = payload.items.map((i) => i.product_id);
            await supabase
              .from('products')
              .select('id, current_stock')
              .in('id', ids);
            // Aqui você integraria com seu estado global ou cache (SWR/React Query)
          } catch (err) {
            console.warn('Falha ao revalidar produtos:', err);
          }
        }

        return result;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        setError(msg);
        return Promise.reject(err);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [options?.revalidateProducts]
  );

  return { commitSale, loading, error, data };
}
