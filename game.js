// ============================================================================
// SURVIVAL HORROR ENGINE v2.0
// CHANGELOG:
// - AABB collision untuk bangunan (bukan sphere)
// - POI pre-build mesh, pakai visible true/false (no GC spike)
// - Wave system dengan HP/speed/jumlah scaling
// - Monster respawn cooldown, kill benar-benar kurangi monster aktif
// - Smooth camera lerp FPS <-> TPS
// - AI monster: wander + detection + chase + attack mode
// - Audio procedural: ambient, footstep, gunshot, damage, death
// - Stamina hanya drain saat benar-benar bergerak
// - Shadow distance ikuti currentRenderDistance
// - Model GLB: Zombie, Tree, Dead_Tree, Gazebo, Barrier, Tuft_of_grass, Plan, Crane
// - Animation state machine: Idle -> Walk -> Run -> Death
// - Statistik akhir: kills, accuracy, survival time, highest wave
// ============================================================================

const CONFIG = {
    mapWidth: 1500,
    mapLimit: 750,
    chunkSize: 150,
    chunksPerRow: 10,
    normalSpeed: 0.11,
    sprintSpeed: 0.22,
    pohonPerChunk: 20
};

let STATE = {
    currentRenderDistance: 250,
    currentResolutionScale: 1.0,
    maxActiveAICap: 25,
    fps: 60,
    isAdaptiveActive: true,
    cameraMode: 0, // 0 = FPS, 1 = TPS (Over-the-shoulder Close), 2 = TPS Far
    cameraLerpSpeed: 0.12
};

// ============================================================================
// THREE.JS CORE SETUP
// ============================================================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x010401, 0.008);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new THREE.PointerLockControls(camera, renderer.domElement);
const playerGroup = new THREE.Group();
scene.add(playerGroup);

// Flashlight
const flashlight = new THREE.SpotLight(0xffffff, 5, 75, Math.PI / 6, 0.5, 1.2);
flashlight.castShadow = true;
flashlight.shadow.mapSize.width = 512;
flashlight.shadow.mapSize.height = 512;
camera.add(flashlight);
flashlight.target.position.set(0, 0, -1);
camera.add(flashlight.target);
scene.add(camera);

const ambientLight = new THREE.AmbientLight(0x111111);
scene.add(ambientLight);

// Floor
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color: 0x0a1a0a, roughness: 1.0 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ============================================================================
// AUDIO SYSTEM (Web Audio API)
// ============================================================================
const AudioSystem = (() => {
    let ctx = null;
    let footstepTimer = 0;
    let isStarted = false;

    const init = () => {
        if (isStarted) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        isStarted = true;
        startAmbient();
    };

    const createEnvelope = (freq1, freq2, duration, gainVal = 0.3) => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(freq1, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq2, ctx.currentTime + duration);
        gain.gain.setValueAtTime(gainVal, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    };

    const createNoise = (duration, gainVal = 0.05) => {
        if (!ctx) return;
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(gainVal, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();
    };

    const startAmbient = () => {
        if (!ctx) return;
        const playWind = () => {
            if (isStarted) {
                createNoise(4.0, 0.03);
                setTimeout(playWind, 3500 + Math.random() * 2000);
            }
        };
        playWind();
    };

    return {
        init,
        gunshot: () => {
            createEnvelope(800, 80, 0.15, 0.6);
            createNoise(0.1, 0.4);
        },
        damage: () => createEnvelope(200, 60, 0.3, 0.5),
        death: () => {
            createEnvelope(300, 30, 0.8, 0.4);
            setTimeout(() => createNoise(0.5, 0.1), 100);
        },
        monsterGrowl: () => createEnvelope(60 + Math.random() * 40, 30, 0.6, 0.2),
        footstep: (delta, isMoving, isSprinting) => {
            if (!isMoving || !ctx) return;
            footstepTimer += delta;
            const interval = isSprinting ? 0.28 : 0.45;
            if (footstepTimer >= interval) {
                footstepTimer = 0;
                createNoise(0.08, 0.12);
            }
        },
        reload: () => {
            createEnvelope(400, 200, 0.1, 0.2);
            setTimeout(() => createEnvelope(300, 500, 0.1, 0.15), 150);
            setTimeout(() => createEnvelope(200, 100, 0.2, 0.25), 400);
        }
    };
})();

// ============================================================================
// ASSET LOADER
// ============================================================================
const gltfLoader = new THREE.GLTFLoader();
const loadedModels = {};
let modelsToLoad = 0;
let modelsLoaded = 0;

const MODEL_LIST = [
    'Adventurer', 'Zombie', 'Tree', 'Dead_Tree',
    'Gazebo', 'Barrier', 'Tuft_of_grass', 'Plan',
    'Building_construction_crane'
];

const onModelLoadProgress = () => {
    modelsLoaded++;
    const pct = Math.round((modelsLoaded / modelsToLoad) * 100);
    const btn = document.getElementById('btn-play-normal');
    if (btn) btn.innerText = `LOADING ASSETS (${pct}%)`;
    
    const statusTxt = document.getElementById('loader-status');
    if (statusTxt) statusTxt.innerText = `Loaded: ${modelsLoaded} / ${modelsToLoad}`;
    
    if (modelsLoaded >= modelsToLoad) {
        if (btn) {
            btn.innerText = 'START SURVIVAL';
            btn.removeAttribute('disabled');
        }
        if (statusTxt) statusTxt.innerText = 'All assets ready.';
        initGameObjects();
    }
};

const initGameObjects = () => {
    setupPlayerAvatar();
    preBuildPOI();
    chunkManager = new AdaptiveChunkManager();
};

modelsToLoad = MODEL_LIST.length;
MODEL_LIST.forEach(name => {
    gltfLoader.load(
        `./${name}.glb`,
        (gltf) => {
            loadedModels[name] = gltf;
            onModelLoadProgress();
        },
        undefined,
        (err) => {
            console.warn(`Model ${name}.glb not found, skipping.`, err);
            loadedModels[name] = null;
            onModelLoadProgress();
        }
    );
});

// ============================================================================
// PLAYER AVATAR + ANIMATION STATE MACHINE
// ============================================================================
let playerAvatar = null;
let mixer = null;
const clock = new THREE.Clock();
const animActions = {};
let currentAnim = 'Idle';

const ANIM_MAP = {
    'Idle': 0,
    'Walk': 1,
    'Run': 2,
    'Death': 3
};

const setupPlayerAvatar = () => {
    const gltf = loadedModels['Adventurer'];
    if (!gltf) return;

    playerAvatar = gltf.scene;
    playerAvatar.scale.set(1, 1, 1);
    playerAvatar.traverse(c => {
        if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    playerGroup.add(playerAvatar);

    if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(playerAvatar);
        gltf.animations.forEach((clip, idx) => {
            const key = Object.keys(ANIM_MAP).find(k => ANIM_MAP[k] === idx) || `anim_${idx}`;
            animActions[key] = mixer.clipAction(clip);
        });
        playAnim('Idle');
    }
    updateCameraViewMode();
};

const playAnim = (name, crossfadeTime = 0.2) => {
    if (currentAnim === name) return;
    if (!animActions[name]) return;
    const prev = animActions[currentAnim];
    const next = animActions[name];
    if (prev) prev.fadeOut(crossfadeTime);
    next.reset().fadeIn(crossfadeTime).play();
    currentAnim = name;
};

const updateAnimState = (isMoving, isSprinting, isDead) => {
    if (isDead) { playAnim('Death', 0.1); return; }
    if (isSprinting && isMoving) playAnim('Run');
    else if (isMoving) playAnim('Walk');
    else playAnim('Idle');
};

// ============================================================================
// WEAPON MODEL
// ============================================================================
const weaponGroup = new THREE.Group();
const barrelMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.6),
    new THREE.MeshBasicMaterial({ color: 0x222222 })
);
weaponGroup.add(barrelMesh);
camera.add(weaponGroup);

// ============================================================================
// CAMERA VIEW MODES
// ============================================================================
const updateCameraViewMode = () => {
    if (!playerAvatar) return;
    if (STATE.cameraMode === 0) {
        // FPS View
        playerAvatar.visible = false;
        weaponGroup.visible = true;
        weaponGroup.position.set(0.25, -0.25, -0.5);
    } else {
        // TPS View
        playerAvatar.visible = true;
        weaponGroup.visible = false;
    }
};

// ============================================================================
// CHUNK SYSTEM
// ============================================================================
class AdaptiveChunkManager {
    constructor() {
        this.chunks = {};
        this.fallbackTreeGeo = new THREE.CylinderGeometry(0.2, 0.4, 8, 4);
        this.fallbackTreeMat = new THREE.MeshStandardMaterial({ color: 0x101710, roughness: 1.0 });
        this.buildGrid();
    }

    buildGrid() {
        for (let xIdx = 0; xIdx < CONFIG.chunksPerRow; xIdx++) {
            for (let zIdx = 0; zIdx < CONFIG.chunksPerRow; zIdx++) {
                const key = `${xIdx}_${zIdx}`;
                const startX = -CONFIG.mapLimit + xIdx * CONFIG.chunkSize;
                const startZ = -CONFIG.mapLimit + zIdx * CONFIG.chunkSize;
                const cx = startX + CONFIG.chunkSize / 2;
                const cz = startZ + CONFIG.chunkSize / 2;

                const group = new THREE.Group();
                group.visible = false;

                const useDeadTree = (Math.abs(cx) > 400 || Math.abs(cz) > 400);
                const treeModelKey = useDeadTree ? 'Dead_Tree' : 'Tree';

                for (let p = 0; p < CONFIG.pohonPerChunk; p++) {
                    let px = startX + Math.random() * CONFIG.chunkSize;
                    let pz = startZ + Math.random() * CONFIG.chunkSize;
                    if (Math.abs(px) < 25 && Math.abs(pz) < 25) continue;

                    let treeMesh;
                    if (loadedModels[treeModelKey]) {
                        treeMesh = loadedModels[treeModelKey].scene.clone();
                        treeMesh.scale.setScalar(0.8 + Math.random() * 0.6);
                    } else {
                        treeMesh = new THREE.Mesh(this.fallbackTreeGeo, this.fallbackTreeMat);
                    }
                    treeMesh.position.set(px, 0, pz);
                    treeMesh.rotation.y = Math.random() * Math.PI * 2;
                    group.add(treeMesh);
                }

                if (loadedModels['Tuft_of_grass']) {
                    for (let g = 0; g < Math.floor(CONFIG.pohonPerChunk / 3); g++) {
                        const gx = startX + Math.random() * CONFIG.chunkSize;
                        const gz = startZ + Math.random() * CONFIG.chunkSize;
                        const grass = loadedModels['Tuft_of_grass'].scene.clone();
                        grass.position.set(gx, 0, gz);
                        grass.rotation.y = Math.random() * Math.PI * 2;
                        group.add(grass);
                    }
                }

                scene.add(group);
                this.chunks[key] = {
                    group,
                    center: new THREE.Vector2(cx, cz),
                    isLoaded: false
                };
            }
        }
    }

    updateGrid(px, pz) {
        for (let key in this.chunks) {
            const chunk = this.chunks[key];
            const dist = chunk.center.distanceTo(new THREE.Vector2(px, pz));
            const shouldLoad = dist <= STATE.currentRenderDistance;
            if (shouldLoad !== chunk.isLoaded) {
                chunk.group.visible = shouldLoad;
                chunk.isLoaded = shouldLoad;
            }
        }
    }

    hideAll() {
        for (let key in this.chunks) {
            this.chunks[key].group.visible = false;
            this.chunks[key].isLoaded = false;
        }
    }
}
let chunkManager = null;

// ============================================================================
// POI STRUCTURES — PRE-BUILD, pakai visible
// ============================================================================
const POI_STRUCTURES = [
    {
        name: "GAZEBO",
        pos: new THREE.Vector3(-100, 0, -150),
        size: [16, 8, 16], color: 0x322929,
        halfW: 8, halfD: 8,
        modelKey: 'Gazebo', mesh: null
    },
    {
        name: "MENARA",
        pos: new THREE.Vector3(250, 0, -350),
        size: [5, 20, 5], color: 0x1d211d,
        halfW: 4, halfD: 4,
        modelKey: 'Building_construction_crane', mesh: null
    },
    {
        name: "PLAN",
        pos: new THREE.Vector3(400, 0, 200),
        size: [25, 10, 20], color: 0x3d3734,
        halfW: 14, halfD: 12,
        modelKey: 'Plan', mesh: null
    },
    {
        name: "BARRIER_CLUSTER",
        pos: new THREE.Vector3(-300, 0, 300),
        size: [10, 5, 10], color: 0x444444,
        halfW: 12, halfD: 12,
        modelKey: 'Barrier', mesh: null
    }
];

const preBuildPOI = () => {
    POI_STRUCTURES.forEach(b => {
        if (loadedModels[b.modelKey] && loadedModels[b.modelKey] !== null) {
            b.mesh = loadedModels[b.modelKey].scene.clone();
        } else {
            b.mesh = new THREE.Mesh(
                new THREE.BoxGeometry(...b.size),
                new THREE.MeshStandardMaterial({ color: b.color, roughness: 1.0 })
            );
            b.mesh.position.y = b.size[1] / 2;
        }
        b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
        b.mesh.visible = false;
        b.mesh.traverse(c => {
            if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
        });
        scene.add(b.mesh);
    });
};

const updatePOIVisibility = (pX, pZ) => {
    POI_STRUCTURES.forEach(b => {
        const dist = Math.sqrt((pX - b.pos.x) ** 2 + (pZ - b.pos.z) ** 2);
        const shouldShow = dist <= STATE.currentRenderDistance;
        if (b.mesh && b.mesh.visible !== shouldShow) b.mesh.visible = shouldShow;
        if (b.mesh && shouldShow) {
            const shadowDist = STATE.currentRenderDistance * 0.5;
            b.mesh.traverse(c => {
                if (c.isMesh) c.castShadow = dist < shadowDist;
            });
        }
    });
};

// ============================================================================
// WAVE SYSTEM
// ============================================================================
const WAVE_CONFIG = {
    1: { count: 10, hp: 3,  speed: 0.07, spawnRadius: 60 },
    2: { count: 18, hp: 5,  speed: 0.09, spawnRadius: 70 },
    3: { count: 28, hp: 8,  speed: 0.11, spawnRadius: 80 },
    4: { count: 35, hp: 12, speed: 0.13, spawnRadius: 90 },
    5: { count: 50, hp: 18, speed: 0.15, spawnRadius: 100 }
};

const getWaveConfig = (wave) => {
    const maxWave = Math.max(...Object.keys(WAVE_CONFIG).map(Number));
    if (wave <= maxWave) return WAVE_CONFIG[wave];
    return {
        count: Math.min(50, 35 + wave * 3),
        hp: 10 + wave * 3,
        speed: 0.13 + wave * 0.01,
        spawnRadius: 100
    };
};

// ============================================================================
// POOLED MONSTER — AI wander/detection/chase/attack
// ============================================================================
class PooledMonster {
    constructor() {
        if (loadedModels['Zombie'] && loadedModels['Zombie'] !== null) {
            this.mesh = loadedModels['Zombie'].scene.clone();
            this.mixer = new THREE.AnimationMixer(this.mesh);
            const zAnims = loadedModels['Zombie'].animations;
            this.zActions = {};
            if (zAnims && zAnims.length > 0) {
                zAnims.forEach((clip, i) => {
                    const key = ['Walk', 'Attack', 'Death'][i] || `z${i}`;
                    this.zActions[key] = this.mixer.clipAction(clip);
                });
                if (this.zActions['Walk']) this.zActions['Walk'].play();
            }
        } else {
            this.mesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.5, 0.5, 3, 6),
                new THREE.MeshStandardMaterial({ color: 0x3a6b3a, roughness: 0.9 })
            );
            this.mixer = null;
            this.zActions = {};
        }

        this.mesh.visible = false;
        scene.add(this.mesh);

        this.isActive = false;
        this.hp = 3;
        this.maxHp = 3;
        this.speed = 0.08;
        this.collisionRadius = 1.3;
        this.state = 'IDLE';
        this.wanderAngle = Math.random() * Math.PI * 2;
        this.wanderTimer = 0;
        this.growlTimer = Math.random() * 5;
        this.attackCooldown = 0;
    }

    spawn(x, z, waveConfig) {
        this.mesh.position.set(x, 0, z);
        this.hp = waveConfig.hp;
        this.maxHp = waveConfig.hp;
        this.speed = waveConfig.speed * (0.85 + Math.random() * 0.3);
        this.isActive = true;
        this.mesh.visible = true;
        this.state = 'WANDER';
        if (this.zActions['Walk']) this.zActions['Walk'].reset().fadeIn(0.2).play();
    }

    die() {
        this.isActive = false;
        this.state = 'IDLE';
        if (this.zActions['Death']) {
            if (this.zActions['Walk']) this.zActions['Walk'].fadeOut(0.1);
            this.zActions['Death'].reset().fadeIn(0.1).play();
        }
        setTimeout(() => { this.mesh.visible = false; }, 1200);
    }

    executeAI(playerPos, delta) {
        if (!this.isActive) return 'none';
        if (this.mixer) this.mixer.update(delta);

        const dist = this.mesh.position.distanceTo(playerPos);

        if (dist > 160) { this.mesh.visible = false; return 'none'; }
        this.mesh.visible = true;

        this.growlTimer -= delta;
        if (this.growlTimer <= 0 && dist < 30) {
            AudioSystem.monsterGrowl();
            this.growlTimer = 4 + Math.random() * 6;
        }

        this.attackCooldown = Math.max(0, this.attackCooldown - delta);

        if (dist < 1.5) {
            this.state = 'ATTACK';
            if (this.zActions['Attack']) {
                if (this.zActions['Walk']) this.zActions['Walk'].fadeOut(0.1);
                this.zActions['Attack'].reset().fadeIn(0.1).play();
            }
            if (this.attackCooldown <= 0) {
                this.attackCooldown = 1.0;
                return 'attack';
            }
            return 'none';
        } else if (dist < 60) {
            if (this.state === 'ATTACK' && this.zActions['Walk']) {
                if (this.zActions['Attack']) this.zActions['Attack'].fadeOut(0.1);
                this.zActions['Walk'].reset().fadeIn(0.1).play();
            }
            this.state = 'CHASE';
            this.mesh.lookAt(playerPos.x, this.mesh.position.y, playerPos.z);
            const dir = new THREE.Vector3().subVectors(playerPos, this.mesh.position).normalize();
            this.mesh.position.addScaledVector(dir, this.speed);
        } else {
            this.state = 'WANDER';
            this.wanderTimer -= delta;
            if (this.wanderTimer <= 0) {
                this.wanderAngle += (Math.random() - 0.5) * 1.5;
                this.wanderTimer = 1.5 + Math.random() * 2.0;
            }
            this.mesh.position.x += Math.cos(this.wanderAngle) * this.speed * 0.4;
            this.mesh.position.z += Math.sin(this.wanderAngle) * this.speed * 0.4;
            this.mesh.position.x = Math.max(-CONFIG.mapLimit, Math.min(CONFIG.mapLimit, this.mesh.position.x));
            this.mesh.position.z = Math.max(-CONFIG.mapLimit, Math.min(CONFIG.mapLimit, this.mesh.position.z));
        }
        return 'none';
    }
}

const monsterPool = [];
for (let i = 0; i < 50; i++) monsterPool.push(new PooledMonster());

// ============================================================================
// PERFORMANCE AUTO THROTTLING
// ============================================================================
let frameCount = 0, lastTime = performance.now();

const runPerformanceAutoThrottling = () => {
    if (!STATE.isAdaptiveActive) return;
    frameCount++;
    const time = performance.now();
    if (time >= lastTime + 1000) {
        STATE.fps = Math.round((frameCount * 1000) / (time - lastTime));
        frameCount = 0; lastTime = time;
        const fpsTxt = document.getElementById('fps-counter');
        if (fpsTxt) {
            fpsTxt.innerText = `FPS: ${STATE.fps}`;
            if (STATE.fps > 55) {
                STATE.currentRenderDistance = 250; STATE.currentResolutionScale = 1.0; STATE.maxActiveAICap = 35;
                renderer.shadowMap.enabled = true; fpsTxt.style.color = '#00ff44';
            } else if (STATE.fps >= 40) {
                STATE.currentRenderDistance = 180; STATE.currentResolutionScale = 0.9; STATE.maxActiveAICap = 25;
                renderer.shadowMap.enabled = true; fpsTxt.style.color = '#ffcc00';
            } else {
                STATE.currentRenderDistance = 120; STATE.currentResolutionScale = 0.75; STATE.maxActiveAICap = 15;
                renderer.shadowMap.enabled = false; fpsTxt.style.color = '#ff3333';
            }
        }
        renderer.setPixelRatio(window.devicePixelRatio * STATE.currentResolutionScale);
        camera.far = STATE.currentRenderDistance + 30;
        camera.updateProjectionMatrix();
        const engStatus = document.getElementById('engine-status');
        if (engStatus) engStatus.innerText = `Scale: ${Math.round(STATE.currentResolutionScale * 100)}% | Dist: ${STATE.currentRenderDistance}m`;
    }
};

// ============================================================================
// GAME MANAGER
// ============================================================================
class GameManager {
    constructor() {
        this.gameState = 'MENU';
        this.hp = 100;
        this.stamina = 100;
        this.ammo = 30;
        this.maxAmmo = 30;
        this.wave = 1;
        this.kills = 0;
        this.totalShots = 0;
        this.totalHits = 0;
        this.survivalStartTime = 0;
        this.highestWave = 1;
        this.keys = { w: false, a: false, s: false, d: false, shift: false };
        this.prevPlayerPos = new THREE.Vector3();
        this.actuallyMoved = false;
        this.waveMonsterCount = 0;
        this.waveKillCount = 0;
        this.monstersSpawnedInWave = 0;
        this.spawnTimer = 0;
        this.isDead = false;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('btn-play-normal').addEventListener('click', () => this.bootUpGame());
        document.getElementById('btn-restart').addEventListener('click', () => this.resetAndRestartGame());
        document.getElementById('btn-to-menu').addEventListener('click', () => this.exitToMainMenu());
        document.getElementById('btn-resume-setting').addEventListener('click', () => this.toggleSettingOverlay());

        document.getElementById('setting-flashlight').addEventListener('change', (e) => {
            flashlight.visible = e.target.checked;
        });
        document.getElementById('setting-sens').addEventListener('input', (e) => {
            if (controls.pointerSpeed !== undefined) controls.pointerSpeed = e.target.value * 0.2;
        });
        document.getElementById('setting-adaptive').addEventListener('change', (e) => {
            STATE.isAdaptiveActive = e.target.checked;
            if (!e.target.checked) {
                STATE.currentRenderDistance = 250; STATE.currentResolutionScale = 1.0;
                STATE.maxActiveAICap = 35; renderer.shadowMap.enabled = true;
                renderer.setPixelRatio(window.devicePixelRatio);
            }
        });

        controls.addEventListener('unlock', () => {
            if (this.gameState === 'PLAYING') this.toggleSettingOverlay();
        });

        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (k === '5') {
                if (this.gameState === 'PLAYING' && playerAvatar) {
                    STATE.cameraMode = (STATE.cameraMode + 1) % 3;
                    updateCameraViewMode();
                }
                return;
            }
            if (k === 'o') { this.toggleSettingOverlay(); return; }
            if (this.gameState !== 'PLAYING') return;
            if (['w', 'a', 's', 'd'].includes(k)) this.keys[k] = true;
            if (e.key === 'Shift') this.keys.shift = true;
            if (k === 'r') this.reloadWeapon();
        });

        window.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if (['w', 'a', 's', 'd'].includes(k)) this.keys[k] = false;
            if (e.key === 'Shift') this.keys.shift = false;
        });

        window.addEventListener('mousedown', (e) => {
            if (this.gameState === 'PLAYING' && e.button === 0 && controls.isLocked) {
                this.fireActiveWeapon();
            }
        });
    }

    bootUpGame() {
        AudioSystem.init();
        this.gameState = 'PLAYING';
        this.isDead = false;
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-over-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        document.getElementById('perf-debug').classList.remove('hidden');
        playerGroup.position.set(0, 0, 0);
        if (playerAvatar) updateCameraViewMode();
        controls.lock();
        this.startWave(this.wave);
        this.survivalStartTime = Date.now();
    }

    toggleSettingOverlay() {
        if (this.gameState === 'PLAYING') {
            this.gameState = 'SETTING';
            controls.unlock();
            document.getElementById('setting-menu').classList.remove('hidden');
        } else if (this.gameState === 'SETTING') {
            this.gameState = 'PLAYING';
            document.getElementById('setting-menu').classList.add('hidden');
            controls.lock();
        }
    }

    startWave(waveNum) {
        this.wave = waveNum;
        if (waveNum > this.highestWave) this.highestWave = waveNum;
        this.waveKillCount = 0;
        this.monstersSpawnedInWave = 0;
        const cfg = getWaveConfig(waveNum);
        this.waveMonsterCount = cfg.count;
        document.getElementById('wave-text').innerText = `WAVE ${waveNum}`;
        monsterPool.forEach(m => { if (m.isActive) m.die(); });
        
        // Pemicu spawn gelombang awal
        this.tickSpawning(0); 
    }

    tickSpawning(delta) {
        const cfg = getWaveConfig(this.wave);
        const currentActive = monsterPool.filter(m => m.isActive).length;
        
        if (this.monstersSpawnedInWave < this.waveMonsterCount && currentActive < STATE.maxActiveAICap) {
            this.spawnTimer += delta;
            if (this.spawnTimer >= 0.8 || delta === 0) {
                this.spawnTimer = 0;
                const mToSpawn = monsterPool.find(m => !m.isActive);
                if (mToSpawn) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = cfg.spawnRadius + Math.random() * 30;
                    mToSpawn.spawn(
                        playerGroup.position.x + Math.cos(angle) * r,
                        playerGroup.position.z + Math.sin(angle) * r,
                        cfg
                    );
                    this.monstersSpawnedInWave++;
                }
            }
        }
    }

    nextWave() {
        document.getElementById('wave-text').innerText = `WAVE ${this.wave} CLEAR!`;
        setTimeout(() => this.startWave(this.wave + 1), 3000);
    }

    resetAndRestartGame() {
        this.hp = 100; this.stamina = 100; this.ammo = 30;
        this.kills = 0; this.totalShots = 0; this.totalHits = 0;
        this.wave = 1; this.highestWave = 1; this.isDead = false;
        document.getElementById('hp-txt').innerText = '100';
        document.getElementById('hp-bar').style.width = '100%';
        document.getElementById('stamina-bar').style.width = '100%';
        document.getElementById('weap-ammo').innerText = 'AMMO: 30 / 30';
        document.getElementById('blood-vignette').style.display = 'none';
        this.bootUpGame();
    }

    exitToMainMenu() {
        this.gameState = 'MENU';
        document.getElementById('game-over-screen').classList.add('hidden');
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('perf-debug').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        monsterPool.forEach(m => m.die());
        if (chunkManager) chunkManager.hideAll();
        POI_STRUCTURES.forEach(b => { if (b.mesh) b.mesh.visible = false; });
    }

    fireActiveWeapon() {
        if (this.ammo <= 0) return;
        this.ammo--;
        this.totalShots++;
        AudioSystem.gunshot();
        document.getElementById('weap-ammo').innerText = `AMMO: ${this.ammo} / ${this.maxAmmo}`;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const activeTargets = monsterPool
            .filter(m => m.isActive && m.mesh.visible)
            .map(m => m.mesh);
        const hits = raycaster.intersectObjects(activeTargets, true);
        if (hits.length > 0) {
            let hitObj = hits[0].object;
            const monster = monsterPool.find(m => m.mesh === hitObj || m.mesh.getObjectById(hitObj.id) || (hitObj.parent && m.mesh.getObjectById(hitObj.parent.id)));
            if (monster && monster.isActive) {
                this.totalHits++;
                monster.hp -= 1;
                if (monster.hp <= 0) {
                    monster.die();
                    this.kills++;
                    this.waveKillCount++;
                    AudioSystem.death();
                    document.getElementById('kill-counter').innerText = `Kills: ${this.kills}`;
                    if (this.waveKillCount >= this.waveMonsterCount) this.nextWave();
                }
            }
        }
    }

    reloadWeapon() {
        if (this.ammo === this.maxAmmo) return;
        document.getElementById('weap-ammo').innerText = 'RELOADING...';
        AudioSystem.reload();
        setTimeout(() => {
            this.ammo = this.maxAmmo;
            document.getElementById('weap-ammo').innerText = `AMMO: ${this.ammo} / ${this.maxAmmo}`;
        }, 1100);
    }

    handleCollisions() {
        const px = playerGroup.position.x;
        const pz = playerGroup.position.z;

        monsterPool.forEach(m => {
            if (!m.isActive || !m.mesh.visible) return;
            const dist = Math.sqrt((px - m.mesh.position.x) ** 2 + (pz - m.mesh.position.z) ** 2);
            if (dist < m.collisionRadius) {
                playerGroup.position.copy(this.prevPlayerPos);
                this.hp = Math.max(0, this.hp - 0.25);
                AudioSystem.damage();
                document.getElementById('hp-txt').innerText = Math.ceil(this.hp);
                document.getElementById('hp-bar').style.width = `${this.hp}%`;
                if (this.hp < 35) document.getElementById('blood-vignette').style.display = 'block';
                if (this.hp <= 0) this.triggerGameOver();
            }
        });

        // AABB collision bangunan
        POI_STRUCTURES.forEach(b => {
            if (!b.mesh || !b.mesh.visible) return;
            const insideX = Math.abs(px - b.pos.x) < b.halfW;
            const insideZ = Math.abs(pz - b.pos.z) < b.halfD;
            if (insideX && insideZ) playerGroup.position.copy(this.prevPlayerPos);
        });
    }

    triggerGameOver() {
        this.isDead = true;
        this.gameState = 'GAMEOVER';
        controls.unlock();
        const survivalSecs = Math.floor((Date.now() - this.survivalStartTime) / 1000);
        const mins = Math.floor(survivalSecs / 60);
        const secs = survivalSecs % 60;
        const accuracy = this.totalShots > 0 ? Math.round((this.totalHits / this.totalShots) * 100) : 0;

        document.getElementById('hud').classList.add('hidden');
        document.getElementById('perf-debug').classList.add('hidden');
        document.getElementById('game-over-screen').classList.remove('hidden');

        document.getElementById('stat-kills').innerText = this.kills;
        document.getElementById('stat-wave').innerText = this.highestWave;
        document.getElementById('stat-time').innerText = `${mins}m ${secs}s`;
        document.getElementById('stat-accuracy').innerText = `${accuracy}%`;
    }

    updateMovement(delta) {
        if (this.gameState !== 'PLAYING' || this.isDead) return;

        this.prevPlayerPos.copy(playerGroup.position);

        let isMoving = this.keys.w || this.keys.a || this.keys.s || this.keys.d;
        let isSprinting = this.keys.shift && isMoving && this.stamina > 5;

        let currentSpeed = isSprinting ? CONFIG.sprintSpeed : CONFIG.normalSpeed;

        if (this.keys.w) controls.moveForward(currentSpeed);
        if (this.keys.s) controls.moveForward(-currentSpeed);
        if (this.keys.a) controls.moveRight(-currentSpeed);
        if (this.keys.d) controls.moveRight(currentSpeed);

        // Batasi Map Boundary
        playerGroup.position.x = Math.max(-CONFIG.mapLimit, Math.min(CONFIG.mapLimit, playerGroup.position.x));
        playerGroup.position.z = Math.max(-CONFIG.mapLimit, Math.min(CONFIG.mapLimit, playerGroup.position.z));

        // Drain / Regen Stamina secara pasif & aktif bergerak
        if (isSprinting) {
            this.stamina = Math.max(0, this.stamina - delta * 35);
        } else {
            this.stamina = Math.min(100, this.stamina + delta * 15);
        }
        document.getElementById('stamina-bar').style.width = `${this.stamina}%`;

        // Integrasi Audio Footstep & Sinkronisasi Orientasi Avatar Player
        if (isMoving) {
            AudioSystem.footstep(delta, true, isSprinting);
            if (playerAvatar) {
                // Biarkan model menghadap sesuai arah kamera internal pointerlock
                const camDir = new THREE.Vector3();
                camera.getWorldDirection(camDir);
                playerAvatar.rotation.y = Math.atan2(camDir.x, camDir.z) + Math.PI;
            }
        }

        updateAnimState(isMoving, isSprinting, this.isDead);
        this.handleCollisions();
    }
}

const gameManager = new GameManager();

// ============================================================================
// MAIN GAME LOOP
// ============================================================================
const animate = () => {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    runPerformanceAutoThrottling();

    if (gameManager.gameState === 'PLAYING') {
        gameManager.tickSpawning(delta);
        gameManager.updateMovement(delta);

        // Update seluruh AI monster aktif
        monsterPool.forEach(monster => {
            if (monster.isActive) {
                const action = monster.executeAI(playerGroup.position, delta);
                if (action === 'attack') {
                    // Beri serangan langsung instan jika monster berada sangat dekat
                    gameManager.hp = Math.max(0, gameManager.hp - 4);
                    AudioSystem.damage();
                    document.getElementById('hp-txt').innerText = Math.ceil(gameManager.hp);
                    document.getElementById('hp-bar').style.width = `${gameManager.hp}%`;
                    if (gameManager.hp < 35) document.getElementById('blood-vignette').style.display = 'block';
                    if (gameManager.hp <= 0) gameManager.triggerGameOver();
                }
            }
        });

        // Update Chunk & POI sesuai posisi pemain
        if (chunkManager) chunkManager.updateGrid(playerGroup.position.x, playerGroup.position.z);
        updatePOIVisibility(playerGroup.position.x, playerGroup.position.z);

        // Smooth Camera Lerping (TPS & FPS Hybrid View)
        if (STATE.cameraMode === 0) {
            // Pasang kamera sejajar di tengah playerGroup pusat koordinat FPS
            camera.position.copy(playerGroup.position).add(new THREE.Vector3(0, 2.0, 0));
        } else {
            // Perhitungan TPS: Buat offset di belakang kepala pemain (Over-the-shoulder)
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            
            const offsetDist = STATE.cameraMode === 1 ? 3.5 : 6.0; 
            const sideOffset = STATE.cameraMode === 1 ? 0.7 : 0.0;

            const targetCamPos = playerGroup.position.clone()
                .add(new THREE.Vector3(0, 2.4, 0))
                .addScaledVector(camDir, -offsetDist);
            
            // Tambahkan offset kanan/kiri pundak jika mode TPS Close
            const rightVector = new THREE.Vector3(0, 1, 0).cross(camDir).normalize();
            targetCamPos.addScaledVector(rightVector, sideOffset);

            camera.position.lerp(targetCamPos, STATE.cameraLerpSpeed);
        }

        // Jalankan transisi mixer internal animasi player avatar
        if (mixer) mixer.update(delta);
    }

    renderer.render(scene, camera);
};

// Start Loop Engine
animate();
