/**
 * @type {import('next').NextConfig}
 * GitHub Pages 部署：设置环境变量 DEPLOY_TO_PAGES=1 时启用静态导出。
 * 本地 `npm run dev` / `npm start` 不受影响（Pages 只支持纯静态站点，
 * 本项目无 API 路由/SSR，localStorage 均在浏览器端）。
 */
const isPagesDeploy = process.env.DEPLOY_TO_PAGES === '1';

const nextConfig = {
  reactStrictMode: true,
  ...(isPagesDeploy
    ? {
        output: 'export',
        // GitHub Pages 项目站路径前缀：https://piggywu981.github.io/ie-research-simulation/
        basePath: '/ie-research-simulation',
        images: { unoptimized: true },
      }
    : {}),
}

module.exports = nextConfig
