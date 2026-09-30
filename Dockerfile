FROM node:22-bookworm-slim

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install --no-save --ignore-scripts prisma@6.16.2
COPY server/prisma ./prisma
RUN npx prisma generate

COPY server/src ./src
COPY *.html *.css *.svg /app/
COPY assets /app/assets

ENV NODE_ENV=production HOST=0.0.0.0 PORT=5500
EXPOSE 5500
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
