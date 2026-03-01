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
        // Create a compound object that looks exactly like the yellow/brass Butt Hinge provided
        this.hardwareModel = new THREE.Group();

        // Define a brass/gold metallic material to match the requested image
        const brassMat = new THREE.MeshStandardMaterial({
            color: 0xddcc55, // Brass/Gold yellow
            roughness: 0.4,
            metalness: 0.6
        });

        // 1. Central Barrel (The pivot of the hinge)
        // A cylinder running down the middle
        const barrelGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.1, 32);
        const barrel = new THREE.Mesh(barrelGeo, brassMat);
        // Lay it flat along the Z axis (so it acts as the center spine)
        barrel.rotation.x = Math.PI / 2;
        this.hardwareModel.add(barrel);

        // 2. Left Plate
        const plateGeo = new THREE.BoxGeometry(0.06, 0.008, 0.1);
        const leftPlate = new THREE.Mesh(plateGeo, brassMat);
        // Position it to the left of the barrel
        leftPlate.position.set(-0.035, 0, 0);
        this.hardwareModel.add(leftPlate);

        // 3. Right Plate
        const rightPlate = new THREE.Mesh(plateGeo, brassMat);
        // Position it to the right of the barrel
        rightPlate.position.set(0.035, 0, 0);
        this.hardwareModel.add(rightPlate);

        // Add subtle edge lines to emphasize the 3D shape just like the CAD image
        const barrelEdges = new THREE.LineSegments(new THREE.EdgesGeometry(barrelGeo), new THREE.LineBasicMaterial({ color: 0x887700 }));
        barrel.add(barrelEdges);
        const leftPlateEdges = new THREE.LineSegments(new THREE.EdgesGeometry(plateGeo), new THREE.LineBasicMaterial({ color: 0x887700 }));
        leftPlate.add(leftPlateEdges);
        const rightPlateEdges = new THREE.LineSegments(new THREE.EdgesGeometry(plateGeo), new THREE.LineBasicMaterial({ color: 0x887700 }));
        rightPlate.add(rightPlateEdges);

        // 4. Target Hole Indicators (Visual guides for the 4 screws)
        const targetMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.8 });
        // Make the rings look like screw holes indented in the plates
        const ringGeo = new THREE.RingGeometry(0.004, 0.007, 16);

        // Let's create a helper function to place the 4 holes
        const addHole = (x, z) => {
            const hole = new THREE.Mesh(ringGeo, targetMat);
            hole.rotation.x = -Math.PI / 2; // Flat on top of plate
            hole.position.set(x, 0.0041, z); // Just barely above the plate surface
            this.hardwareModel.add(hole);
        };

        // Left Plate - Top & Bottom holes
        addHole(-0.045, 0.035);
        addHole(-0.045, -0.035);

        // Right Plate - Top & Bottom holes
        addHole(0.045, 0.035);
        addHole(0.045, -0.035);

        // The model stays with the scene but is invisible until AR starts
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

            this.hardwareModel.visible = true;

            setTimeout(() => {
                this.speak("Welcome. The metallic hinge forms instantly. Aim your camera at your desk and tap Place Here on your screen to anchor it.");
            }, 1000);
        });

        this.renderer.xr.addEventListener('sessionend', () => {
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

        // The model is already cleanly in world space because we moved it during the render loop
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
        if (this.holeCount >= 4) return;

        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(this.controller.matrixWorld);

        const raycaster = new THREE.Raycaster();
        raycaster.ray.origin.setFromMatrixPosition(this.controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        // Check intersection purely against the hardware block
        const intersects = raycaster.intersectObject(this.hardwareModel, true); // True to check children of Group

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
            this.ui.holes.textContent = `${this.holeCount} / 4`;

            if (navigator.vibrate) navigator.vibrate(50);

            if (this.holeCount === 1) {
                this.speak("One hole marked.");
            } else if (this.holeCount === 2) {
                this.speak("Two holes marked.");
            } else if (this.holeCount === 3) {
                this.speak("Three holes marked.");
            }

            if (this.holeCount >= 4) {
                this.setInstruction("Step 3: Verify & Complete", "You have marked all necessary holes. Verify the angles and finish.");
                this.ui.btnFinish.classList.remove('hidden');
                this.updateStatus("Verification Ready");
                this.speak("Four holes marked. Verification ready. Please verify the angle data points. If everything is aligned correctly, press the Complete Verification button.");
            }
        }
    }

    resetSimulation() {
        // Clear holes
        this.holeMarkers.forEach(m => this.scene.remove(m));
        this.holeMarkers = [];
        this.holeCount = 0;

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
        if (this.state === 'POSITIONING' && this.hardwareModel && this.renderer.xr.isPresenting) {
            // Keep the model perfectly 0.35m in front of the camera in absolute world space
            // This entirely avoids the Three.js scene graph bugs with WebXR scaling
            const cameraPos = new THREE.Vector3();
            const cameraDir = new THREE.Vector3();

            this.camera.getWorldPosition(cameraPos);
            this.camera.getWorldDirection(cameraDir);

            // Move it 35cm away from camera
            this.hardwareModel.position.copy(cameraPos).add(cameraDir.multiplyScalar(0.35));
            // Keep it upright relative to the world, just facing the user
            this.hardwareModel.lookAt(cameraPos.x, this.hardwareModel.position.y, cameraPos.z);
        }
        else if (this.state === 'MARKING') {
            this.updateAngleCalculation();
        }
        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
new FlowARController();
