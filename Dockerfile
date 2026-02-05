# Stage 1: Build the React frontend
FROM node:18-alpine as frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Node.js backend
FROM node:18-alpine as backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./

# Stage 3: Final image with Nginx, Node.js and Supervisor
FROM node:18-alpine
RUN apk add --no-cache nginx supervisor

# Copy built frontend and nginx config
COPY --from=frontend-builder /app/frontend/build /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/nginx.conf

# Copy backend
WORKDIR /app
COPY --from=backend-builder /app/backend ./

# Copy and setup supervisor
COPY supervisord.conf /etc/supervisord.conf
EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
