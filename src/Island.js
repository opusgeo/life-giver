import * as THREE from 'three';

/**
 * Tüm diorama objelerini bir THREE.Group içinde tutar.
 * Group'u hareket ettirerek tüm ada yüzer — raycasting etkilenmez.
 */
export class Island {
  constructor(dioramaFn, scene) {
    this.group = new THREE.Group();
    this.objects = [];       // interactable mesh listesi
    this.aliveCount = 0;
    this.floatPhase = Math.random() * Math.PI * 2;
    this._scene = scene;
    
    // Adanın ana (base) koordinatı
    this.baseY = 0;

    this.objects = dioramaFn(this.group);
    this.totalInteractable = this.objects.filter(o => o.userData.interactable).length;

    scene.add(this.group);
  }

  get isComplete() {
    return this.totalInteractable > 0 && this.aliveCount >= this.totalInteractable;
  }

  /** elapsed: THREE.Clock.elapsedTime */
  update(elapsed) {
    // 1. Pürüzsüz Yukarı-Aşağı Salınım
    const floatY = Math.sin(elapsed * 0.3 + this.floatPhase) * 0.15;
    this.group.position.y = this.baseY + floatY;

    // 2. Hafif Yalpalama (Rocking) - Daha "smooth" bir his için
    this.group.rotation.x = Math.sin(elapsed * 0.2 + this.floatPhase) * 0.015;
    this.group.rotation.z = Math.cos(elapsed * 0.25 + this.floatPhase) * 0.012;

    // 3. Su / Buz yüzey animasyonu (varsa)
    this.group.userData.waterTick?.(elapsed);
  }

  /** Dünya koordinatlarında ada merkezi */
  worldCenter() {
    const v = new THREE.Vector3();
    this.group.getWorldPosition(v);
    return v.add(new THREE.Vector3(0, 1, 0));
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
    this.baseY = y; // Ana pozisyonu da güncelle
  }

  dispose() {
    this._scene.remove(this.group);
    this.objects.forEach(obj => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose();
    });
    this.objects = [];
  }
}
