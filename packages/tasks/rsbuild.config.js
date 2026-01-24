import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import fs from 'fs';
export default defineConfig({
    plugins: [pluginReact()],
    source: {
        entry: {
            index: './web/src/index.tsx'
        }
    },
    html: {
        template: './web/index.html'
    },
    output: {
        distPath: {
            root: './dist'
        }
    },
    server: {
        port: Number(process.env.RSBUILD_PORT) || 4173,
        host: '0.0.0.0',
        https: {
            key: fs.readFileSync('./certs/dev-key.pem'),
            cert: fs.readFileSync('./certs/dev-cert.pem')
        },
        proxy: {
            '/trpc': {
                target: 'http://localhost:3003',
                changeOrigin: true,
                ws: true,
                secure: false,
                xfwd: true
            },
            '/api': {
                target: 'http://localhost:3003',
                changeOrigin: true
            },
            '/ws': {
                target: 'http://localhost:3003',
                changeOrigin: true,
                ws: true
            }
        }
    }
});
//# sourceMappingURL=rsbuild.config.js.map