import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
    plugins: [pluginReact()],
    source: {
        entry: {
            index: "../appshell/src/index.tsx",
        },
    },
    html: {
        template: "../appshell/index.html",
        title: "Isomorphiq - Command Flow",
    },
    output: {
        distPath: {
            root: "./dist",
        },
        assetPrefix: "/",
        filenameHash: true,
    },
    performance: {
        removeConsole: false,
        chunkSplit: {
            strategy: "split-by-experience",
        },
    },
    dev: {
        hmr: false,
    },
    tools: {
        rspack: (config, { env }) => {
            if (env === "production") {
                config.devtool = false;
                if (config.output) {
                    config.output.devtoolModuleFilenameTemplate = undefined;
                }
            }
            return config;
        },
    },
    server: {
        port: Number(process.env.RSBUILD_PORT) || 4200,
        host: "0.0.0.0",
        //https: {
        //  key: fs.readFileSync("./certs/dev-key.pem"),
        //  cert: fs.readFileSync("./certs/dev-cert.pem")
        //},
        proxy: {
            "/trpc": {
                target: "http://localhost:3003",
                changeOrigin: true,
                ws: true,
                secure: false,
                xfwd: true,
            },
            "/api": {
                target: "http://localhost:3003",
                changeOrigin: true,
            },
            "/ws": {
                target: "http://localhost:3003",
                changeOrigin: true,
                ws: true,
            },
        },
    },
});
