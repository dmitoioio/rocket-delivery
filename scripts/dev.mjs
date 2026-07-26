import { context } from 'esbuild';

const ctx = await context({
  entryPoints: ['src/app/main.js'],
  bundle: true,
  sourcemap: true,
  format: 'esm',
  target: ['es2022'],
  outfile: 'dist/app.js',
});

await ctx.watch();

const { host, port } = await ctx.serve({
  servedir: 'public',
  port: 5173,
});

console.log(`▶ Dev-сервер: http://${host}:${port}`);
