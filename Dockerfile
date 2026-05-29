# Use the official lightweight Node.js 20 image
FROM node:20-alpine

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy local code to the container image
COPY . .

# Ensure the CSV file can be created and written to
RUN touch price_history.csv && chmod 666 price_history.csv

# Run the web service on container startup
CMD [ "node", "server.js" ]

# Tell Docker about the port we'll run on
EXPOSE 3000
