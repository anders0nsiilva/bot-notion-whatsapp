// Importa as bibliotecas necessárias.
import express from "express";
import fetch from "node-fetch";

// --- CONFIGURAÇÃO INICIAL ---
const app = express();
app.use(express.json());

// Carrega as chaves secretas a partir das Variáveis de Ambiente do Render.
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// --- FUNÇÕES DE LÓGICA DE NEGÓCIO ---

/**
 * Cria uma nova página (entrada) na base de dados do Notion.
 */
async function criarEntrada(descricao, valor, categoria, tipo) {
  const payload = {
    parent: { database_id: DATABASE_ID },
    properties: {
      "Descrição": { title: [{ text: { content: descricao } }] },
      "Valor": { number: valor },
      "Categoria": { select: { name: categoria } },
      "Tipo": { select: { name: tipo } },
    },
  };
  // (O resto da função continua igual)
  const resposta = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(payload),
  });
  return await resposta.json();
}

/**
 * Consulta o Notion e calcula a soma de todos os gastos de um determinado "Tipo".
 */
async function calcularTotalPorTipo(tipo) {
  const payload = {
    filter: {
      property: "Tipo",
      select: {
        equals: tipo,
      },
    },
  };

  const resposta = await fetch(
    `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(payload),
    }
  );

  const dados = await resposta.json();

  // ***** AJUSTE DE ROBUSTEZ *****
  // Verifica se a resposta do Notion foi bem-sucedida e contém a lista "results".
  if (!dados.results) {
    console.error("Erro ao consultar o Notion. Resposta recebida:", JSON.stringify(dados, null, 2));
    // Retorna 0 para não quebrar a aplicação, mesmo que a consulta falhe.
    return 0;
  }

  // Soma a propriedade "Valor" de cada item retornado.
  const total = dados.results.reduce((soma, item) => {
    // Adiciona uma verificação para garantir que a propriedade existe antes de somar.
    const valorItem = item.properties?.Valor?.number || 0;
    return soma + valorItem;
  }, 0);

  return total;
}

/**
 * Envia uma mensagem de resposta para o usuário via API do WhatsApp.
 */
async function enviarMensagemWhatsApp(para, texto) {
  const payload = {
    messaging_product: "whatsapp",
    to: para,
    text: { body: texto },
  };

  await fetch(
    `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
}

// --- ROTAS DA API ---

// Rota para a verificação do Webhook (requisição GET)
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

// Rota principal para receber as mensagens do WhatsApp (requisição POST)
app.post("/notion", async (req, res) => {
  console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

  try {
    const messageObject = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!messageObject || messageObject.type !== 'text') {
      console.log("Não é uma mensagem de texto ou formato desconhecido.");
      return res.sendStatus(200);
    }
    
    const textoDaMensagem = messageObject.text.body;
    const numeroRemetente = messageObject.from;
    console.log(`Texto extraído de ${numeroRemetente}: ${textoDaMensagem}`);

    const partes = textoDaMensagem.split(",").map(part => part.trim());

    if (partes.length !== 4) {
      console.log("A mensagem não está no formato esperado (Descrição, Valor, Categoria, Tipo).");
      const respostaErro = `Formato inválido. Use: Descrição, Valor, Categoria, Tipo de Pagamento.`;
      await enviarMensagemWhatsApp(numeroRemetente, respostaErro);
      return res.sendStatus(200);
    }

    const [descricao, valorStr, categoria, tipo] = partes;
    const valor = parseFloat(valorStr.replace(",", "."));

    if (isNaN(valor)) {
        const respostaErro = `O valor "${valorStr}" não é um número. Tente novamente.`;
        await enviarMensagemWhatsApp(numeroRemetente, respostaErro);
        return res.sendStatus(200);
    }

    console.log("Criando entrada no Notion...");
    await criarEntrada(descricao, valor, categoria, tipo);
    const gastoFormatado = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    console.log(`Consultando Notion para o total de: ${tipo}`);
    const totalPorTipo = await calcularTotalPorTipo(tipo);
    const totalFormatado = totalPorTipo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const textoResposta = `✅ Gasto de ${gastoFormatado} registrado!\n\nTotal de gastos com ${tipo}: ${totalFormatado}`;

    console.log(`Enviando resposta para ${numeroRemetente}: ${textoResposta}`);
    await enviarMensagemWhatsApp(numeroRemetente, textoResposta);

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
