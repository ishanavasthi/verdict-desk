import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this app so Next.js doesn't get confused by an
  // outer pnpm-lock.yaml when this repo is checked out as a nested git worktree.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async rewrites() {
    const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
