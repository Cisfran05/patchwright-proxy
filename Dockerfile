FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN apt-get update && \
    apt-get install -y xvfb

EXPOSE 10000

CMD ["node", "-e", "const http=require('http');http.createServer((req,res)=>res.end('ok')).listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('Listening'))"]


