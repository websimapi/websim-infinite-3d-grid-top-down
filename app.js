import * as THREE from 'three';
import nipplejs from 'nipplejs';

/*
  Basic infinite grid (top-down) with orthographic camera,
  WASD + arrow controls (desktop) and nipple.js joystick (mobile).
  Camera rotates around the player on Q/E. Vertical rotation is clamped (top-down fixed).
*/

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xffffff, 1);

const scene = new THREE.Scene();

// Lights (subtle)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 0.4);
dir.position.set(5, 10, 2);
scene.add(dir);

// Player representation
const player = new THREE.Mesh(
  new THREE.BoxGeometry(1.0, 0.6, 1.0),
  new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.2, roughness: 0.6 })
);
player.position.set(0, 0.3, 0);
player.maxHealth = 100;
player.health = player.maxHealth;
scene.add(player);

// A small arrow on top to indicate forward
const arrowGeo = new THREE.ConeGeometry(0.2, 0.5, 12);
const arrowMat = new THREE.MeshStandardMaterial({ color: 0xff6b00 });
const arrow = new THREE.Mesh(arrowGeo, arrowMat);
arrow.rotation.x = Math.PI;
arrow.position.y = 0.9;
arrow.position.z = -0.35;
player.add(arrow);

// Orthographic camera (top-down)
let frustumSize = 20;
const aspect = window.innerWidth / window.innerHeight;
let camera = new THREE.OrthographicCamera(
  ( -frustumSize * aspect ) / 2,
  ( frustumSize * aspect ) / 2,
  frustumSize / 2,
  -frustumSize / 2,
  0.1,
  1000
);

// initial camera position: above, looking down
let cameraYaw = 0; // radians
const CAMERA_HEIGHT = 30;
camera.position.set(0, CAMERA_HEIGHT, 0);
camera.up.set(0, 0, -1); // keep +Z pointing "forward" on screen
camera.lookAt(0, 0, 0);

// Smooth camera follow params
let camTargetPos = new THREE.Vector3();
const camLerp = 0.12;

// Create a full-plane using shader material that renders an "infinite" grid in world-space
const planeGeo = new THREE.PlaneGeometry(1000, 1000, 1, 1);
const gridMaterial = new THREE.ShaderMaterial({
  uniforms: {
    gridColor: { value: new THREE.Color(0x111111) },
    axisColor: { value: new THREE.Color(0xff6b00) },
    gridSpacing: { value: 1.0 },
    lineThickness: { value: 0.02 },
    fadeDistance: { value: 60.0 },
    cameraPos: { value: new THREE.Vector3() }
  },
  vertexShader: /* glsl */`
    varying vec3 vWorld;
    void main(){
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorld = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec3 vWorld;
    uniform vec3 gridColor;
    uniform vec3 axisColor;
    uniform float gridSpacing;
    uniform float lineThickness;
    uniform float fadeDistance;
    uniform vec3 cameraPos;

    // anti-aliased grid line
    float gridLine(in float coord, in float spacing, in float thickness){
      float m = mod(coord + 0.5 * spacing, spacing) - 0.5 * spacing;
      float w = fwidth(m);
      return 1.0 - smoothstep(thickness - w, thickness + w, abs(m));
    }

    void main(){
      // world x,z used for grid
      vec2 p = vWorld.xz;

      // major axes at x=0 and z=0 (thicker)
      float lineX = gridLine(p.x, gridSpacing, lineThickness * 2.0);
      float lineZ = gridLine(p.y, gridSpacing, lineThickness * 2.0);

      // regular grid lines
      float gX = gridLine(p.x, gridSpacing, lineThickness);
      float gZ = gridLine(p.y, gridSpacing, lineThickness);

      // --- biome color (simple hashed bands + blends) ---
      float b = fract(sin(p.x * 0.021 + p.y * 0.029) * 43758.5453);
      vec3 biome0 = vec3(0.55,0.75,0.35); // grass
      vec3 biome1 = vec3(0.92,0.82,0.50); // sand
      vec3 biome2 = vec3(0.42,0.70,0.95); // water
      vec3 biome3 = vec3(0.60,0.60,0.60); // rock
      vec3 biomeA = mix(biome0, biome1, smoothstep(0.15, 0.45, b));
      vec3 biomeB = mix(biome2, biome3, smoothstep(0.45, 0.75, b));
      vec3 col = mix(biomeA, biomeB, smoothstep(0.40, 0.60, b));
      // --- end biome color ---

      // axis color overlay
      col = mix(col, axisColor, max(lineX, lineZ));

      // grid overlay
      col = mix(col, gridColor, max(gX, gZ) * 0.75);

      // vignette/fade with distance from camera position (so far areas fade)
      float dist = length(vWorld.xz - cameraPos.xz);
      float fade = 1.0 - smoothstep(fadeDistance * 0.6, fadeDistance, dist);

      gl_FragColor = vec4(col, fade);
      if (gl_FragColor.a < 0.02) discard;
    }
  `,
  transparent: true,
  depthWrite: false
});
const plane = new THREE.Mesh(planeGeo, gridMaterial);
plane.rotation.x = -Math.PI / 2; // lay flat on XZ
plane.position.y = 0;
scene.add(plane);

// Resize handler
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.left = (-frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize, { passive: true });
resize();

// Minimap setup: small top-right canvas showing player & bullets
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
function resizeMinimap(){
  // ensure the canvas backing buffer matches the CSS size and DPR
  const rect = minimap.getBoundingClientRect();
  const cssW = Math.max(64, Math.round(rect.width));
  const cssH = Math.max(64, Math.round(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // update canvas pixel buffer only when size changed (prevents unnecessary resets)
  if (minimap.width !== cssW * dpr || minimap.height !== cssH * dpr) {
    minimap.width = cssW * dpr;
    minimap.height = cssH * dpr;
    // use resetTransform + scale to avoid accumulating transforms
    mmCtx.setTransform(1,0,0,1,0,0);
    mmCtx.scale(dpr, dpr);
    // sensible rendering flags
    mmCtx.imageSmoothingEnabled = true;
  }
}
resizeMinimap();
window.addEventListener('resize', resizeMinimap, { passive: true });

// Input handling
const keys = { ArrowUp:0, ArrowDown:0, ArrowLeft:0, ArrowRight:0, KeyW:0, KeyA:0, KeyS:0, KeyD:0 };
window.addEventListener('keydown', (e) => {
  if (keys.hasOwnProperty(e.code)) keys[e.code] = 1;
  if (e.code === 'KeyQ') cameraYaw += 0.08;
  if (e.code === 'KeyE') cameraYaw -= 0.08;
  if (e.code === 'KeyK') applyDamage(12); // test: reduce health
  if (e.code === 'KeyR') { player.health = player.maxHealth; updateHealthUI(); }
  if (e.code === 'Space') { e.preventDefault(); spawnBullet(); }
});
window.addEventListener('keyup', (e) => {
  if (keys.hasOwnProperty(e.code)) keys[e.code] = 0;
});

// Zoom with wheel (desktop)
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  frustumSize += Math.sign(e.deltaY) * 1.2;
  frustumSize = Math.max(6, Math.min(80, frustumSize));
  resize();
}, { passive: false });

// Touch / pinch zoom: simple two-finger scale
let lastDist = null;
window.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const a = e.touches[0], b = e.touches[1];
    lastDist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && lastDist) {
    const a = e.touches[0], b = e.touches[1];
    const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
    const delta = d - lastDist;
    frustumSize -= delta * 0.02;
    frustumSize = Math.max(6, Math.min(80, frustumSize));
    resize();
    lastDist = d;
  }
}, { passive: true });
window.addEventListener('touchend', (e) => { if (e.touches.length < 2) lastDist = null; }, { passive: true });

// Movement state
let moveVec = new THREE.Vector3(0, 0, 0);
const moveSpeed = 6.0; // units per second
let joystickVec = { x: 0, y: 0 };

// Joystick (nipple.js) for mobile
const joystickEl = document.getElementById('joystick');
let joystickManager = null;
function setupJoystick(){
  // show joystick only if touch-capable
  if (!('ontouchstart' in window)) return;
  joystickEl.style.display = 'block';
  joystickManager = nipplejs.create({
    zone: joystickEl,
    mode: 'static',
    position: { left: '70px', bottom: '70px' },
    color: '#111',
    size: 120
  });
  joystickManager.on('move', (evt, data) => {
    if (!data || !data.vector) return;
    // vector: {x, y} normalized -1..1, where y is negative up
    joystickVec.x = data.vector.x;
    joystickVec.y = -data.vector.y;
  });
  joystickManager.on('end', () => {
    joystickVec.x = 0;
    joystickVec.y = 0;
  });
}
setupJoystick();

// health UI bindings & helpers
const healthEl = document.getElementById('health-ui');
const healthFill = document.getElementById('health-fill');
const healthText = document.getElementById('health-text');

function updateHealthUI(){
  const pct = Math.max(0, player.health) / player.maxHealth;
  healthFill.style.width = `${pct * 100}%`;
  healthText.textContent = `${Math.round(pct * 100)}%`;
  if (pct <= 0) {
    healthEl.classList.add('dead');
    player.material.color.set(0x770000);
  } else {
    healthEl.classList.remove('dead');
    player.material.color.set(0x111111);
  }
}

function applyDamage(amount){
  player.health = Math.max(0, player.health - amount);
  updateHealthUI();
}

// initialize UI
updateHealthUI();

// bullets storage + basic shared geometry/material
const bullets = [];
const BULLET_SPEED = 25;
const BULLET_LIFETIME = 2.5;
const bulletGeo = new THREE.SphereGeometry(0.12, 8, 8);
const bulletMat = new THREE.MeshStandardMaterial({ color: 0xff6b00, emissive: 0xff6b00, emissiveIntensity: 0.6, metalness: 0.1, roughness: 0.4 });

// spawnBullet: create a bullet in front of the player and give it velocity
function spawnBullet(){
  // forward in world space (player's local -Z), reversed so bullets come from the opposite side and go the opposite direction
  const forward = new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion).normalize().negate();
  const start = new THREE.Vector3().copy(player.position).add(forward.clone().multiplyScalar(1.1));
  start.y += 0.5;
  const mesh = new THREE.Mesh(bulletGeo, bulletMat.clone());
  mesh.position.copy(start);
  scene.add(mesh);
  bullets.push({ mesh, vel: forward.clone().multiplyScalar(BULLET_SPEED), life: BULLET_LIFETIME });
  // tiny visual feedback (quick scale pulse)
  player.scale.set(1.02,1.02,1.02);
  setTimeout(()=> player.scale.set(1,1,1), 90);
}

// hook the UI button and spacebar to fire
const fireBtn = document.getElementById('fire');
if (fireBtn) {
  fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); spawnBullet(); });
}

// lightweight JS-side biome helper to keep minimap colors consistent with shader
function frac(v){ return v - Math.floor(v); }
function getBiomeColor(x, z){
  // same simple hash as in shader to produce consistent biomes
  const b = frac(Math.sin(x * 0.021 + z * 0.029) * 43758.5453);
  const biome0 = [0.55,0.75,0.35];
  const biome1 = [0.92,0.82,0.50];
  const biome2 = [0.42,0.70,0.95];
  const biome3 = [0.60,0.60,0.60];
  function mix(a,b,t){ return a*(1-t) + b*t; }
  function smoothstep(a,b,x){
    if (x <= a) return 0;
    if (x >= b) return 1;
    const u = (x - a) / (b - a);
    return u * u * (3.0 - 2.0 * u);
  }
  const a = smoothstep(0.15, 0.45, b);
  const c0 = [ mix(biome0[0], biome1[0], a), mix(biome0[1], biome1[1], a), mix(biome0[2], biome1[2], a) ];
  const bb = smoothstep(0.45, 0.75, b);
  const c1 = [ mix(biome2[0], biome3[0], bb), mix(biome2[1], biome3[1], bb), mix(biome2[2], biome3[2], bb) ];
  const blend = smoothstep(0.40, 0.60, b);
  const r = Math.round((mix(c0[0], c1[0], blend)) * 255);
  const g = Math.round((mix(c0[1], c1[1], blend)) * 255);
  const bl = Math.round((mix(c0[2], c1[2], blend)) * 255);
  return `rgb(${r},${g},${bl})`;
}

// Draw a simple top-down minimap each frame
function drawMinimap(){
  // compute current CSS size (kept in sync by resizeMinimap)
  const rect = minimap.getBoundingClientRect();
  const w = Math.max(64, Math.round(rect.width));
  const h = Math.max(64, Math.round(rect.height));

  // clear using CSS-space coordinates (canvas has been scaled by DPR in resize)
  mmCtx.clearRect(0, 0, w, h);

  // background: sample biomes across the map to give a small "biome map"
  const viewRadius = 30; // world units shown from center to edge
  const scale = (Math.min(w,h) * 0.5 - 8) / viewRadius;
  const cx = w * 0.5, cy = h * 0.5;
  const cols = 20;
  const rows = Math.max(8, Math.round(cols * (h / w)));
  const cellW = w / cols, cellH = h / rows;
  for (let iy = 0; iy < rows; iy++){
    for (let ix = 0; ix < cols; ix++){
      const px = ix * cellW + cellW * 0.5;
      const py = iy * cellH + cellH * 0.5;
      const worldX = player.position.x + (px - cx) / scale;
      const worldZ = player.position.z + (py - cy) / scale;
      mmCtx.fillStyle = getBiomeColor(worldX, worldZ);
      mmCtx.fillRect(Math.round(ix * cellW), Math.round(iy * cellH), Math.ceil(cellW)+1, Math.ceil(cellH)+1);
    }
  }

  // border
  mmCtx.strokeStyle = 'rgba(0,0,0,0.06)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(0.5,0.5,w-1,h-1);

  // draw subtle crosshair
  mmCtx.strokeStyle = 'rgba(0,0,0,0.06)';
  mmCtx.lineWidth = 1;
  mmCtx.beginPath();
  mmCtx.moveTo(cx - 4, cy);
  mmCtx.lineTo(cx + 4, cy);
  mmCtx.moveTo(cx, cy - 4);
  mmCtx.lineTo(cx, cy + 4);
  mmCtx.stroke();

  // draw bullets (rounded positions to avoid pixel trails/artifacts)
  mmCtx.fillStyle = '#ff6b00';
  for (let i = 0; i < bullets.length; i++){
    const bpos = bullets[i].mesh.position;
    const dx = (bpos.x - player.position.x) * scale;
    const dz = (bpos.z - player.position.z) * scale;
    const px = Math.round(cx + dx);
    const py = Math.round(cy + dz);
    // simple cull to keep things tidy
    if (px < -8 || px > w + 8 || py < -8 || py > h + 8) continue;
    mmCtx.beginPath();
    mmCtx.arc(px, py, 3, 0, Math.PI*2);
    mmCtx.fill();
  }

  // draw player at center with orientation arrow (use integer positions)
  mmCtx.save();
  mmCtx.translate(Math.round(cx), Math.round(cy));

  // compute player's forward direction in world-space and convert to canvas rotation
  // We want forward=(0,0,-1) (world forward) to map to angle 0 (up on the minimap).
  const forward = new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion).normalize().negate();
  const angle = Math.atan2(-forward.z, forward.x);
  mmCtx.rotate(angle);

  // player body
  mmCtx.fillStyle = '#111';
  mmCtx.beginPath();
  mmCtx.arc(0, 0, 6, 0, Math.PI*2);
  mmCtx.fill();

  // forward indicator (triangle)
  mmCtx.fillStyle = '#ff6b00';
  mmCtx.beginPath();
  mmCtx.moveTo(0,-10);
  mmCtx.lineTo(4,-4);
  mmCtx.lineTo(-4,-4);
  mmCtx.closePath();
  mmCtx.fill();
  mmCtx.restore();
}

// Animation loop
let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // Build movement vector from keyboard + joystick
  let vx = 0, vz = 0;
  // Keyboard input mapping
  if (keys.KeyW || keys.ArrowUp) vz -= 1;
  if (keys.KeyS || keys.ArrowDown) vz += 1;
  if (keys.KeyA || keys.ArrowLeft) vx -= 1;
  if (keys.KeyD || keys.ArrowRight) vx += 1;

  // Combine with joystick (gives priority for mobile)
  if (Math.abs(joystickVec.x) > 0.01 || Math.abs(joystickVec.y) > 0.01) {
    vx = joystickVec.x;
    vz = joystickVec.y;
  }

  // If input exists, move in camera-relative directions (rotate by cameraYaw)
  const input = new THREE.Vector3(vx, 0, vz);
  if (input.lengthSq() > 0.0001) {
    input.normalize();
    // rotate by cameraYaw (so "forward" of joystick/keys matches screen up)
    const cos = Math.cos(cameraYaw);
    const sin = Math.sin(cameraYaw);
    const worldX = input.x * cos - input.z * sin;
    const worldZ = input.x * sin + input.z * cos;
    moveVec.set(worldX, 0, worldZ).multiplyScalar(moveSpeed * dt);
    player.position.add(moveVec);

    // rotate player to face movement direction
    const angle = Math.atan2(-moveVec.z, moveVec.x);
    player.rotation.y = angle + Math.PI / 2;
  }

  // Camera follows player with smoothing and applies yaw rotation around player
  const desiredCamPos = new THREE.Vector3(player.position.x, CAMERA_HEIGHT, player.position.z);
  // rotate camera around player horizontally by cameraYaw
  const offsetRadius = 0; // keep camera above; if you want offset behind player, adjust radius
  const sx = Math.sin(cameraYaw) * offsetRadius;
  const cx = Math.cos(cameraYaw) * offsetRadius;
  desiredCamPos.x += -sx;
  desiredCamPos.z += -cx;

  camera.position.lerp(desiredCamPos, camLerp);
  // keep camera looking at the player's position
  camTargetPos.copy(player.position);
  camera.lookAt(camTargetPos);

  // Update shader cameraPos uniform for proper fading
  gridMaterial.uniforms.cameraPos.value.copy(player.position);

  // Update bullets: advance, lifetime, cleanup
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    // move
    b.mesh.position.addScaledVector(b.vel, dt);
    // simple lifetime
    b.life -= dt;
    if (b.life <= 0) {
      // remove mesh and dispose material (geometry is shared)
      scene.remove(b.mesh);
      if (b.mesh.material) b.mesh.material.dispose();
      bullets.splice(i, 1);
      continue;
    }
  }
  // draw minimap overlay
  drawMinimap();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Initial resize to set sizes correctly
resize();