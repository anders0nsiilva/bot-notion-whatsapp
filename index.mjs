/**
 * Servidor de Integração v2: Notion-WhatsApp com Resposta Automática
 *
 * Funcionalidades:
 * 1. Recebe mensagens do WhatsApp via Webhook.
 * 2. Valida o webhook da Meta com uma rota GET.
 * 3. Processa mensagens de texto no formato "Descrição, Valor, Categoria, Tipo".
 * 4. Cria uma nova entrada na base de dados do Notion.
 * 5. Após criar, consulta o Notion para calcular o total de gastos para o "Tipo" informado.
 * 6. Envia uma mensagem de resposta no WhatsApp com o total calculado.
 */

// Importa as bibliotecas necessárias.
import express from "express";
import fetch from "node-fetch";

// Inicializa a aplicação Express.
const app = express();
app.use(express.json());

// --- CARREGAMENTO DE CHAVES SECRETAS (VARIÁVEIS DE AMBIENTE) ---
// Chaves para a API do Notion
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;

// Chaves para a API do WhatsApp (Meta)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;


// --- FUNÇÕES DE INTERAÇÃO COM APIS EXTERNAS ---

/**
 * Cria uma nova entrada (página) na base de dados do Notion.
 * @param {string} descricao - A descrição da despesa.
 * @param {number} valor - O valor numérico da despesa.
 * @param {string} categoria - A categoria da despesa.
 * @param {string} tipo - O tipo de pagamento (ex: Crédito, Débito, Pix).
 */
async function criarEntradaNotion(descricao, valor, categoria, tipo) {
  console.log("Criando entrada no Notion...");
  const payload = {
    parent: { database_id: DATABASE_ID },
    properties: {
      "Descrição": { title: [{ text: { content: descricao } }] },
      "Valor": { number: valor },
      "Categoria": { select: { name: categoria } },
      "Tipo": { select: { name: tipo } }, // Nova propriedade "Tipo"
    },
  };

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(payload),
  });

  return response.json();
}

/**
 * Consulta a base de dados do Notion para somar os valores de um tipo de pagamento.
 * @param {string} tipoPagamento - O tipo de pagamento a ser filtrado (ex: "Crédito").
 * @returns {Promise<number>} - A soma total dos valores para o tipo especificado.
 */
async function calcularTotalPorTipo(tipoPagamento) {
  console.log(`Consultando Notion para o total de: ${tipoPagamento}`);
  const payload = {
    filter: {
      property: "Tipo",
      select: {
        equals: tipoPagamento,
      },
    },
  };

  const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  // Soma a propriedade "Valor" de cada item retornado pela consulta.
  const total = data.results.reduce((sum, page) => {
    const valorProperty = page.properties.Valor;
    if (valorProperty && valorProperty.number !== null) {
      return sum + valorProperty.number;
    }
    return sum;
  }, 0);

  return total;
}

/**
 * Envia uma mensagem de texto de volta para o usuário no WhatsApp.
 * @param {string} recipientId - O número de telefone do destinatário.
 * @param {string} messageText - O texto da mensagem a ser enviada.
 */
async function enviarMensagemWhatsApp(recipientId, messageText) {
  console.log(`Enviando resposta para ${recipientId}: "${messageText}"`);
  const payload = {
    messaging_product: "whatsapp",
    to: recipientId,
    text: { body: messageText },
  };

  try {
    const response = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    const responseData = await response.json();
    console.log("Resposta da API do WhatsApp:", responseData);
  } catch (error) {
    console.error("Erro ao enviar mensagem no WhatsApp:", error);
  }
}


// --- ROTAS DO SERVIDOR ---

// Rota GET para verificação do Webhook da Meta.
app.get("/notion", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(400);
  }
});

// Rota POST principal para receber mensagens do WhatsApp.
app.post("/notion", async (req, res) => {
  console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

  try {
    const messageObject = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!messageObject || messageObject.type !== 'text') {
      console.log("Não é uma mensagem de texto ou formato desconhecido.");
      return res.sendStatus(200);
    }

    const textoDaMensagem = messageObject.text.body;
    const remetente = messageObject.from; // Número de quem enviou a mensagem
    console.log(`Texto extraído de ${remetente}: ${textoDaMensagem}`);

    // NOVO FORMATO: "Descrição, Valor, Categoria, Tipo"
    const partes = textoDaMensagem.split(",").map(part => part.trim());

    if (partes.length !== 4) {
      console.log("A mensagem não está no formato esperado (Descrição, Valor, Categoria, Tipo).");
      const formatoCorreto = "Formato esperado: Descrição, Valor, Categoria, Tipo de Pagamento (Ex: Crédito, Débito, Pix)";
      await enviarMensagemWhatsApp(remetente, formatoCorreto);
      return res.sendStatus(200);
    }

    const [descricao, valorStr, categoria, tipo] = partes;
    const valor = parseFloat(valorStr.replace(",", "."));

    if (isNaN(valor)) {
      console.log(`O valor "${valorStr}" não é um número válido.`);
      await enviarMensagemWhatsApp(remetente, `O valor "${valorStr}" não é um número válido.`);
      return res.sendStatus(200);
    }

    // 1. Cria a entrada no Notion
    await criarEntradaNotion(descricao, valor, categoria, tipo);

    // 2. Calcula o total para o tipo de pagamento informado
    const totalPorTipo = await calcularTotalPorTipo(tipo);

    // 3. Formata a mensagem de resposta
    const resposta = `✅ Gasto de R$ ${valor.toFixed(2)} registrado! \n\nTotal de gastos com ${tipo}: R$ ${totalPorTipo.toFixed(2)}`;

    // 4. Envia a resposta de volta para o WhatsApp
    await enviarMensagemWhatsApp(remetente, resposta);

    res.sendStatus(200);

  } catch (err) {
    console.error("Erro na rota /notion:", err.message);
    res.sendStatus(500);
  }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
