import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache  = {};   // file → gltf result

/**
 * Dosyaları paralel yükler.
 * onProgress(0..1) her yüklemede tetiklenir.
 */
export async function preloadModels(files, onProgress) {
  let done = 0;
  const total = files.length;
  if (total === 0) return Promise.resolve();

  // Parallel loading with a concurrency limit.
  // Larger levels (e.g. 735 files) need higher concurrency to avoid long waits.
  const limit = 24;
  const results = [];
  const queue = [...files];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      const [rawFile] = file.split('|');
      await new Promise(resolve => {
        loader.load(
          `/models/${rawFile}`,
          gltf => {
            cache[rawFile] = gltf;
            onProgress?.(++done / total);
            resolve();
          },
          undefined,
          err => {
            console.warn('[glbCache] failed to load:', file, err);
            onProgress?.(++done / total);
            resolve();
          }
        );
      });
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, total); i++) {
    workers.push(worker());
  }
  return Promise.all(workers);
}

/**
 * Önbellekten derin-klonlanmış bir sahne döndürür.
 * Materyal referansları ayrışır, birden fazla island'da güvenle kullanılabilir.
 */
export function getModel(fileEntry) {
  const [file] = fileEntry.split('|');
  const cached = cache[file];
  if (!cached) return null;

  const clone = cached.scene.clone(true);

  // Materyalleri derin klonla (her model kendi materyaline sahip olsun)
  clone.traverse(node => {
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material)
      ? node.material.map(m => m.clone())
      : node.material.clone();
  });

  return clone;
}

export function isReady(file) {
  return file in cache;
}
