FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

# Install Chromium and its dependencies
RUN npx patchright install chromium
RUN npx patchright install-deps

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
