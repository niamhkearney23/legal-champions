# Two-stage Node build for Legal Champions API.
# The server serves both the static site (parent dir) and the API.

FROM node:20-alpine AS deps
WORKDIR /app/api
COPY api/package*.json ./
RUN apk add --no-cache python3 make g++ \
 && npm install --omit=dev \
 && apk del python3 make g++

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/api/node_modules ./api/node_modules
COPY api ./api
COPY index.html demo.html firm.html dashboard.html ./

ENV NODE_ENV=production
ENV PORT=4040
ENV DB_PATH=/data/leads.db

EXPOSE 4040
WORKDIR /app/api
CMD ["node", "server.js"]
