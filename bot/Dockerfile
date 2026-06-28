FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY data/ ./data/
COPY firebase.js index.js deploy-commands.js ./
COPY service-account.json ./service-account.json

CMD ["node", "index.js"]
