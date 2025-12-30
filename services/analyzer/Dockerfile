FROM node:22-slim

WORKDIR /app
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm i --omit=dev && npm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
