// Importa as bibliotecas necessárias.
import express from "express";
import fetch from "node-fetch";

// Inicializa a aplicação Express e o middleware para JSON.
const app = express();
app.use(express.json());

// Carrega as chaves secretas a partir das Variáveis de Ambiente do Render.
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;

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

// --- ROTA DA API - AGORA ADAPTADA PARA O WHATSAPP ---
app.post("/notion", async (req, res) => {
  // PASSO 1: Logar o corpo da requisição.
  // Esta linha é a mais importante para depuração! Ela vai imprimir nos logs do Render
  // o JSON exato que o WhatsApp enviou, para que possamos ver sua estrutura.
  console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

  try {
    // PASSO 2: Extrair o texto da mensagem do JSON do WhatsApp.
    // A estrutura do JSON pode variar um pouco entre provedores (Meta, Twilio).
    // Este é um exemplo comum para a API da Meta.
    // Navegamos pelo objeto: entry -> changes -> value -> messages -> text -> body
    const messageObject = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    // Se não encontrarmos uma mensagem, apenas encerramos.
    if (!messageObject || messageObject.type !== 'text') {
      console.log("Não é uma mensagem de texto ou formato desconhecido.");
      return res.sendStatus(200); // Responde com 200 OK para o WhatsApp não ficar reenviando.
    }
    
    const textoDaMensagem = messageObject.text.body;
    console.log("Texto extraído:", textoDaMensagem);

    // PASSO 3: Quebrar o texto em partes usando a vírgula como separador.
    // Formato esperado: "Descrição, Valor, Categoria"
    const partes = textoDaMensagem.split(",").map(part => part.trim());

    if (partes.length !== 3) {
      console.log("A mensagem não está no formato esperado (Descrição, Valor, Categoria).");
      return res.sendStatus(200);
    }

    const [descricao, valorStr, categoria] = partes;

    // Converte o valor para número, substituindo vírgula por ponto se necessário.
    const valor = parseFloat(valorStr.replace(",", "."));

    if (isNaN(valor)) {
        console.log(`O valor "${valorStr}" não é um número válido.`);
        return res.sendStatus(200);
    }

    // PASSO 4: Chamar a função do Notion com os dados extraídos.
    console.log(`Enviando para o Notion: ${descricao}, ${valor}, ${categoria}`);
    const respostaNotion = await criarEntrada(descricao, valor, categoria);
    console.log("Resposta do Notion:", respostaNotion);

    // PASSO 5: Responder ao webhook.
    res.sendStatus(200); // Apenas confirma o recebimento com sucesso.

  } catch (err) {
    console.error("Erro na rota /notion:", err.message);
    res.sendStatus(500); // Informa um erro interno.
  }
});

// --- INICIALIZAÇÃO DO SERVIDOR (padrão de produção) ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

