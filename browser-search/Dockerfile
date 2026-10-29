# Imagem oficial do Playwright já traz Chromium e as libs do sistema (o kanban é Alpine e
# não tem nada disso, por isso o serviço é separado).
FROM mcr.microsoft.com/playwright:v1.48.0-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV PORT=3100
EXPOSE 3100
USER pwuser
CMD ["node", "server.js"]
