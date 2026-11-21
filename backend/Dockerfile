# Sweet Creatures API (Node.js) - listens on port 3000 inside the container
FROM node:20-alpine

WORKDIR /app/backend
ENV NODE_ENV=production

# Install dependencies first so Docker can cache this step
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Then copy the source code
COPY src ./src

EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
