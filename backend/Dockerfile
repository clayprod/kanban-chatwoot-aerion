FROM node:18-alpine

# Install Python3 + pip for rfb_import.py
RUN apk add --no-cache curl python3 py3-pip poppler-utils tesseract-ocr tesseract-ocr-data-por tesseract-ocr-data-eng libreoffice

WORKDIR /app

COPY package*.json ./
RUN npm install

# Install Python dependencies for RFB import script
COPY scripts/requirements.txt ./scripts/
RUN pip3 install --break-system-packages --no-cache-dir -r scripts/requirements.txt

COPY . .

# Base PDF fonts are needed both by Poppler rendering/OCR and Word conversion.
RUN apk add --no-cache font-liberation

EXPOSE 3001

CMD ["node", "index.js"]
