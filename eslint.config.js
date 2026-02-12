import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
    js.configs.recommended,
    {
        files: ["src/**/*.ts", "packages/appshell/src/**/*.ts", "packages/appshell/src/**/*.tsx"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module"
            },
            globals: {
                console: "readonly",
                process: "readonly",
                Buffer: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                module: "readonly",
                require: "readonly"
            }
        },
        plugins: {
            "@typescript-eslint": tseslint
        },
        rules: {
            "indent": "off",
            "quotes": ["error", "double"],
            "semi": ["error", "always"],
            "@typescript-eslint/no-unused-vars": "warn",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "no-undef": "off"
        }
    },
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "*.js",
            "test-integration-db/**",
            ".playwright-browsers/**",
            "scripts/**",
            "public/**",
            "plugins/**",
            "rsbuild.config.*",
            "*.config.*",
            "unlock-*.ts",
            "comprehensive-*.ts",
            "emergency-*.ts",
            "daemon-*.ts",
            "quick-*.ts",
            "prevent-*.ts",
            "test-*.ts",
            "test-*.js"
        ]
    }
];
