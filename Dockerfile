FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

RUN npx playwright install --with-deps

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
