FROM node:20-slim

# Instala dependências do Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Define a variável do Puppeteer para usar o Chromium instalado
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]
