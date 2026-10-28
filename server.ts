import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // API Proxy para Mercado Pago (Resolve problemas de CORS no frontend)
  app.post("/api/mercadopago/pix", async (req, res) => {
    try {
      const { transaction_amount, description, token } = req.body;
      
      const response = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Idempotency-Key": Math.random().toString(36).substring(7)
        },
        body: JSON.stringify({
          transaction_amount,
          description,
          payment_method_id: "pix",
          payer: {
            email: "cliente@email.com",
            first_name: "Cliente",
            last_name: "Cantina"
          }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/mercadopago/payment/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.headers.authorization?.split(" ")[1];
      
      if (!token) {
        return res.status(401).json({ error: "Token não fornecido" });
      }

      const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // SUPER SISTEMA: API DE IA & CLOUD ANALYTICS
  // ==========================================
  app.post("/api/ai/ask", async (req, res) => {
    try {
      const { query, context } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Pergunta não informada." });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        // Resposta inteligente local estruturada caso a chave não esteja disponível
        return res.json({
          answer: `[Diagnóstico TUSEMM Cloud] Identifiquei seus dados atuais no sistema: Faturamento acumulado de R$ ${(context?.totalFaturamento || 0).toFixed(2)}, com ${context?.fiadosCount || 0} fiado(s) em aberto totalizando R$ ${(context?.totalFiados || 0).toFixed(2)}. ${context?.lowStockCount > 0 ? `Atenção: ${context?.lowStockCount} produto(s) precisam de reposição de estoque imediata.` : 'Estoque em níveis normais.'}`
        });
      }

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({});

      const systemPrompt = `Você é o Assistente Estratégico de Inteligência Artificial da 'Cantina TUSEMM - Maria Mulambo'.
Você atua como um co-piloto financeiro e operacional para o administrador e equipe da cantina.
Sua missão é fornecer respostas claras, precisas, motivadoras e práticas em português do Brasil.
Você possui acesso ao contexto em tempo real do negócio:
- Faturamento do dia: R$ ${(context?.totalFaturamento || 0).toFixed(2)}
- Quantidade de vendas hoje: ${context?.salesCount || 0}
- Fiados em aberto: ${context?.fiadosCount || 0} registro(s) somando R$ ${(context?.totalFiados || 0).toFixed(2)}
- Produtos com estoque baixo: ${context?.lowStockCount || 0} item(ns) (${(context?.lowStockNames || []).join(', ') || 'Nenhum'})
- Produtos mais vendidos: ${(context?.topProducts || []).join(', ') || 'Sem registros suficientes'}

Instruções de resposta:
- Seja direto, cortês e profissional.
- Use dados reais fornecidos no contexto.
- Forneça recomendações acionáveis para aumentar as vendas, reduzir fiados e evitar falta de estoque.
- Responda em no máximo 3 a 4 parágrafos objetivos.`;

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: query,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.6
        }
      });

      res.json({ answer: aiResponse.text || "Sem resposta gerada." });
    } catch (error: any) {
      console.error("Erro na IA:", error);
      res.status(500).json({ error: error.message || "Erro ao consultar IA." });
    }
  });

  app.post("/api/ai/draft-message", async (req, res) => {
    try {
      const { type, clientName, debtAmount, daysOverdue, items, pixKey } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        const text = `Olá, ${clientName}! Passando para lembrar do seu consumo na Cantina TUSEMM no valor de R$ ${(Number(debtAmount) || 0).toFixed(2)}. Chave PIX: ${pixKey || 'Consulte o caixa'}. Agradecemos e que Maria Mulambo abençoe! 🙏`;
        return res.json({ message: text });
      }

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({});

      const prompt = `Crie uma mensagem curta e simpática para WhatsApp para o cliente da Cantina TUSEMM.
Tipo de mensagem: ${type || 'cobranca_amigavel'}
Nome do cliente: ${clientName}
Valor da dívida: R$ ${(Number(debtAmount) || 0).toFixed(2)}
Dias em aberto: ${daysOverdue || 'Recente'}
Itens comprados: ${items || 'Consumo na cantina'}
Chave PIX da cantina: ${pixKey || 'Não informada'}

Regras:
- Texto pronto para colar no WhatsApp (máximo 4 linhas).
- Tom respeitoso, amigável e caloroso com axé.
- Inclua a chave PIX de forma clara.`;

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt
      });

      res.json({ message: aiResponse.text?.trim() || "" });
    } catch (error: any) {
      console.error("Erro ao gerar mensagem de IA:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Integrar Vite como Middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // For Express 5 compatibility (wildcards must be named)
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
