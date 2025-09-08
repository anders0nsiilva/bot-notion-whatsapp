// Importa as bibliotecas necessárias.
import express from "express";
import fetch from "node-fetch";

// Inicializa a aplicação Express e o middleware para JSON.
const app = express();
app.use(express.json());

// Carrega as chaves secretas a partir das Variáveis de Ambiente do Render.
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // Novo token para verificação do webhook

// --- FUNÇÃO PARA CRIAR ENTRADA NO NOTION (não muda) ---
async function criarEntrada(descricao, valor, categoria) {
  const payload = {
    parent: { database_id: DATABASE_ID },
    properties: {
      "Descrição": { title: [{ text: { content: descricao } }] },
      "Valor": { number: valor },
      "Categoria": { select: { name: categoria } },
    },
  };

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

// --- ROTA DE VERIFICAÇÃO DO WEBHOOK (NOVO!) ---
// O WhatsApp (Meta) envia uma requisição GET para esta rota para confirmar que o servidor é seu.
app.get("/notion", (req, res) => {
  // Verifica se o token enviado pelo WhatsApp é o mesmo que configuramos.
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    // Se for, responde com o 'challenge' para validar o webhook.
    res.status(200).send(req.query["hub.challenge"]);
    console.log("Webhook verificado com sucesso!");
  } else {
    // Se não for, recusa a conexão.
    console.error("Falha na verificação do webhook. Tokens não correspondem.");
    res.sendStatus(403);
  }
});


// --- ROTA PARA RECEBER MENSAGENS (Adaptada) ---
app.post("/notion", async (req, res) => {
  console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

  try {
    const messageObject = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!messageObject || messageObject.type !== 'text') {
      console.log("Não é uma mensagem de texto ou formato desconhecido.");
      return res.sendStatus(200);
    }
    
    const textoDaMensagem = messageObject.text.body;
    console.log("Texto extraído:", textoDaMensagem);

    const partes = textoDaMensagem.split(",").map(part => part.trim());

    if (partes.length !== 3) {
      console.log("A mensagem não está no formato esperado (Descrição, Valor, Categoria).");
      return res.sendStatus(200);
    }

    const [descricao, valorStr, categoria] = partes;
    const valor = parseFloat(valorStr.replace(",", "."));

    if (isNaN(valor)) {
        console.log(`O valor "${valorStr}" não é um número válido.`);
        return res.sendStatus(200);
    }

    console.log(`Enviando para o Notion: ${descricao}, ${valor}, ${categoria}`);
    const respostaNotion = await criarEntrada(descricao, valor, categoria);
    console.log("Resposta do Notion:", respostaNotion);

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

