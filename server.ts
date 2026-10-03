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
