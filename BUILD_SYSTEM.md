# Build System Documentation

## Overview

This project now has a complete TypeScript build and testing infrastructure that supports both development and production environments.

## Build Scripts

### Development Scripts
- `yarn run build` - Compiles TypeScript to JavaScript in `dist/` directory
- `yarn run build:watch` - Watches for changes and recompiles automatically
- `yarn run typecheck` - Runs TypeScript type checking without emitting files
- `yarn run test` - Runs the test suite using tsx for TypeScript execution
- `yarn run test:dev` - Alternative test runner for development

### Production Scripts
- `yarn run worker:prod` - Runs the compiled daemon from `dist/daemon.js`
- `yarn run mcp-server:prod` - Runs the compiled MCP server from `dist/mcp-server.js`

### Utility Scripts
- `yarn run clean` - Removes the `dist/` directory
- `yarn run lint` - Placeholder for linting (currently shows message)

## TypeScript Configuration

The project uses two TypeScript configurations:

### `tsconfig.json`
- Main configuration for development
- Supports running TypeScript files directly with Node.js
- Used by IDE and development tools

### `tsconfig.build.json`
- Production build configuration
- Compiles to ES2020 modules with proper resolution
- Generates declaration files and source maps
- Excludes test files and web frontend

## Build Process

1. **Compilation**: TypeScript files are compiled to JavaScript
2. **Import Fixing**: Post-processing adds `.js` extensions for ES module compatibility
3. **Output**: Generated files in `dist/` with proper module structure

## Testing

### Development Testing
```bash
yarn run test
```
- Uses tsx to run TypeScript directly
- Full source maps and debugging support
- Tests core ProductManager functionality

### Production Testing
```bash
yarn run build && yarn run test:prod
```
- Tests compiled JavaScript output
- Ensures production builds work correctly

## File Structure

```
dist/
├── *.js              # Compiled JavaScript files
├── *.d.ts           # TypeScript declaration files
├── *.js.map          # Source maps
└── scripts/          # Compiled test scripts
```

## ES Module Compatibility

The build system ensures:
- All relative imports include `.js` extensions
- Proper ES2020 module format
- Compatibility with Node.js ES module loader
- Source map support for debugging

## Development Workflow

1. **Development**: Use `yarn run worker` for hot reloading
2. **Testing**: Use `yarn run test` for immediate feedback
3. **Building**: Use `yarn run build` for production compilation
4. **Production**: Use `yarn run worker:prod` for deployment

## Troubleshooting

### Build Issues
- Clear `dist/` directory: `yarn run clean`
- Check TypeScript configuration: `yarn run typecheck`
- Verify dependencies: `yarn install`

### Import Errors
- The build process automatically fixes import extensions
- Ensure all imports use relative paths with `.js` extensions in production

### Database Lock Issues
- Clear LevelDB: `rm -rf db/`
- Only one daemon instance can run at a time

## Dependencies

### Build Dependencies
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution runtime (dev)

### Runtime Dependencies
- All production dependencies are in `package.json`
- No build-time dependencies required in production

This build system provides a robust foundation for both development and production deployment of the Task Manager application.