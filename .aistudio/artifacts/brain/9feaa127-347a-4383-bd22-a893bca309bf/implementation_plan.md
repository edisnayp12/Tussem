# Plano de Evolução e Sugestões: Cantina TUSEMM

Com base na operação atual da Cantina (PDV ágil, controle de fiados via WhatsApp, gestão de clientes unificada por telefone, reservas públicas e KDS de cozinha), elaboramos um plano de evolução estruturado em módulos prioritários para elevar a eficiência, segurança financeira e comodidade da operação.

---

## 🎯 Visão Geral das Sugestões

| Prioridade | Módulo | Objetivo Principal | Impacto Operacional |
| :--- | :--- | :--- | :--- |
| **Alta** | **Controle de Caixa & Fechamento de Turno** | Abertura com fundo de troco, sangrias, suprimentos e conferência cega no fechamento | Evita quebras de caixa e divergências de dinheiro |
| **Alta** | **Comprovante Digital & Recibo no WhatsApp** | Gerar recibo estilizado com 1 clique para enviar direto ao WhatsApp do cliente | Transparência e profissionalismo no atendimento |
| **Média** | **Alertas Sonoros & Notificações KDS** | Sino sonoro e indicador piscante quando entrar nova reserva ou pedido para cozinha | Menor tempo de espera e zero pedidos esquecidos |
| **Média** | **Régua de Cobrança de Fiados** | Filtro por tempo de atraso e envio de mensagens padronizadas em lote com chave PIX | Acelera o recebimento de valores em aberto |
| **Evolutiva** | **Margem de Lucro & Preço de Custo** | Cadastro de custo por produto com cálculo automático de lucratividade no relatório | Visão real do lucro líquido da cantina |

---

## 📋 Detalhamento dos Módulos Propostos

### 1. Módulo de Caixa e Turno de Vendas (Abertura / Fechamento)
- **Abertura de Caixa**: Registro do valor inicial em dinheiro (fundo de troco) no início do expediente.
- **Movimentações Avulsas**: Registro de **Sangria** (retirada de dinheiro para cofre/despesas) e **Suprimento** (adição de troco).
- **Fechamento de Caixa Cego / Conferência**: Ao encerrar o turno, o operador informa o total em dinheiro contado, e o sistema exibe o resumo completo discriminado por forma de pagamento (Dinheiro, PIX, Débito, Crédito e Fiado), apontando se houve sobra ou falta.
- **Histórico de Turnos**: Consulta de todos os fechamentos anteriores com assinatura do operador e exportação do resumo.

### 2. Comprovante de Venda Digital (WhatsApp & Impressão)
- **Recibo Automático**: Ao concluir qualquer venda no PDV ou no Fiado, exibir opção "Enviar Comprovante WhatsApp".
- **Formatação Clara**: Mensagem elegante com cabeçalho da Cantina TUSEMM, itens comprados, quantidade, subtotal, forma de pagamento, data/hora e mensagem de agradecimento.
- **Compatibilidade Térmica**: Botão de impressão simplificado formatado para mini impressoras térmicas (58mm/80mm) ou compartilhamento direto.

### 3. Alertas Sonoros e Visuais no KDS (Cozinha e Reservas)
- **Sinal Sonoro Suave**: Efeito de áudio (bip ou campainha discreta) quando um cliente efetuar uma nova reserva pelo link público ou no PDV.
- **Contador em Destaque**: Contador visual de itens "A Preparar" no topo da tela com distinção de tempo de espera (verde $\rightarrow$ amarelo $\rightarrow$ vermelho para pedidos acima de 15 minutos).

### 4. Régua de Cobrança e Relatório de Fiados
- **Filtro de Inadimplência**: Visualização rápida de clientes fiados com dívidas superiores a 7, 15 ou 30 dias.
- **Mensagem Amigável Personalizada**: Template de mensagem já preenchido com:
  - Nome do cliente;
  - Lista de compras em aberto;
  - Valor total consolidado;
  - Chave PIX e nome do titular da Cantina para facilitar o pagamento imediato pelo cliente.

### 5. Controle de Custo e Lucro Líquido no Estoque
- **Campo de Preço de Custo**: Adicionado ao cadastro de produtos (visível apenas para administradores).
- **Cálculo de Margem**: Margem de contribuição percentual e em reais por produto.
- **Lucro Real nos Relatórios**: O painel de faturamento passará a exibir tanto o Faturamento Bruto quanto o Lucro Líquido Estimado do dia.

---

## 🛠️ Arquitetura e Persistência Técnica

- **Coleções Firestore**:
  - `cash_shifts`: Armazena turnos de caixa (`status: 'aberto' | 'fechado'`, `valor_abertura`, `total_vendas`, `sangrias`, `suprimentos`, `diferenca`).
  - `cash_movements`: Lançamentos de sangrias e reforços.
- **Segurança de Regras (`firestore.rules`)**:
  - Apenas operadores autenticados abrem/fecham turnos; exclusões e edições retroativas restritas ao Administrador (`Tusemm`).
- **Resiliência e Cache**:
  - Continuação do padrão `safeStorage` para garantir funcionamento contínuo mesmo em caso de perda temporária de sinal.

---

## ⚡ Próximos Passos Sugeridos

1. Confirmar qual das melhorias acima você deseja priorizar primeiro.
2. Iniciar a implementação imediata do módulo escolhido mantendo o design temático e todas as rotinas em produção intactas.
