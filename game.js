// ============================================================================
// THREE.JS HORROR SURVIVAL ENGINE V2.0.0 (STABLE PERFORMANCE MODULE)
// ============================================================================

const CONFIG = {
    mapWidth: 1500,
    mapLimit: 750,         
    chunkSize: 150,        
    chunksPerRow: 10,
    normalSpeed: 0.11,     
    sprintSpeed: 0.22,     
    pohonPerChunk: 35      
};

let STATE = {
    currentRenderDistance: 250, 
    currentResolutionScale: 1.0, 
    maxActiveAICap: 25,         
    fps: 60,
    mouseSensitivity: 0.002, 
    isAdaptiveActive: true,
    cameraMode: 0 // 0: First-Person, 1: Third-Person Back, 2: Third-Person Front
};

// INITIALIZE SCENE & RENDERER
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);

// MAIN CONTROLS & GROUPS
const controls = new THREE.PointerLockControls(camera, renderer.domElement);
const playerGroup = new THREE.Group(); 
scene.add(playerGroup);

// FLASHLIGHT
const flashlight = new THREE.SpotLight(0xffffff, 5, 75, Math.PI / 6, 0.5, 1.2);
flashlight.castShadow = true;
flashlight.shadow.mapSize.width = 512;  
flashlight.shadow.mapSize.height = 512;
camera.add(flashlight);
flashlight.target.position.set(0, 0, -1);
camera.add(flashlight.target);
scene.add(camera);

// LIGHTING
const ambientLight = new THREE.AmbientLight(0x111111);
scene.add(ambientLight);

// FLOOR
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600), 
    new THREE.MeshStandardMaterial({ color: 0x030603, roughness: 1.0 })
);
floor.rotation.x = -Math.PI / 2; 
floor.receiveShadow = true; 
scene.add(floor);

// MODEL UTILITIES
let playerAvatar = null;
let mixer = null; 
const clock = new THREE.Clock();

// WEAPON INITIALIZATION
const weaponGroup = new THREE.Group();
const barrelMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.6), new THREE.MeshBasicMaterial({ color: 0x222222 }));
weaponGroup.add(barrelMesh); 
camera.add(weaponGroup);

// GLTF LOADER - PLAYER AVATAR
const gltfLoader = new THREE.GLTFLoader();
gltfLoader.load(
    './Adventurer.glb',
    (gltf) => {
        playerAvatar = gltf.scene;
        playerAvatar.scale.set(1, 1, 1); 
        playerAvatar.position.set(0, 0, 0); 
        
        playerAvatar.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        playerGroup.add(playerAvatar);

        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(playerAvatar);
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
        }

        const playBtn = document.getElementById('btn-play-normal');
        if(playBtn) {
            playBtn.innerText = "START SURVIVAL";
            playBtn.removeAttribute('disabled');
        }
        const loaderStatus = document.getElementById('loader-status');
        if(loaderStatus) loaderStatus.innerText = "Asset: Adventurer Ready";
        
        updateCameraViewMode();
    },
    (xhr) => {
        const playBtn = document.getElementById('btn-play-normal');
        if(!playBtn) return;
        if(xhr.total > 0) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            playBtn.innerText = `LOADING MODEL (${percent}%)`;
        } else {
            playBtn.innerText = `FETCHING 3D MODEL...`;
        }
    },
    (error) => {
        console.error('Gagal memuat model 3D Avatar:', error);
        const playBtn = document.getElementById('btn-play-normal');
        if(playBtn) {
            playBtn.innerText = "START SURVIVAL (Model Error)";
            playBtn.removeAttribute('disabled');
        }
    }
);

// UPDATE CAMERA VIEW MODES
const updateCameraViewMode = () => {
    if (!playerAvatar) return; 

    camera.position.set(0, 0, 0);
    playerAvatar.rotation.set(0, 0, 0);
    weaponGroup.position.set(0.25, -0.25, -0.5); 

    if (STATE.cameraMode === 0) {
        playerAvatar.visible = false; 
        weaponGroup.visible = true;
        camera.position.set(0, 1.8, 0); 
    } 
    else if (STATE.cameraMode === 1) {
        playerAvatar.visible = true; 
        weaponGroup.visible = false; 
        camera.position.set(0, 2.3, 3.5); 
    } 
    else if (STATE.cameraMode === 2) {
        playerAvatar.visible = true;
        weaponGroup.visible = false;
        camera.position.set(0, 2.0, -3.0); 
        playerAvatar.rotation.y = Math.PI; 
    }
};

// ============================================================================
// CHUNK SYSTEM MODULE
// ============================================================================
class AdaptiveChunkManager {
    constructor() {
        this.chunks = {};
        this.pohonGeometry = new THREE.CylinderGeometry(0.2, 0.4, 8, 4); 
        this.pohonMaterial = new THREE.MeshStandardMaterial({ color: 0x101710, roughness: 1.0 });
        this.buildGrid();
    }

    buildGrid() {
        for (let xIdx = 0; xIdx < CONFIG.chunksPerRow; xIdx++) {
            for (let zIdx = 0; zIdx < CONFIG.chunksPerRow; zIdx++) {
                const chunkKey = `${xIdx}_${zIdx}`;
                const startX = -CONFIG.mapLimit + (xIdx * CONFIG.chunkSize);
                const startZ = -CONFIG.mapLimit + (zIdx * CONFIG.chunkSize);
                
                const positions = [];
                for (let p = 0; p < CONFIG.pohonPerChunk; p++) {
                    let px = startX + Math.random() * CONFIG.chunkSize;
                    let pz = startZ + Math.random() * CONFIG.chunkSize;
                    if (Math.abs(px) > 20 || Math.abs(pz) > 20) {
                        positions.push(new THREE.Vector3(px, 4, pz));
                    }
                }
                
                const instMesh = new THREE.InstancedMesh(this.pohonGeometry, this.pohonMaterial, positions.length);
                instMesh.castShadow = false; 
                instMesh.receiveShadow = false;
                
                const dummy = new THREE.Object3D();
                positions.forEach((pos, idx) => {
                    dummy.position.copy(pos); 
                    dummy.updateMatrix();
                    instMesh.setMatrixAt(idx, dummy.matrix);
                });
                
                this.chunks[chunkKey] = {
                    mesh: instMesh,
                    center: new THREE.Vector2(startX + CONFIG.chunkSize/2, startZ + CONFIG.chunkSize/2),
                    isLoaded: false
                };
            }
        }
    }

    updateGrid(playerX, playerZ) {
        for (let key in this.chunks) {
            const chunk = this.chunks[key];
            const distance = chunk.center.distanceTo(new THREE.Vector2(playerX, playerZ));
            
            if (distance <= STATE.currentRenderDistance) {
                if (!chunk.isLoaded) { 
                    scene.add(chunk.mesh); 
                    chunk.isLoaded = true; 
                }
                chunk.mesh.castShadow = (distance < STATE.currentRenderDistance * 0.4 && renderer.shadowMap.enabled);
            } else {
                if (chunk.isLoaded) { 
                    scene.remove(chunk.mesh); 
                    chunk.isLoaded = false; 
                }
            }
        }
    }
    
    removeAllFromScene() {
        for (let key in this.chunks) {
            if (this.chunks[key].isLoaded) {
                scene.remove(this.chunks[key].mesh);
                this.chunks[key].isLoaded = false;
            }
        }
    }
}
const chunkManager = new AdaptiveChunkManager();

// ============================================================================
// FIXED POI STRUCTURES WITH AABB COLLISION BOX & STATIC PRE-BUILD
// ============================================================================
const POI_STRUCTURES = [
    { name: "RUMAH", pos: new THREE.Vector3(-100, 4, -150), size: [16, 8, 16], color: 0x322929, mesh: null, hWidth: 8.0, hDepth: 8.0 },
    { name: "MENARA", pos: new THREE.Vector3(250, 10, -350), size: [5, 20, 5], color: 0x1d211d, mesh: null, hWidth: 2.5, hDepth: 2.5 },
    { name: "GUDANG", pos: new THREE.Vector3(400, 5, 200), size: [25, 10, 20], color: 0x3d3734, mesh: null, hWidth: 12.5, hDepth: 10.0 }
];

const initPOIBuildingsStatic = () => {
    POI_STRUCTURES.forEach(b => {
        const geo = new THREE.BoxGeometry(...b.size);
        const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 1.0 });
        b.mesh = new THREE.Mesh(geo, mat);
        b.mesh.position.copy(b.pos);
        b.mesh.visible = false; 
        scene.add(b.mesh);
    });
};
initPOIBuildingsStatic();

const updateBuildingsVisibility = (pX, pZ) => {
    POI_STRUCTURES.forEach(b => {
        const distance = new THREE.Vector2(b.pos.x, b.pos.z).distanceTo(new THREE.Vector2(pX, pZ));
        if (distance <= STATE.currentRenderDistance) {
            b.mesh.visible = true;
            b.mesh.castShadow = (distance < STATE.currentRenderDistance * 0.4);
        } else {
            b.mesh.visible = false;
        }
    });
};

// ============================================================================
// MONSTER POOLING WITH DELAYED RESPAWN & DYNAMIC STATE VALUES
// ============================================================================
class PooledMonster {
    constructor() {
        this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 4), new THREE.MeshBasicMaterial({ color: 0xaa1111 }));
        this.mesh.visible = false;
        scene.add(this.mesh);
        
        this.isActive = false; 
        this.isSleeping = true; 
        this.hp = 3; 
        this.speed = 0.08; 
        this.collisionRadius = 1.3;
        
        this.isWaitingRespawn = false;
        this.respawnTimeTarget = 0;
    }

    spawn(x, z, hpBoost, speedBoost) {
        this.mesh.position.set(x, 1.5, z); 
        this.hp = 3 + hpBoost; 
        this.speed = 0.08 + speedBoost;
        this.isActive = true; 
        this.isSleeping = false; 
        this.mesh.visible = true;
        this.isWaitingRespawn = false;
    }

    killAndPrepareRespawn(cooldownMs) {
        this.isActive = false;
        this.mesh.visible = false;
        this.isSleeping = true;
        this.isWaitingRespawn = true;
        this.respawnTimeTarget = performance.now() + cooldownMs;
    }

    despawn() {
        this.isActive = false; 
        this.isSleeping = true; 
        this.mesh.visible = false;
        this.isWaitingRespawn = false;
    }

    executeAI(playerPos) {
        if (!this.isActive || this.isSleeping) return;
        
        const distance = this.mesh.position.distanceTo(playerPos);
        if (distance > 150) {
            if (!this.isSleeping) { 
                this.isSleeping = true; 
                this.mesh.visible = false; 
            }
            return; 
        }
        this.isSleeping = false; 
        this.mesh.visible = true;
        
        this.mesh.lookAt(playerPos.x, this.mesh.position.y, playerPos.z);
        const dir = new THREE.Vector3().subVectors(playerPos, this.mesh.position).normalize();
        this.mesh.position.addScaledVector(dir, this.speed);
    }
}

const monsterPool = [];
for (let i = 0; i < 60; i++) { monsterPool.push(new PooledMonster()); }

// PROFILING AND PERFORMANCE AUTO-THROTTLING
let frameCount = 0, lastTime = performance.now();
const runPerformanceAutoThrottling = () => {
    if(!STATE.isAdaptiveActive) return;
    frameCount++; 
    const time = performance.now();
    if (time >= lastTime + 1000) {
        STATE.fps = Math.round((frameCount * 1000) / (time - lastTime));
        frameCount = 0; 
        lastTime = time;
        
        const fpsTxt = document.getElementById('fps-counter'); 
        if(fpsTxt) {
            fpsTxt.innerText = `FPS: ${STATE.fps}`;
            if (STATE.fps > 55) {
                STATE.currentRenderDistance = 250; STATE.currentResolutionScale = 1.0; STATE.maxActiveAICap = 35;
                renderer.shadowMap.enabled = true; fpsTxt.style.color = "#00ff44";
            } else if (STATE.fps <= 55 && STATE.fps >= 40) {
                STATE.currentRenderDistance = 180; STATE.currentResolutionScale = 0.9; STATE.maxActiveAICap = 25;
                renderer.shadowMap.enabled = true; fpsTxt.style.color = "#ffcc00";
            } else if (STATE.fps < 40) {
                STATE.currentRenderDistance = 120; STATE.currentResolutionScale = 0.75; STATE.maxActiveAICap = 15;
                renderer.shadowMap.enabled = false; fpsTxt.style.color = "#ff3333";
            }
        }
        renderer.setPixelRatio(window.devicePixelRatio * STATE.currentResolutionScale);
        camera.far = STATE.currentRenderDistance + 30; 
        camera.updateProjectionMatrix();
        
        const engineStatus = document.getElementById('engine-status');
        if(engineStatus) engineStatus.innerText = `Scale: ${Math.round(STATE.currentResolutionScale*100)}% | Dist: ${STATE.currentRenderDistance}m`;
    }
};

let isSwitchingCameraLock = false;

// ============================================================================
// SYSTEM GAME MANAGER LOGIC
// ============================================================================
class GameManager {
    constructor() {
        this.gameState = 'MENU';
        this.hp = 100; 
        this.stamina = 100; 
        this.ammo = 30; 
        this.maxAmmo = 30; 
        this.kills = 0;
        
        this.wave = 1;
        this.waveKillRequirements = 10; 
        this.killsInCurrentWave = 0;
        this.respawnCooldownConfig = 4000; 
        
        this.keys = { w: false, a: false, s: false, d: false, shift: false };
        this.prevPlayerPos = new THREE.Vector3();

        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('btn-play-normal')?.addEventListener('click', () => this.bootUpGame());
        document.getElementById('btn-restart')?.addEventListener('click', () => this.resetAndRestartGame());
        document.getElementById('btn-to-menu')?.addEventListener('click', () => this.exitToMainMenu());
        document.getElementById('btn-resume-setting')?.addEventListener('click', () => this.toggleSettingOverlay());

        document.getElementById('setting-flashlight')?.addEventListener('change', (e) => { flashlight.visible = e.target.checked; });
        document.getElementById('setting-sens')?.addEventListener('input', (e) => {
            if(controls.pointerSpeed !== undefined) controls.pointerSpeed = e.target.value * 0.2;
        });
        document.getElementById('setting-adaptive')?.addEventListener('change', (e) => {
            STATE.isAdaptiveActive = e.target.checked;
            if(!e.target.checked) {
                STATE.currentRenderDistance = 250; STATE.currentResolutionScale = 1.0; STATE.maxActiveAICap = 35;
                renderer.shadowMap.enabled = true; renderer.setPixelRatio(window.devicePixelRatio);
            }
        });

        controls.addEventListener('unlock', () => {
            if (isSwitchingCameraLock) {
                setTimeout(() => { controls.lock(); }, 10);
                isSwitchingCameraLock = false;
            } else {
                if (this.gameState === 'PLAYING') {
                    this.toggleSettingOverlay();
                }
            }
        });

        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            
            if (e.key === 'F5' || k === 'v') {
                e.preventDefault(); 
                if (this.gameState === 'PLAYING' && playerAvatar) {
                    isSwitchingCameraLock = true; 
                    STATE.cameraMode = (STATE.cameraMode + 1) % 3; 
                    updateCameraViewMode();
                    if(!controls.isLocked) controls.lock();
                }
                return;
            }

            if (k === 'o') { this.toggleSettingOverlay(); return; }
            if (this.gameState !== 'PLAYING') return;
            if (['w','a','s','d'].includes(k)) this.keys[k] = true;
            if (e.key === 'Shift') this.keys.shift = true;
            if (k === 'r') this.reloadWeapon();
        });
        
        window.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if (['w','a','s','d'].includes(k)) this.keys[k] = false;
            if (e.key === 'Shift') this.keys.shift = false;
        });

        window.addEventListener('mousedown', (e) => {
            if (this.gameState === 'PLAYING' && e.button === 0 && controls.isLocked) this.fireActiveWeapon();
        });
    }

    bootUpGame() {
        this.gameState = 'PLAYING';
        this.wave = 1;
        this.kills = 0;
        this.killsInCurrentWave = 0;
        this.waveKillRequirements = 10;
        this.respawnCooldownConfig = 4000;

        document.getElementById('main-menu')?.classList.add('hidden');
        document.getElementById('game-over-screen')?.classList.add('hidden');
        document.getElementById('hud')?.classList.remove('hidden');
        document.getElementById('perf-debug')?.classList.remove('hidden');
        
        playerGroup.position.set(0, 0, 0); 
        this.prevPlayerPos.copy(playerGroup.position);
        
        if(playerAvatar) updateCameraViewMode();
        
        controls.lock();
        this.generateActiveWaveMonsters();
        this.updateHUDTextDisplays();
    }

    toggleSettingOverlay() {
        if (this.gameState === 'PLAYING') {
            this.gameState = 'SETTING'; 
            controls.unlock();
            document.getElementById('setting-menu')?.classList.remove('hidden');
        } else if (this.gameState === 'SETTING') {
            this.gameState = 'PLAYING';
            document.getElementById('setting-menu')?.classList.add('hidden'); 
            controls.lock();
        }
    }

    resetAndRestartGame() {
        this.hp = 100; this.stamina = 100; this.ammo = 30;
        const hpTxt = document.getElementById('hp-txt'); if(hpTxt) hpTxt.innerText = "100";
        const hpBar = document.getElementById('hp-bar'); if(hpBar) hpBar.style.width = "100%";
        const stamBar = document.getElementById('stamina-bar'); if(stamBar) stamBar.style.width = "100%";
        const wpAmmo = document.getElementById('weap-ammo'); if(wpAmmo) wpAmmo.innerText = `AMMO: 30 / 30`;
        const bloodVig = document.getElementById('blood-vignette'); if(bloodVig) bloodVig.style.display = 'none';
        this.bootUpGame();
    }

    exitToMainMenu() {
        this.gameState = 'MENU';
        document.getElementById('game-over-screen')?.classList.add('hidden');
        document.getElementById('hud')?.classList.add('hidden');
        document.getElementById('perf-debug')?.classList.add('hidden');
        document.getElementById('main-menu')?.classList.remove('hidden');
        monsterPool.forEach(m => m.despawn());
        chunkManager.removeAllFromScene();
    }

    updateHUDTextDisplays() {
        const waveIndicator = document.getElementById('hud-wave-indicator');
        if(waveIndicator) {
            waveIndicator.innerText = `WAVE: ${this.wave} (${this.killsInCurrentWave}/${this.waveKillRequirements} Kills)`;
        }
    }

    checkWaveProgressionLogic() {
        if (this.killsInCurrentWave >= this.waveKillRequirements) {
            this.wave++;
            this.killsInCurrentWave = 0;
            this.waveKillRequirements = 10 + (this.wave * 5);
            this.respawnCooldownConfig = Math.max(1500, this.respawnCooldownConfig - 500); 
            this.generateActiveWaveMonsters();
        }
        this.updateHUDTextDisplays();
    }

    generateActiveWaveMonsters() {
        monsterPool.forEach(m => m.despawn());
        
        const hpBoost = Math.floor(this.wave / 2);
        const speedBoost = Math.min(0.06, (this.wave - 1) * 0.012);
        const currentActiveAICap = Math.min(monsterPool.length, STATE.maxActiveAICap + (this.wave * 2));

        for (let i = 0; i < currentActiveAICap; i++) {
            const angle = Math.random() * Math.PI * 2;
            const sX = playerGroup.position.x + Math.cos(angle) * (50 + Math.random() * 40);
            const sZ = playerGroup.position.z + Math.sin(angle) * (50 + Math.random() * 40);
            monsterPool[i].spawn(sX, sZ, hpBoost, speedBoost);
        }
    }

    processDelayedMonsterRespawns() {
        const now = performance.now();
        const hpBoost = Math.floor(this.wave / 2);
        const speedBoost = Math.min(0.06, (this.wave - 1) * 0.012);
        
        let currentActiveCount = monsterPool.filter(m => m.isActive).length;
        const currentMaxCap = Math.min(monsterPool.length, STATE.maxActiveAICap + (this.wave * 2));

        if (currentActiveCount < currentMaxCap) {
            for (let i = 0; i < monsterPool.length; i++) {
                let m = monsterPool[i];
                if (m.isWaitingRespawn && now >= m.respawnTimeTarget) {
                    const angle = Math.random() * Math.PI * 2;
                    const sX = playerGroup.position.x + Math.cos(angle) * (65 + Math.random() * 35);
                    const sZ = playerGroup.position.z + Math.sin(angle) * (65 + Math.random() * 35);
                    
                    m.spawn(sX, sZ, hpBoost, speedBoost);
                    break; 
                }
            }
        }
    }

    fireActiveWeapon() {
        if (this.ammo <= 0) return;
        this.ammo--;
        const wpAmmo = document.getElementById('weap-ammo');
        if(wpAmmo) wpAmmo.innerText = `AMMO: ${this.ammo} / ${this.maxAmmo}`;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const activeTargets = monsterPool.filter(m => m.isActive && !m.isSleeping).map(m => m.mesh);
        const intersections = raycaster.intersectObjects(activeTargets);

        if (intersections.length > 0) {
            let hitMesh = intersections[0].object;
            let monster = monsterPool.find(m => m.mesh === hitMesh);
            if (monster) {
                monster.hp -= 1.0;
                if (monster.hp <= 0) {
                    this.kills++;
                    this.killsInCurrentWave++;
                    monster.killAndPrepareRespawn(this.respawnCooldownConfig);
                    this.checkWaveProgressionLogic();
                }
            }
        }
    }

    reloadWeapon() {
        const wpAmmo = document.getElementById('weap-ammo');
        if(wpAmmo) wpAmmo.innerText = "RELOADING...";
        setTimeout(() => {
            this.ammo = this.maxAmmo;
            if(wpAmmo) wpAmmo.innerText = `AMMO: ${this.ammo} / ${this.maxAmmo}`;
        }, 1100);
    }

    handleObjectCollisions() {
        const px = playerGroup.position.x;
        const pz = playerGroup.position.z;
        const pRadius = 0.8; 

        // 1. Monster Collision Check
        monsterPool.forEach(m => {
            if (!m.isActive || m.isSleeping) return;
            const dist = Math.sqrt((px - m.mesh.position.x)**2 + (pz - m.mesh.position.z)**2);
            if (dist < m.collisionRadius) {
                playerGroup.position.set(this.prevPlayerPos.x, playerGroup.position.y, this.prevPlayerPos.z);
                this.hp = Math.max(0, this.hp - 0.25);
                
                const hpTxt = document.getElementById('hp-txt'); if(hpTxt) hpTxt.innerText = Math.ceil(this.hp);
                const hpBar = document.getElementById('hp-bar'); if(hpBar) hpBar.style.width = `${this.hp}%`;
                if(this.hp < 35) {
                    const bloodVig = document.getElementById('blood-vignette');
                    if(bloodVig) bloodVig.style.display = 'block';
                }
                if (this.hp <= 0) this.triggerGameOver();
            }
        });

        // 2. AABB Box Collision Check
        POI_STRUCTURES.forEach(b => {
            const minX = b.pos.x - b.hWidth;
            const maxX = b.pos.x + b.hWidth;
            const minZ = b.pos.z - b.hDepth;
            const maxZ = b.pos.z + b.hDepth;

            if (px + pRadius > minX && px - pRadius < maxX &&
                pz + pRadius > minZ && pz - pRadius < maxZ) {
                playerGroup.position.set(this.prevPlayerPos.x, playerGroup.position.y, this.prevPlayerPos.z);
            }
        });
    }

    triggerGameOver() {
        this.gameState = 'GAMEOVER'; 
        controls.unlock();
        const endStats = document.getElementById('end-stats');
        if(endStats) endStats.innerText = `Wave Reached: ${this.wave} | Total Kills: ${this.kills}`;
        document.getElementById('game-over-screen')?.classList.remove('hidden');
    }

    runTickUpdate() {
        if (this.gameState !== 'PLAYING' || !controls.isLocked) return;

        const currentActualX = playerGroup.position.x;
        const currentActualZ = playerGroup.position.z;

        let moveSpeed = CONFIG.normalSpeed;
        
        // Actual Displacement Checking
        const isActuallyMoving = Math.abs(currentActualX - this.prevPlayerPos.x) > 0.001 || 
                                 Math.abs(currentActualZ - this.prevPlayerPos.z) > 0.001;

        if (this.keys.shift && isActuallyMoving && this.stamina > 5) {
            moveSpeed = CONFIG.sprintSpeed;
            this.stamina = Math.max(0, this.stamina - 0.4);
        } else {
            this.stamina = Math.min(100, this.stamina + 0.25);
        }
        
        const stamBar = document.getElementById('stamina-bar');
        if(stamBar) stamBar.style.width = `${this.stamina}%`;

        this.prevPlayerPos.copy(playerGroup.position);

        const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forwardDir.y = 0; forwardDir.normalize();
        
        const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        rightDir.y = 0; rightDir.normalize();

        if (this.keys.w) playerGroup.position.addScaledVector(forwardDir, moveSpeed);
        if (this.keys.s) playerGroup.position.addScaledVector(forwardDir, -moveSpeed);
        if (this.keys.a) playerGroup.position.addScaledVector(rightDir, -moveSpeed);
        if (this.keys.d) playerGroup.position.addScaledVector(rightDir, moveSpeed);

        playerGroup.position.x = Math.max(-CONFIG.mapLimit, Math.min(CONFIG.mapLimit, playerGroup.position.x));
        playerGroup.position.z = Math.max(-CONFIG.mapLimit, Math.min(CONFIG.mapLimit, playerGroup.position.z));
        
        camera.position.x = playerGroup.position.x;
        camera.position.z = playerGroup.position.z;

        if (STATE.cameraMode === 1 && playerAvatar) {
            const targetRotation = Math.atan2(forwardDir.x, forwardDir.z);
            playerAvatar.rotation.y = targetRotation;
        }

        chunkManager.updateGrid(playerGroup.position.x, playerGroup.position.z);
        updateBuildingsVisibility(playerGroup.position.x, playerGroup.position.z);
        this.processDelayedMonsterRespawns();
        
        let currentActiveAICount = 0;
        monsterPool.forEach(m => {
            if (m.isActive && !m.isSleeping) currentActiveAICount++;
            m.executeAI(playerGroup.position);
        });
        
        this.handleObjectCollisions();

        const drawcalls = document.getElementById('three-drawcalls'); if(drawcalls) drawcalls.innerText = `Draw Calls: ${renderer.info.render.calls}`;
        const tris = document.getElementById('three-tris'); if(tris) tris.innerText = `Triangles: ${renderer.info.render.triangles}`;
        const geoInfo = document.getElementById('geo-info'); if(geoInfo) geoInfo.innerText = `XYZ: ${Math.floor(playerGroup.position.x)}, ${Math.floor(playerGroup.position.z)} | Wave AI Active: ${currentActiveAICount}`;
    }
}

const gameManager = new GameManager();

// MASTER RENDER LOOP
const masterLoop = () => {
    requestAnimationFrame(masterLoop);
    
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);

    if (gameManager.gameState === 'PLAYING') {
        runPerformanceAutoThrottling();
    }
    gameManager.runTickUpdate();
    renderer.render(scene, camera);
};
masterLoop();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; 
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
