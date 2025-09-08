import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;

// Função para criar entrada no Notion
async function criarEntrada(descricao, valor, categoria) {
  const payload = {
    parent: { database_id: DATABASE_ID },
    properties: {
      "Descrição": { title: [{ text: { content: descricao } }] },
      "Valor": { number: valor },
      "Categoria": { select: { name: categoria } }
    }
  };

  const resposta = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28"
    },
    body: JSON.stringify(payload)
  });

  return await resposta.json();
}

// Rota para criar entrada no Notion
app.post("/notion", async (req, res) => {
  try {
    const { descricao, valor, categoria } = req.body;
    const resposta = await criarEntrada(descricao, valor, categoria);
    res.json(resposta);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Inicia servidor na porta 8080
app.listen(8080, () => {
  console.log("Servidor rodando na porta 8080");
});
