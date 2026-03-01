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
        this.state = 'SCANNING'; // SCANNING -> PLACING -> MARKING
        this.placedModels = [];
        this.holeCount = 0;

        // Setup AR Session
        this.setupXR();
        this.setupUI();

        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Voice Synth Initialization
        this.synth = window.speechSynthesis;
        this.isVoiceEnabled = false;
    }

    // --- Voice Guidance Helper ---
    speak(text) {
        if (!this.synth || !this.isVoiceEnabled) return;

        // Cancel any ongoing speech to immediately start the new instruction
        if (this.synth.speaking) {
            this.synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95; // Slightly slower for clarity
        utterance.pitch = 1.0;

        // Prefer a clear English voice if available
        const voices = this.synth.getVoices();
        const preferredVoice = voices.find(v => v.lang.includes('en') && (v.name.includes('Google') || v.name.includes('Samantha')));
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        this.synth.speak(utterance);
    }

    setupXR() {
        // Create the "Start AR" button injected by Three.js
        const arButton = ARButton.createButton(this.renderer, {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.getElementById('ui-layer') }
        });

        // Browsers require a user interaction to unlock the Speech API.
        // We bind it to the AR session start button click.
        arButton.addEventListener('click', () => {
            this.isVoiceEnabled = true;
            // Speak a silent utterance to unlock audio context on mobile
            const unlock = new SpeechSynthesisUtterance('');
            this.synth.speak(unlock);
        });

        document.body.appendChild(arButton);

        // Notify user about status
        this.updateStatus("Waiting for AR Start");

        this.renderer.xr.addEventListener('sessionstart', () => {
            document.getElementById('ui-layer').style.pointerEvents = 'none'; // Let XR handle taps initially
            this.updateStatus("Scanning Surface");
            this.setInstruction("Step 1: Scan Desk", "Move your phone slowly over the table until a white ring appears.");

            // Trigger first voice instruction
            setTimeout(() => {
                this.speak("Welcome to Flow A R. Step 1: Point your camera at your desk and move your phone slowly until you see the white circular tracker.");
            }, 1000);
        });

        // Controller (handles screen taps in AR)
        this.controller = this.renderer.xr.getController(0);
        this.controller.addEventListener('select', this.onSelect.bind(this));
        this.scene.add(this.controller);

        // Reticle (The white ring for hit testing)
        this.reticle = new THREE.Mesh(
            new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
        );
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);

        // Hit Test Request logic
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;

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
            btnReset: document.getElementById('btn-reset'),
            btnFinish: document.getElementById('btn-finish'),
            controls: document.getElementById('action-controls')
        };

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

    onSelect() {
        if (this.state === 'SCANNING' && this.reticle.visible) {
            // STEP 1 to 2: Place the model at the reticle's exact transform
            this.placeModel(this.reticle.matrix);

            this.state = 'MARKING';
            this.updateStatus("Model Anchored");
            this.setInstruction("Step 2: Mark Holes & Check Angle", "Tap on the surface of the green block to mark drill holes. Observe the angle data.");

            this.ui.dataPanel.classList.remove('hidden');
            this.ui.controls.classList.remove('hidden');

            this.speak("Target locked. the virtual hardware has been placed. Step 2: Ensure the X-axis angle is at zero degrees so it sits flat, then tap the top of the block three times to mark your pilot holes.");

        }
        else if (this.state === 'MARKING') {
            // Raycast from the controller to the placed model to mark a hole
            this.markHole();
        }
    }

    placeModel(matrix) {
        // Create an advanced lookalilke of a piece of wood/hardware
        const geometry = new THREE.BoxGeometry(0.3, 0.05, 0.5); // 30cm x 5cm x 50cm approx
        const material = new THREE.MeshStandardMaterial({
            color: 0x4caf50, // Greenish to indicate it's active
            roughness: 0.7,
            metalness: 0.2
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.applyMatrix4(matrix);
        // Slightly raise it so it sits ON the table, not IN it
        mesh.translateY(0.025);

        // Add specific "target" zones visually
        const edges = new THREE.EdgesGeometry(geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00f3ff, linewidth: 2 }));
        mesh.add(line);

        this.scene.add(mesh);
        this.placedModels.push(mesh);

        // Calculate Initial Angle
        this.updateAngleCalculation(mesh);
    }

    updateAngleCalculation(mesh) {
        // Calculate the object's rotation relative to the world
        // In carpentry, we usually care if it's perfectly flat (X/Z) and how it's yawed (Y)
        const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion);

        const toDegrees = (rad) => Math.abs(Math.round(rad * (180 / Math.PI)));

        const degX = toDegrees(euler.x);
        const degY = toDegrees(euler.y);

        this.ui.angleX.textContent = `${degX}°`;
        this.ui.angleY.textContent = `${degY}°`;

        // Feedback logic: 0 degrees X means it's flat on table
        if (degX < 5) {
            this.ui.angleX.className = "success-text";
        } else {
            this.ui.angleX.className = "error-text";
        }
    }

    markHole() {
        if (this.placedModels.length === 0 || this.holeCount >= 3) return;

        // Perform a raycast from the controller to the model
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(this.controller.matrixWorld);

        const raycaster = new THREE.Raycaster();
        raycaster.ray.origin.setFromMatrixPosition(this.controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const intersects = raycaster.intersectObjects(this.placedModels, false);

        if (intersects.length > 0) {
            const hit = intersects[0];

            // Create a Red Drill Marker at the hit point
            const markerGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.005, 16);
            const markerMat = new THREE.MeshBasicMaterial({ color: 0xff003c });
            const marker = new THREE.Mesh(markerGeo, markerMat);

            marker.position.copy(hit.point);
            // Align marker to the face normal
            const n = hit.face.normal.clone();
            n.transformDirection(hit.object.matrixWorld);
            n.add(hit.point);
            marker.lookAt(n);
            marker.rotateX(Math.PI / 2); // Cylinder stands up

            this.scene.add(marker);
            this.placedModels.push(marker); // Keep track to clear later

            this.holeCount++;
            this.ui.holes.textContent = `${this.holeCount} / 3`;

            // Haptic Feedback if supported
            if (navigator.vibrate) navigator.vibrate(50);

            // Voice Feedback for Hole Markers
            if (this.holeCount === 1) {
                this.speak("One hole marked.");
            } else if (this.holeCount === 2) {
                this.speak("Two holes marked.");
            }

            if (this.holeCount >= 3) {
                this.setInstruction("Step 3: Verify & Complete", "You have marked all necessary holes. Verify the angles and finish.");
                this.ui.btnFinish.classList.remove('hidden');
                this.updateStatus("Verification Ready");
                this.speak("Three holes marked. Step 3: Please verify the angle data points. If everything is aligned correctly, press the Complete Verification button.");
            }
        }
    }

    resetSimulation() {
        this.placedModels.forEach(m => this.scene.remove(m));
        this.placedModels = [];
        this.holeCount = 0;
        this.state = 'SCANNING';

        this.ui.holes.textContent = "0 / 3";
        this.ui.dataPanel.classList.add('hidden');
        this.ui.controls.classList.add('hidden');
        this.ui.btnFinish.classList.add('hidden');

        this.setInstruction("Step 1: Scan Desk", "Move your phone slowly over the table until a white ring appears.");
        this.updateStatus("Scanning Surface");
        this.speak("Simulation reset. Please scan your desk again.");
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
        if (frame) {
            const referenceSpace = this.renderer.xr.getReferenceSpace();
            const session = this.renderer.xr.getSession();

            // Setup hit testing if not done
            if (this.hitTestSourceRequested === false) {
                this.hitTestSourceRequested = true;
                session.requestReferenceSpace('viewer').then((viewerSpace) => {
                    session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                        this.hitTestSource = source;
                    }).catch(console.error);
                }).catch(console.error);

                session.addEventListener('end', () => {
                    this.hitTestSourceRequested = false;
                    this.hitTestSource = null;
                });
            }

            // Perform Hit Test
            if (this.hitTestSource) {
                const hitTestResults = frame.getHitTestResults(this.hitTestSource);

                if (hitTestResults.length > 0 && this.state === 'SCANNING') {
                    const hit = hitTestResults[0];
                    this.reticle.visible = true;
                    // Safely get the pose
                    const pose = hit.getPose(referenceSpace);
                    if (pose) {
                        this.reticle.matrix.fromArray(pose.transform.matrix);
                        this.updateStatus("Surface Detected - Tap to Anchor");
                    }
                } else {
                    this.reticle.visible = false;
                    if (this.state === 'SCANNING') this.updateStatus("Scanning Surface...");
                }
            }

            // Continuous Tracking Update
            if (this.state === 'MARKING' && this.placedModels.length > 0) {
                // The first model is our main hardware block
                this.updateAngleCalculation(this.placedModels[0]);
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
new FlowARController();
