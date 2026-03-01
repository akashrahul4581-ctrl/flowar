import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

class FlowARController {
    constructor() {
        this.container = document.createElement('div');
        document.body.appendChild(this.container);

        // Core Three Setup
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true; // Enable WebXR!
        this.container.appendChild(this.renderer.domElement);

        // Lights
        const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
        light.position.set(0.5, 1, 0.25);
        this.scene.add(light);

        // State Machine
        this.state = 'POSITIONING'; // POSITIONING -> MARKING
        this.hardwareModel = null;
        this.holeMarkers = [];
        this.holeCount = 0;

        // Setup UI First
        this.setupUI();

        // Voice Synth Initialization
        this.synth = window.speechSynthesis;
        this.isVoiceEnabled = false;

        // Setup AR Session
        this.setupXR();

        // Create the model
        this.createHardwareModel();

        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    // --- Voice Guidance Helper ---
    speak(text) {
        if (!this.synth || !this.isVoiceEnabled) return;

        if (this.synth.speaking) {
            this.synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        const voices = this.synth.getVoices();
        const preferredVoice = voices.find(v => v.lang.includes('en') && (v.name.includes('Google') || v.name.includes('Samantha')));
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        this.synth.speak(utterance);
    }

    createHardwareModel() {
        // Create a compound object that looks like a Concealed Hinge
        this.hardwareModel = new THREE.Group();

        // 1. The Main Hinge Cup (Goes into the door)
        const cupGeo = new THREE.CylinderGeometry(0.0175, 0.0175, 0.012, 32); // 35mm diameter cup
        const metalMat = new THREE.MeshStandardMaterial({
            color: 0xaaaaaa, // Silver/Steel
            roughness: 0.3,
            metalness: 0.8
        });
        const cup = new THREE.Mesh(cupGeo, metalMat);
        cup.rotation.x = Math.PI / 2; // Lay flat
        this.hardwareModel.add(cup);

        // 2. The Flanges/Wings (Where screws go)
        const wingGeo = new THREE.BoxGeometry(0.06, 0.002, 0.015);
        const wing = new THREE.Mesh(wingGeo, metalMat);
        wing.position.set(0, 0.005, 0); // slightly above cup
        this.hardwareModel.add(wing);

        // 3. The Arm
        const armGeo = new THREE.BoxGeometry(0.012, 0.005, 0.08);
        const arm = new THREE.Mesh(armGeo, metalMat);
        arm.position.set(0, 0.005, -0.04);
        this.hardwareModel.add(arm);

        // 4. Target Hole Indicators (Visual guides for the user)
        const targetMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.7 });
        const ringGeo = new THREE.RingGeometry(0.003, 0.004, 16);

        // Left Screw Hole Target
        const leftHole = new THREE.Mesh(ringGeo, targetMat);
        leftHole.rotation.x = -Math.PI / 2;
        leftHole.position.set(-0.022, 0.007, 0);
        this.hardwareModel.add(leftHole);

        // Right Screw Hole Target
        const rightHole = new THREE.Mesh(ringGeo, targetMat);
        rightHole.rotation.x = -Math.PI / 2;
        rightHole.position.set(0.022, 0.007, 0);
        this.hardwareModel.add(rightHole);

        // Arm Mounting Target
        const backHole = new THREE.Mesh(ringGeo, targetMat);
        backHole.rotation.x = -Math.PI / 2;
        backHole.position.set(0, 0.007, -0.07);
        this.hardwareModel.add(backHole);

        // Initially hide until AR starts
        this.hardwareModel.visible = false;
        this.scene.add(this.hardwareModel);
    }

    setupXR() {
        // Request no special features, just standard AR camera overlay
        const arButton = ARButton.createButton(this.renderer, {
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.getElementById('ui-layer') }
        });

        arButton.addEventListener('click', () => {
            this.isVoiceEnabled = true;
            const unlock = new SpeechSynthesisUtterance('');
            this.synth.speak(unlock);
        });

        document.body.appendChild(arButton);

        this.updateStatus("Waiting for AR Start");

        this.renderer.xr.addEventListener('sessionstart', () => {
            this.updateStatus("Position Model");
            this.ui.controls.classList.remove('hidden');

            // In POSITIONING state, attach the model exactly 0.5m in front of the camera
            // We do this by adding it to a pivot that follows the camera
            this.hardwareModel.position.set(0, -0.1, -0.4); // 40cm away
            this.camera.add(this.hardwareModel);
            this.scene.add(this.camera); // Ensure camera is in scene

            this.hardwareModel.visible = true;

            setTimeout(() => {
                this.speak("Welcome. The metallic hinge forms instantly. Aim your camera at your desk and tap Place Here on your screen to anchor it.");
            }, 1000);
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            if (this.state === 'POSITIONING') {
                this.camera.remove(this.hardwareModel);
            }
            this.hardwareModel.visible = false;
            this.ui.controls.classList.add('hidden');
            this.ui.dataPanel.classList.add('hidden');
        });

        // Controller (handles screen taps in AR)
        this.controller = this.renderer.xr.getController(0);
        this.controller.addEventListener('select', this.onSelect.bind(this));
        this.scene.add(this.controller);

        // Render Loop
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    setupUI() {
        this.ui = {
            status: document.getElementById('status-badge'),
            title: document.getElementById('instruction-title'),
            desc: document.getElementById('instruction-desc'),
            dataPanel: document.getElementById('data-panel'),
            angleX: document.getElementById('data-angle-x'),
            angleY: document.getElementById('data-angle-y'),
            holes: document.getElementById('data-holes'),
            btnPlace: document.getElementById('btn-place'),
            btnReset: document.getElementById('btn-reset'),
            btnFinish: document.getElementById('btn-finish'),
            controls: document.getElementById('action-controls')
        };

        this.ui.btnPlace.addEventListener('click', () => this.placeModel());
        this.ui.btnReset.addEventListener('click', () => this.resetSimulation());
        this.ui.btnFinish.addEventListener('click', () => this.finishSimulation());
    }

    updateStatus(msg) {
        if (this.ui.status) this.ui.status.textContent = msg;
    }

    setInstruction(title, desc) {
        this.ui.title.textContent = title;
        this.ui.desc.textContent = desc;
    }

    placeModel() {
        if (this.state !== 'POSITIONING') return;

        // Detach from camera and append directly to the world scene
        // We capture its precise current world matrix before detaching
        const worldPosition = new THREE.Vector3();
        const worldQuaternion = new THREE.Quaternion();

        this.hardwareModel.getWorldPosition(worldPosition);
        this.hardwareModel.getWorldQuaternion(worldQuaternion);

        this.camera.remove(this.hardwareModel);

        this.hardwareModel.position.copy(worldPosition);
        this.hardwareModel.quaternion.copy(worldQuaternion);

        // Critical: Force scale to exactly 1 so it doesn't drift when camera moves
        this.hardwareModel.scale.set(1, 1, 1);

        // Attach to pure world space
        this.scene.add(this.hardwareModel);

        this.state = 'MARKING';
        this.updateStatus("Model Anchored");
        this.setInstruction("Step 2: Mark Holes", "Tap directly on the glowing blue hole targets on the hinge to mark them.");

        this.ui.btnPlace.classList.add('hidden');
        this.ui.btnReset.classList.remove('hidden');
        this.ui.dataPanel.classList.remove('hidden');

        this.speak("Hardware Anchored. Step 2: Ensure it is sitting flat, then tap the three blue target rings to mark your pilot holes.");
    }

    onSelect() {
        if (this.state === 'MARKING') {
            // Raycast from the controller to the placed model to mark a hole
            this.markHole();
        }
    }

    updateAngleCalculation() {
        if (!this.hardwareModel) return;

        const euler = new THREE.Euler().setFromQuaternion(this.hardwareModel.quaternion);
        const toDegrees = (rad) => Math.abs(Math.round(rad * (180 / Math.PI)));

        const degX = toDegrees(euler.x);
        const degY = toDegrees(euler.y);

        this.ui.angleX.textContent = `${degX}°`;
        this.ui.angleY.textContent = `${degY}°`;

        if (degX < 5) {
            this.ui.angleX.className = "success-text";
        } else {
            this.ui.angleX.className = "error-text";
        }
    }

    markHole() {
        if (this.holeCount >= 3) return;

        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(this.controller.matrixWorld);

        const raycaster = new THREE.Raycaster();
        raycaster.ray.origin.setFromMatrixPosition(this.controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        // Check intersection purely against the hardware block
        const intersects = raycaster.intersectObject(this.hardwareModel, false);

        if (intersects.length > 0) {
            const hit = intersects[0];

            const markerGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.005, 16);
            const markerMat = new THREE.MeshBasicMaterial({ color: 0xff003c });
            const marker = new THREE.Mesh(markerGeo, markerMat);

            marker.position.copy(hit.point);
            const n = hit.face.normal.clone();
            n.transformDirection(hit.object.matrixWorld);
            n.add(hit.point);
            marker.lookAt(n);
            marker.rotateX(Math.PI / 2);

            this.scene.add(marker);
            this.holeMarkers.push(marker);

            this.holeCount++;
            this.ui.holes.textContent = `${this.holeCount} / 3`;

            if (navigator.vibrate) navigator.vibrate(50);

            if (this.holeCount === 1) {
                this.speak("One hole marked.");
            } else if (this.holeCount === 2) {
                this.speak("Two holes marked.");
            }

            if (this.holeCount >= 3) {
                this.setInstruction("Step 3: Verify & Complete", "You have marked all necessary holes. Verify the angles and finish.");
                this.ui.btnFinish.classList.remove('hidden');
                this.updateStatus("Verification Ready");
                this.speak("Three holes marked. Verification ready. Please verify the angle data points. If everything is aligned correctly, press the Complete Verification button.");
            }
        }
    }

    resetSimulation() {
        // Clear holes
        this.holeMarkers.forEach(m => this.scene.remove(m));
        this.holeMarkers = [];
        this.holeCount = 0;

        // Pick the hardware block back up
        this.scene.remove(this.hardwareModel);

        // Reset transform to be attached to camera
        this.hardwareModel.position.set(0, -0.1, -0.6);
        this.hardwareModel.rotation.set(0, 0, 0);
        this.camera.add(this.hardwareModel);

        this.state = 'POSITIONING';

        this.ui.holes.textContent = "0 / 3";
        this.ui.dataPanel.classList.add('hidden');

        this.ui.btnReset.classList.add('hidden');
        this.ui.btnFinish.classList.add('hidden');
        this.ui.btnPlace.classList.remove('hidden');

        this.setInstruction("Step 1: Position Model", "The 3D block will float in front of you. Aim your camera at a flat surface and tap Place Here to anchor it.");
        this.updateStatus("Position Model");
        this.speak("Simulation reset. The hardware has returned to your screen.");
    }

    finishSimulation() {
        this.setInstruction("Installation Complete", "Excellent work. You successfully mapped and interacted with the hardware.");
        this.ui.btnReset.classList.add('hidden');
        this.ui.btnFinish.classList.add('hidden');
        this.updateStatus("Success");
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        this.speak("Installation complete. Excellent work. You have successfully passed the carpentry simulation.");
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render(timestamp, frame) {
        if (this.state === 'MARKING') {
            this.updateAngleCalculation();
        }
        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
new FlowARController();
