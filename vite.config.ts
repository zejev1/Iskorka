import { defineConfig, type Plugin } from 'vite';

/** Fail the release if either executable graph reconnects the old observer. */
function requirePhysicsOnlyGraph(label: string): Plugin {
  return {
    name: `iskorka-isolation-${label}`,
    generateBundle() {
      const modules = [...this.getModuleIds()].map(id => id.replace(/\\/g, '/'));
      const forbidden = modules.filter(id => /\/src\/(cardinal\/|experiment\/|v15\/Cardinal|runtime\/(LiveWorldRuntime|WorldRuntime)\.)/.test(id));
      if (forbidden.length) this.error(`Iskorka imports excluded controllers: ${forbidden.join(', ')}`);
      this.emitFile({ type: 'asset', fileName: `isolation-${label}.json`, source: JSON.stringify({ graph: label, excludedControllers: forbidden, sourceModules: modules.filter(id => id.includes('/src/')).map(id => 'src/' + id.split('/src/')[1]).sort() }, null, 2) });
    },
  };
}
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] },
  plugins: [requirePhysicsOnlyGraph('browser')],
  worker: { format: 'es', plugins: () => [requirePhysicsOnlyGraph('worker')] },
});
