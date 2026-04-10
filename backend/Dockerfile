FROM node:18-alpine

# Install Python3 + pip for rfb_import.py
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

COPY package*.json ./
RUN npm install

# Install Python dependencies for RFB import script
COPY scripts/requirements.txt ./scripts/
RUN pip3 install --break-system-packages --no-cache-dir -r scripts/requirements.txt

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
