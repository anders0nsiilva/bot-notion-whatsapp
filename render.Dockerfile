# Use a imagem base do Node.js oficial e otimizada
FROM node:20-slim

# Instala apenas as dependências mínimas necessárias para o Chromium que a biblioteca vai baixar
RUN apt-get update \
    && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia os arquivos de dependências
COPY package*.json ./

# Instala as dependências do Node.js. A whatsapp-web.js irá baixar o Chromium aqui.
RUN npm install

# Copia o resto do código da aplicação
COPY . .

# Comando para iniciar a aplicação
CMD ["npm", "start"]
