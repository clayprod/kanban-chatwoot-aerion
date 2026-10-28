# Stage 1: Build the React frontend
FROM node:18-alpine as frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
COPY frontend/.npmrc ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Node.js backend
FROM node:18-alpine as backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/.npmrc ./
RUN npm install
COPY backend/ ./

# Stage 3: Final image with Nginx, Node.js and Supervisor
FROM node:18-alpine
RUN apk add --no-cache curl nginx supervisor python3 py3-pip poppler-utils tesseract-ocr tesseract-ocr-data-por tesseract-ocr-data-eng libreoffice font-liberation

# Copy built frontend and nginx config
COPY --from=frontend-builder /app/frontend/build /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/nginx.conf

# Copy backend
WORKDIR /app
COPY --from=backend-builder /app/backend ./

# Production WordPress deployments consume this bridge from the CI/GHCR image.
COPY integrations/wordpress/aerion-ecommerce-reports.php /opt/aerion-integrations/wordpress/aerion-ecommerce-reports.php

# Install Python dependencies for RFB import script
RUN pip3 install --break-system-packages --no-cache-dir -r scripts/requirements.txt

# Exercise the packaged readers with real PDF/OCR, DOC/DOCX and ZIP fixtures.
# No external requests, paid providers or customer messages are used.
RUN TECHNICAL_DOCUMENT_TEST=1 node --test tests/technicalDocuments.integration.test.js

# Copy and setup supervisor
COPY supervisord.conf /etc/supervisord.conf
EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
