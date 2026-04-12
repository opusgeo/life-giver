---
name: Project Life-Giver GDD
description: Game Design Document for the Diorama Paint cozy game built with Three.js
type: project
---

# GDD: Project Life-Giver (Diorama Paint)

## Vizyon
Solmuş, gri bir dünyayı dokunuşlarla canlandırmak.
Tür: Cozy / Meditatif / Puzzle-Lite
Platform: Web (Three.js)
Görsel Stil: Ghibli esintili, Painterly, Toon-shaded dioramas

## Ana Mekanik
Tıkla-Canlandır (Click to Bloom): Tüm objeler başta "Clay" (gri/beyaz) MeshToonMaterial ile başlar.
Oyuncu tıkladığında obje zıplama/büyüme animasyonuyla orijinal renkli haline döner.

## Oyun Döngüsü
1. Gözlem: Fare ile döndürerek gri dioramayı incele
2. Etkileşim: Gri objelere tıkla
3. Ödül: Renk + ses efekti (ASMR)
4. Final: Tüm boyandığında parıltı efekti + müzik doruk + sonraki diorama açılır

## Teknik Gereksinimler
- Renderer: WebGLRenderer (antialias açık)
- Interaction: Raycaster + OrbitControls
- Assets: GLB (Blender export)
- VFX: THREE.Points (toz/parıltı)

## Sanat Yönetimi
- MeshToonMaterial veya custom Outline shader
- AmbientLight (yumuşak) + DirectionalLight (derinlik)
- Düşük poligonlu modeller, UV atlas

## Ses
- Neoklasik/ambient müzik döngüleri
- Boyama anında: çan sesi, su şırıltısı veya hafif "puf"

**Why:** Kullanıcının net vizyonu olan cozy/meditatif bir Three.js projesi.
**How to apply:** Her teknik kararda GDD'deki toon-shaded Ghibli estetiğini ve "clay → renkli" dönüşüm mekaniğini kuzey yıldızı olarak kullan.
