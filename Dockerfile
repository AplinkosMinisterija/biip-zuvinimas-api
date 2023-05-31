FROM node:18-alpine
ENV TZ=Etc/GMT

# Required for dependencies comming from git
RUN apk add --no-cache git

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
