import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache  = {};   // file → gltf result

/**
 * Dosyaları paralel yükler.
 * onProgress(0..1) her yüklemede tetiklenir.
 */
export function preloadModels(files, onProgress) {
  let done = 0;
  const total = files.length;
  return Promise.all(
    files.map(file =>
      new Promise(resolve => {
        loader.load(
          `/models/${file}`,
          gltf => {
            cache[file] = gltf;
            onProgress?.(++done / total);
            resolve();
          },
          undefined,
          err => {
            console.warn('[glbCache] yüklenemedi:', file, err);
            onProgress?.(++done / total);
            resolve(); // hata olsa bile devam et
          }
        );
      })
    )
  );
}

/**
 * Önbellekten derin-klonlanmış bir sahne döndürür.
 * Materyal referansları ayrışır, birden fazla island'da güvenle kullanılabilir.
 */
export function getModel(file) {
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
