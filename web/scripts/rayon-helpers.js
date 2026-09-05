// wasm-bindgen-rayon's JS hook, with worker ownership delegated to the idle
// coordinator. Terminating a busy runtime does not terminate its nested workers.
export async function startWorkers(module, memory, builder) {
  const ready = new Promise(resolve => {
    self.addEventListener('message', function receive({ data }) {
      if (data.type !== 'pool-ready') return;
      self.removeEventListener('message', receive);
      resolve();
    });
  });
  self.postMessage({ type: 'pool-init', init: { module_or_path: module, memory },
    receiver: builder.receiver(), threads: builder.numThreads() });
  await ready;
  builder.build();
}
