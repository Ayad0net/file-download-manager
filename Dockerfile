FROM oven/bun:latest
WORKDIR /app
# YouTube / TikTok downloads: yt-dlp (needs python3) plus ffmpeg for merging HD video + audio.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
# Local stub package referenced from package.json (disables native WebRTC for the torrent engine).
COPY stubs ./stubs
RUN bun install
COPY . .
EXPOSE 8080
# Optional: BitTorrent incoming peer connections (TCP) and DHT (UDP).
EXPOSE 6881/tcp 6881/udp
CMD ["bun", "run", "start"]
