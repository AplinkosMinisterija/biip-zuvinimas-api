FROM node:19
ENV TZ=Etc/GMT

# Working directory
WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# Build and cleanup
ENV NODE_ENV=production
RUN yarn build

# Start server
ENTRYPOINT ["sh", "-c", "yarn db:migrate && yarn start"]
