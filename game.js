// ============================================================================
// SYSTEM ENGINE CONFIGURATIONS V1.9.2 (F5 & UNLOCK EVENT GUARD FIX)
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
    cameraMode: 0
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new THREE.PointerLockControls(camera, renderer.domElement);
const playerGroup = new THREE.Group(); 
scene.add(playerGroup);

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

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600), 
    new THREE.MeshStandardMaterial({ color: 0x030603, roughness: 1.0 })
);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

let playerAvatar = null;
let mixer = null; 
const clock = new THREE.Clock();

const weaponGroup = new THREE.Group();
const barrelMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.6), new THREE.MeshBasicMaterial({ color: 0x222222 }));
weaponGroup.add(barrelMesh); camera.add(weaponGroup);

const updateCameraViewMode = () => {
    if (!playerAvatar) return;

    playerAvatar.rotation.set(0, 0, 0);
    weaponGroup.position.set(0.25, -0.25, -0.5);

    if (STATE.cameraMode === 0) {
        playerAvatar.visible = false;
        weaponGroup.visible = true;
        camera.position.y = playerGroup.position.y + 1.8;
    } 
    else if (STATE.cameraMode === 1) {
        playerAvatar.visible = true;
        weaponGroup.visible = false;
        camera.position.set(
            playerGroup.position.x,
            playerGroup.position.y + 2.3,
            playerGroup.position.z + 3.5
        );
    } 
    else if (STATE.cameraMode === 2) {
        playerAvatar.visible = true;
        weaponGroup.visible = false;
        camera.position.set(
            playerGroup.position.x,
            playerGroup.position.y + 2.0,
            playerGroup.position.z - 3.0
        );
        playerAvatar.rotation.y = Math.PI;
    }
};

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
        playBtn.innerText = "START SURVIVAL";
        playBtn.removeAttribute('disabled');
        document.getElementById('loader-status').innerText = "Asset: Adventurer Ready";
        
        updateCameraViewMode();
    },
    (xhr) => {
        if(xhr.total > 0) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            document.getElementById('btn-play-normal').innerText = `LOADING MODEL (${percent}%)`;
        } else {
            document.getElementById('btn-play-normal').innerText = `FETCHING 3D MODEL...`;
        }
    },
    (error) => {
        console.error('Gagal memuat model 3D Avatar:', error);
        document.getElementById('btn-play-normal').innerText = "START SURVIVAL (Model Error)";
        document.getElementById('btn-play-normal').removeAttribute('disabled');
    }
);

// ============================================================================
// ADAPTIVE CHUNK SYSTEM MODULE (10x10)
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
                instMesh.castShadow = false; instMesh.receiveShadow = false;
                
                const dummy = new THREE.Object3D();
                positions.forEach((pos, idx) => {
                    dummy.position.copy(pos); dummy.updateMatrix();
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
                if (!chunk.isLoaded) { scene.add(chunk.mesh); chunk.isLoaded = true; }
                chunk.mesh.castShadow = (distance < 70 && renderer.shadowMap.enabled);
            } else {
                if (chunk.isLoaded) { scene.remove(chunk.mesh); chunk.isLoaded = false; }
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

const POI_STRUCTURES = [
    { name: "RUMAH", pos: new THREE.Vector3(-100, 4, -150), size: [16, 8, 16], color: 0x322929, mesh: null, rad: 10.0 },
    { name: "MENARA", pos: new THREE.Vector3(250, 10, -350), size: [5, 20, 5], color: 0x1d211d, mesh: null, rad: 5.0 },
    { name: "GUDANG", pos: new THREE.Vector3(400, 5, 200), size: [25, 10, 20], color: 0x3d3734, mesh: null, rad: 15.0 }
];

const updateBuildings = (pX, pZ) => {
    POI_STRUCTURES.forEach(b => {
        const distance = new THREE.Vector2(b.pos.x, b.pos.z).distanceTo(new THREE.Vector2(pX, pZ));
        if (distance <= STATE.currentRenderDistance) {
            if (!b.mesh) {
                b.mesh = new THREE.Mesh(new THREE.BoxGeometry(...b.size), new THREE.MeshStandardMaterial({ color: b.color, roughness: 1.0 }));
                b.mesh.position.copy(b.pos); scene.add(b.mesh);
            }
            b.mesh.castShadow = (distance < 100);
        } else {
            if (b.mesh) { scene.remove(b.mesh); b.mesh = null; }
        }
    });
};

class PooledMonster {
    constructor() {
        this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 4), new THREE.MeshBasicMaterial({ color: 0xaa1111 }));
        this.mesh.visible = false;
        scene.add(this.mesh);
        this.isActive = false; this.isSleeping = true; this.hp = 3; this.speed = 0.08; this.collisionRadius = 1.3;
    }
    spawn(x, z) {
        this.mesh.position.set(x, 1.5, z); this.hp = 3; this.isActive = true; this.isSleeping = false; this.mesh.visible = true;
    }
    despawn() {
        this.isActive = false; this.isSleeping = true; this.mesh.visible = false;
    }
    executeAI(playerPos) {
        if (!this.isActive) return;
        const distance = this.mesh.position.distanceTo(playerPos);
        if (distance > 150) {
            if (!this.isSleeping) { this.isSleeping = true; this.mesh.visible = false; }
            return; 
        }
        this.isSleeping = false; this.mesh.visible = true;
        this.mesh.lookAt(playerPos.x, this.mesh.position.y, playerPos.z);
        const dir = new THREE.Vector3().subVectors(playerPos, this.mesh.position).normalize();
        this.mesh.position.addScaledVector(dir, this.speed);
    }
}

const monsterPool = [];
for (let i = 0; i < 50; i++) { monsterPool.push(new PooledMonster()); }

let frameCount = 0, lastTime = performance.now();
const runPerformanceAutoThrottling = () => {
    if(!STATE.isAdaptiveActive) return;
    frameCount++; const time = performance.now();
    if (time >= lastTime + 1000) {
        STATE.fps = Math.round((frameCount * 1000) / (time - lastTime));
        frameCount = 0; lastTime = time;
        const fpsTxt = document.getElementById('fps-counter'); fpsTxt.innerText = `FPS: ${STATE.fps}`;

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
        renderer.setPixelRatio(window.devicePixelRatio * STATE.currentResolutionScale);
        camera.far = STATE.currentRenderDistance + 30; camera.updateProjectionMatrix();
        document.getElementById('engine-status').innerText = `Scale: ${Math.round(STATE.currentResolutionScale*100)}% | Dist: ${STATE.currentRenderDistance}m`;
    }
};

class GameManager {
    constructor() {
        this.gameState = 'MENU';
        this.hp = 100; this.stamina = 100; this.ammo = 30; this.maxAmmo = 30; this.wave = 1; this.kills = 0;
        this.keys = { w: false, a: false, s: false, d: false, shift: false };
        this.prevPlayerPos = new THREE.Vector3();
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('btn-play-normal').addEventListener('click', () => this.bootUpGame());
        document.getElementById('btn-restart').addEventListener('click', () => this.resetAndRestartGame());
        document.getElementById('btn-to-menu').addEventListener('click', () => this.exitToMainMenu());
        document.getElementById('btn-resume-setting').addEventListener('click', () => this.toggleSettingOverlay());

        document.getElementById('setting-flashlight').addEventListener('change', (e) => { flashlight.visible = e.target.checked; });
        document.getElementById('setting-sens').addEventListener('input', (e) => {
            if(controls.pointerSpeed !== undefined) controls.pointerSpeed = e.target.value * 0.2;
        });
        document.getElementById('setting-adaptive').addEventListener('change', (e) => {
            STATE.isAdaptiveActive = e.target.checked;
            if(!e.target.checked) {
                STATE.currentRenderDistance = 250; STATE.currentResolutionScale = 1.0; STATE.maxActiveAICap = 35;
                renderer.shadowMap.enabled = true; renderer.setPixelRatio(window.devicePixelRatio);
            }
        });

        controls.addEventListener('unlock', () => {
            if (this.gameState === 'PLAYING') {
                this.toggleSettingOverlay();
            }
        });

        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();

            // TOMBOL 5 UNTUK GANTI KAMERA
            if (k === '5') {
                if (this.gameState === 'PLAYING' && playerAvatar) {
                    STATE.cameraMode = (STATE.cameraMode + 1) % 3;
                    updateCameraViewMode();
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
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-over-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        document.getElementById('perf-debug').classList.remove('hidden');
        
        playerGroup.position.set(0, 0, 0); 
        if(playerAvatar) updateCameraViewMode();
        controls.lock();
        this.generateActiveWaveMonsters();
    }

    toggleSettingOverlay() {
        if (this.gameState === 'PLAYING') {
            this.gameState = 'SETTING'; controls.unlock();
            document.getElementById('setting-menu').classList.remove('hidden');
        } else if (this.gameState === 'SETTING') {
            this.gameState = 'PLAYING';
            document.getElementById('setting-menu').classList.add('hidden'); controls.lock();
        }
    }

    resetAndRestartGame() {
        this.hp = 100; this.stamina = 100; this.ammo = 30; this.kills = 0;
        document.getElementById('hp-txt').innerText = "100";
        document.getElementById('hp-bar').style.width = "100%";
        document.getElementById('stamina-bar').style.width = "100%";
        document.getElementById('weap-ammo').innerText = `AMMO: 30 / 30`;
        document.getElementById('blood-vignette').style.display = 'none';
        this.bootUpGame();
    }

    exitToMainMenu() {
        this.gameState = 'MENU';
        document.getElementById('game-over-screen').classList.add('hidden');
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('perf-debug').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        monsterPool.forEach(m => m.despawn());
        chunkManager.removeAllFromScene();
    }

    generateActiveWaveMonsters() {
        monsterPool.forEach(m => m.despawn());
        for (let i = 0; i < STATE.maxActiveAICap; i++) {
            const angle = Math.random() * Math.PI * 2;
            const sX = playerGroup.position.x + Math.cos(angle) * (60 + Math.random()*60);
            const sZ = playerGroup.position.z + Math.sin(angle) * (60 + Math.random()*60);
            monsterPool[i].spawn(sX, sZ);
        }
    }

    fireActiveWeapon() {
        if (this.ammo <= 0) return;
        this.ammo--;
        document.getElementById('weap-ammo').innerText = `AMMO: ${this.ammo} / ${this.maxAmmo}`;

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
                    const angle = Math.random() * Math.PI * 2;
                    monster.spawn(playerGroup.position.x + Math.cos(angle)*100, playerGroup.position.z + Math.sin(angle)*100);
                }
            }
        }
    }

    reloadWeapon() {
        document.getElementById('weap-ammo').innerText = "RELOADING...";
        setTimeout(() => {
            this.ammo = this.maxAmmo;
            document.getElementById('weap-ammo').innerText = `AMMO: ${this.ammo} / ${this.maxAmmo}`;
        }, 1100);
    }

    handleSphereCollisions() {
        const px = playerGroup.position.x;
        const pz = playerGroup.position.z;

        monsterPool.forEach(m => {
            if (!m.isActive || m.isSleeping) return;
            const dist = Math.sqrt((px - m.mesh.position.x)**2 + (pz - m.mesh.position.z)**2);
            if (dist < m.collisionRadius) {
                playerGroup.position.set(this.prevPlayerPos.x, playerGroup.position.y, this.prevPlayerPos.z);
                this.hp = Math.max(0, this.hp - 0.25);
                document.getElementById('hp-txt').innerText = Math.ceil(this.hp);
                document.getElementById('hp-bar').style.width = `${this.hp}%`;
                if(this.hp < 35) document.getElementById('blood-vignette').style.display = 'block';
                if (this.hp <= 0) { this.triggerGameOver(); }
            }
        });

        POI_STRUCTURES.forEach(b => {
            if (!b.mesh) return;
            const dist = Math.sqrt((px - b.pos.x)**2 + (pz - b.pos.z)**2);
            if (dist < b.rad) playerGroup.position.set(this.prevPlayerPos.x, playerGroup.position.y, this.prevPlayerPos.z);
        });
    }

    triggerGameOver() {
        this.gameState = 'GAMEOVER'; controls.unlock();
        document.getElementById('end-stats').innerText = `Total Kills: ${this.kills} | Difficulty Guard Active`;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }

    runTickUpdate() {
        if (this.gameState !== 'PLAYING' || !controls.isLocked) return;

        this.prevPlayerPos.copy(playerGroup.position);
        let moveSpeed = (this.keys.shift && this.stamina > 10) ? CONFIG.sprintSpeed : CONFIG.normalSpeed;

        if (this.keys.shift && (this.keys.w || this.keys.a || this.keys.s || this.keys.d)) {
            this.stamina = Math.max(0, this.stamina - 0.35);
        } else {
            this.stamina = Math.min(100, this.stamina + 0.2);
        }
        document.getElementById('stamina-bar').style.width = `${this.stamina}%`;

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

        // SINKRONISASI KAMERA KE PLAYERGROUP SETIAP FRAME
        if (STATE.cameraMode === 0) {
            camera.position.x = playerGroup.position.x;
            camera.position.z = playerGroup.position.z;
            camera.position.y = playerGroup.position.y + 1.8;
        } else if (STATE.cameraMode === 1) {
            const backOffset = new THREE.Vector3(0, 0, 3.5).applyQuaternion(camera.quaternion);
            backOffset.y = 0;
            camera.position.x = playerGroup.position.x + backOffset.x;
            camera.position.z = playerGroup.position.z + backOffset.z;
            camera.position.y = playerGroup.position.y + 2.3;
        } else if (STATE.cameraMode === 2) {
            const frontOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(camera.quaternion);
            frontOffset.y = 0;
            camera.position.x = playerGroup.position.x + frontOffset.x;
            camera.position.z = playerGroup.position.z + frontOffset.z;
            camera.position.y = playerGroup.position.y + 2.0;
        }

        if (STATE.cameraMode === 1 && playerAvatar) {
            const targetRotation = Math.atan2(forwardDir.x, forwardDir.z);
            playerAvatar.rotation.y = targetRotation;
        }

        chunkManager.updateGrid(playerGroup.position.x, playerGroup.position.z);
        updateBuildings(playerGroup.position.x, playerGroup.position.z);
        
        let currentActiveAICount = 0;
        monsterPool.forEach(m => {
            if (m.isActive && !m.isSleeping) currentActiveAICount++;
            m.executeAI(playerGroup.position);
        });
        
        this.handleSphereCollisions();

        document.getElementById('three-drawcalls').innerText = `Draw Calls: ${renderer.info.render.calls}`;
        document.getElementById('three-tris').innerText = `Triangles: ${renderer.info.render.triangles}`;
        document.getElementById('geo-info').innerText = `XYZ: ${Math.floor(playerGroup.position.x)}, ${Math.floor(playerGroup.position.z)} | Active AI: ${currentActiveAICount}`;
    }
}

const gameManager = new GameManager();

const masterLoop = () => {
    requestAnimationFrame(masterLoop);
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    if (gameManager.gameState === 'PLAYING') runPerformanceAutoThrottling();
    gameManager.runTickUpdate();
    renderer.render(scene, camera);
};
masterLoop();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
