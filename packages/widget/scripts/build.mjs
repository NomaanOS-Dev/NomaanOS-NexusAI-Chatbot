import { execSync } from 'child_process';

console.log('1. Building library bundle (ESM + CJS)...');
execSync('npx vite build', { stdio: 'inherit' });

console.log('2. Building standalone UMD bundle (with bundled React for script tags)...');
execSync('npx vite build', {
  stdio: 'inherit',
  env: { ...process.env, BUILD_TARGET: 'standalone' },
});

console.log('3. Emitting TypeScript declaration files...');
execSync('npx tsc --emitDeclarationOnly', { stdio: 'inherit' });

console.log('Nexus Widget build completed successfully!');

