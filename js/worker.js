import { quantize } from './color.js';

self.onmessage = (e) => {
  const { id, rgba, opts } = e.data;
  try {
    const indices = quantize(rgba, opts);
    self.postMessage({ id, indices }, [indices.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
