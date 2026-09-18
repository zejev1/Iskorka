// Host adapter only. The actual production worker module is imported unchanged.
import 'fake-indexeddb/auto';
import { parentPort } from 'node:worker_threads';
(globalThis as any).self = { postMessage: (data:unknown)=>parentPort!.postMessage(data), onmessage: undefined };
await import('../../src/iskorka/worker');
parentPort!.on('message',data=>(globalThis as any).self.onmessage({data}));
parentPort!.postMessage({type:'harness-ready'});
