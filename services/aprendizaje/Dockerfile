FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY services ./services
RUN npm ci --include=dev && npm run build --workspace=@hci-ia-lab/aprendizaje && npm prune --omit=dev
USER node
EXPOSE 3002
CMD ["node","services/aprendizaje/dist/main.js"]
