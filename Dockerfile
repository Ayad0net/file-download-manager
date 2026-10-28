FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lock ./
# Local stub package referenced from package.json (disables native WebRTC for the torrent engine).
COPY stubs ./stubs
RUN bun install
COPY . .
EXPOSE 8080
# Optional: BitTorrent incoming peer connections (TCP) and DHT (UDP).
EXPOSE 6881/tcp 6881/udp
CMD ["bun", "run", "start"]
