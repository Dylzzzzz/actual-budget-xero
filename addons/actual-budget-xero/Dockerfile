FROM node:20-alpine

LABEL maintainer="actual-xero-sync"
LABEL description="Home Assistant Add-on to sync business transactions from Actual Budget to Xero via Xano"
LABEL version="1.0.0"

# Install Python and build tools for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production && npm cache clean --force

COPY src/ ./src/
COPY web/ ./web/
COPY config.yaml ./
COPY run.sh ./
COPY index.js ./

RUN mkdir -p /app/logs && \
    chmod -R 755 /app && \
    chmod +x run.sh

# Home Assistant add-ons need root access to read /data/options.json
EXPOSE 8080
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV PORT=8080

CMD ["node", "src/app.js"]
