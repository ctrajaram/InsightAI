/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow cross-origin requests during development
    allowedDevOrigins: ['127.0.0.1'],
  },
  // Add any other Next.js configuration options here
};

module.exports = nextConfig;
