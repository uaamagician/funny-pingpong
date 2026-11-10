import { defineConfig } from 'vite';

// GitHub Pages 的網址是 /funny-pingpong/ 底下；本機開發維持根路徑。
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/funny-pingpong/' : '/',
});
