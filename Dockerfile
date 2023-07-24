# Stage 1: Base image
FROM node:18-alpine as base

# Required for dependencies coming from git
RUN apk add --no-cache git

# Stage 2: Builder image
FROM base as builder

# Set the working directory
WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --immutable --immutable-cache --inline-builds --production=false

# Copy source
COPY . .

# Build the application
RUN yarn build

# Copy DB migrations
COPY database ./dist/database

# Stage 3: Final production image
FROM base

# Set the working directory
WORKDIR /app

# Install only production dependencies
COPY package.json yarn.lock ./
RUN yarn install --immutable --immutable-cache --inline-builds --production \
    && yarn cache clean

# Copy built artifacts from builder stage
COPY --from=builder /app/dist/ ./dist/

# Dokcer build args and environment variables
ARG VERSION
ARG ENVIRONMENT

# Set default environment variables
ENV NODE_ENV=production
ENV TZ=Etc/GMT

# Expose application port
EXPOSE 3000

# Start the server
CMD ["sh", "-c", "yarn start"]
