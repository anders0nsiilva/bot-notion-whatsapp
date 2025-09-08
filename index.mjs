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

  const resposta = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(payload ),
  });

  const dadosResposta = await resposta.json();
  if (!resposta.ok) {
    console.error("Erro ao criar entrada no Notion:", JSON.stringify(dadosResposta, null, 2));
  }
  return dadosResposta;
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
      body: JSON.stringify(payload ),
    }
  );

  const dados = await resposta.json();

  if (!dados.results) {
    console.error("Erro ao consultar o Notion. Resposta recebida:", JSON.stringify(dados, null, 2));
    return 0;
  }

  const total = dados.results.reduce((soma, item) => {
    const valorItem = item.properties?.Valor?.number || 0;
    return soma + valorItem;
  }, 0);

  return total;
}

/**
 * Envia uma mensagem de resposta para o usuário via API do WhatsApp.
 * AJUSTADO COM DEBUG AVANÇADO
 */
async function enviarMensagemWhatsApp(para, texto) {
  const payload = {
    messaging_product: "whatsapp",
    to: para,
    text: { body: texto },
  };

  console.log("-> Preparando para enviar para a API do WhatsApp. Payload:", JSON.stringify(payload, null, 2));

  try {
    const respostaAPI = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ),
      }
    );

    const dadosRespostaAPI = await respostaAPI.json();

    if (!respostaAPI.ok) {
      // Se a API retornar um erro (status não for 2xx), vamos logar em detalhes.
      console.error("<- ERRO da API do WhatsApp:", JSON.stringify(dadosRespostaAPI, null, 2));
    } else {
      // Se a API aceitar a solicitação, vamos logar a resposta de sucesso.
      console.log("<- SUCESSO da API do WhatsApp. Resposta:", JSON.stringify(dadosRespostaAPI, null, 2));
    }

  } catch (error) {
    console.error("<- FALHA CRÍTICA ao tentar contatar a API do WhatsApp:", error.message);
  }
}


// --- ROTAS DA API ---

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
      const respostaErro = `Formato inválido. Use: Descrição, Valor, Categoria, Tipo de Pagamento.`;
      await enviarMensagemWhatsApp(numeroRemetente, respostaErro);
      return res.sendStatus(200);
    }

    let [descricao, valorStr, categoria, tipo] = partes;
    
    categoria = categoria.charAt(0).toUpperCase() + categoria.slice(1).toLowerCase();
    tipo = tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase();

    const valor = parseFloat(valorStr.replace(",", "."));

    if (isNaN(valor)) {
        const respostaErro = `O valor "${valorStr}" não é um número. Tente novamente.`;
        await enviarMensagemWhatsApp(numeroRemetente, respostaErro);
        return res.sendStatus(200);
    }

    console.log("Criando entrada no Notion...");
    const resultadoCriacao = await criarEntrada(descricao, valor, categoria, tipo);

    if (resultadoCriacao.object === 'error') {
        console.log(`Falha ao registrar no Notion. O erro já foi logado na função 'criarEntrada'.`);
        await enviarMensagemWhatsApp(numeroRemetente, `❌ Erro ao registrar: a opção "${tipo}" pode não existir na coluna "Tipo". Verifique o Notion.`);
        return res.sendStatus(200);
    }

    const gastoFormatado = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    console.log(`Consultando Notion para o total de: ${tipo}`);
    const totalPorTipo = await calcularTotalPorTipo(tipo);
    const totalFormatado = totalPorTipo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const textoResposta = `✅ Gasto de ${gastoFormatado} registrado!\n\nTotal de gastos com ${tipo}: ${totalFormatado}`;

    // A linha abaixo foi removida para evitar poluir o log, já que a função de envio agora tem seus próprios logs.
    // console.log(`Enviando resposta para ${numeroRemetente}: ${textoResposta}`);
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
