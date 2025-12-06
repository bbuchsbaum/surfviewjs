import * as THREE from 'three';
import { EventDispatcher } from 'three';

export interface SurfaceControlsConfig {
  rotateSpeed?: number;
  zoomSpeed?: number;
  panSpeed?: number;
  enableRotate?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
}

/**
 * Natural surface manipulation controls - RGL/SUMA style
 * Implements virtual trackball rotation for intuitive 3D manipulation
 */
export class SurfaceControls extends EventDispatcher {
  camera: THREE.Camera;
  domElement: HTMLElement;
  enabled: boolean;
  
  // Configuration
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  enableRotate: boolean;
  enableZoom: boolean;
  enablePan: boolean;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  
  // State
  target: THREE.Vector3;
  
  // Mouse state
  readonly mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  
  readonly state = {
    NONE: -1,
    ROTATE: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
    TOUCH_PAN: 4,
    TOUCH_DOLLY_PAN: 5,
    TOUCH_DOLLY_ROTATE: 6
  };
  
  currentState: number;
  
  // Rotation
  private rotateStart: THREE.Vector2;
  private rotateEnd: THREE.Vector2;
  
  // Pan
  private panStart: THREE.Vector2;
  private panEnd: THREE.Vector2;
  private panDelta: THREE.Vector2;
  
  // Zoom
  private dollyStart: THREE.Vector2;
  private dollyEnd: THREE.Vector2;
  private dollyDelta: THREE.Vector2;
  
  // For trackball rotation
  private screen: { left: number; top: number; width: number; height: number };
  
  // Vectors for trackball
  private rotateStartVec: THREE.Vector3;
  private rotateEndVec: THREE.Vector3;
  private rotationAxis: THREE.Vector3;
  
  // State saving
  private target0?: THREE.Vector3;
  private position0?: THREE.Vector3;
  private up0?: THREE.Vector3;

  constructor(camera: THREE.Camera, domElement: HTMLElement, config: SurfaceControlsConfig = {}) {
    super();
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = true;
    
    // Configuration
    this.rotateSpeed = config.rotateSpeed || 1.0;
    this.zoomSpeed = config.zoomSpeed || 1.0;
    this.panSpeed = config.panSpeed || 1.0;
    this.enableRotate = config.enableRotate !== false;
    this.enableZoom = config.enableZoom !== false;
    this.enablePan = config.enablePan !== false;
    this.enableDamping = false;
    this.dampingFactor = 0.05;
    this.minDistance = 0.05;
    this.maxDistance = Infinity;
    
    // State
    this.target = new THREE.Vector3();
    
    this.currentState = this.state.NONE;
    
    // Rotation
    this.rotateStart = new THREE.Vector2();
    this.rotateEnd = new THREE.Vector2();
    
    // Pan
    this.panStart = new THREE.Vector2();
    this.panEnd = new THREE.Vector2();
    this.panDelta = new THREE.Vector2();
    
    // Zoom
    this.dollyStart = new THREE.Vector2();
    this.dollyEnd = new THREE.Vector2();
    this.dollyDelta = new THREE.Vector2();
    
    // For trackball rotation
    this.screen = {
      left: 0,
      top: 0,
      width: 0,
      height: 0
    };
    
    // Vectors for trackball
    this.rotateStartVec = new THREE.Vector3();
    this.rotateEndVec = new THREE.Vector3();
    this.rotationAxis = new THREE.Vector3();
    
    // Bind event handlers
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseWheel = this.onMouseWheel.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    
    // Setup event handlers
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    this.domElement.addEventListener('wheel', this.onMouseWheel);
    this.domElement.addEventListener('touchstart', this.onTouchStart);
    this.domElement.addEventListener('touchmove', this.onTouchMove);
    this.domElement.addEventListener('touchend', this.onTouchEnd);
    
    // Initialize screen dimensions
    this.handleResize();
    
    // Initial update
    this.update();
  }
  
  handleResize(): void {
    const rect = this.domElement.getBoundingClientRect();
    this.screen.left = rect.left;
    this.screen.top = rect.top;
    this.screen.width = rect.width;
    this.screen.height = rect.height;
  }
  
  // Project mouse position onto trackball sphere
  getMouseOnBall(pageX: number, pageY: number): THREE.Vector3 {
    const vector = new THREE.Vector3();
    const rect = this.domElement.getBoundingClientRect();
    
    // Convert to normalized device coordinates (-1 to +1)
    vector.x = ((pageX - rect.left) / rect.width) * 2 - 1;
    vector.y = -((pageY - rect.top) / rect.height) * 2 + 1;
    
    // Project onto sphere
    const length = vector.x * vector.x + vector.y * vector.y;
    
    if (length <= 1.0) {
      // Inside sphere
      vector.z = Math.sqrt(1.0 - length);
    } else {
      // Outside sphere - project onto edge
      vector.normalize();
      vector.z = 0;
    }
    
    return vector;
  }
  
  rotateCamera(): void {
    if (!this.enableRotate) return;
    const rect = this.domElement.getBoundingClientRect();
    const dx = this.rotateEnd.x - this.rotateStart.x;
    const dy = this.rotateEnd.y - this.rotateStart.y;

    // Dead zone to avoid jitter on tiny movements
    const jitterThreshold = 0.25;
    if (Math.abs(dx) < jitterThreshold && Math.abs(dy) < jitterThreshold) {
      return;
    }

    // Scale motion so rotation feels consistent across viewport sizes
    const viewportScale = Math.max(0.5, Math.min(rect.width, rect.height) / 800);
    const yawAngle = dx * 0.005 * this.rotateSpeed * viewportScale;
    const pitchAngle = dy * 0.005 * this.rotateSpeed * viewportScale;

    const eye = this.camera.position.clone().sub(this.target);

    // World-space up (Y) for yaw
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawAngle);
    eye.applyQuaternion(yawQuat);
    this.camera.up.applyQuaternion(yawQuat);

    // World-space X for pitch
    const pitchAxis = new THREE.Vector3(1, 0, 0);
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(pitchAxis, pitchAngle);
    eye.applyQuaternion(pitchQuat);
    this.camera.up.applyQuaternion(pitchQuat);
    this.camera.up.normalize();

    this.camera.position.copy(this.target).add(eye);
    this.camera.lookAt(this.target);

    // Update start position for next frame
    this.rotateStart.copy(this.rotateEnd);
  }
  
  panCamera(): void {
    if (!this.enablePan) return;
    
    const element = this.domElement;
    const rect = element.getBoundingClientRect();
    
    this.panDelta.set(
      this.panEnd.x - this.panStart.x,
      this.panEnd.y - this.panStart.y
    );
    
    // Get pan vectors in camera space
    const eye = this.camera.position.clone().sub(this.target);
    const distance = eye.length();
    
    // Scale pan speed based on distance
    const targetDistance = distance * Math.tan(((this.camera as THREE.PerspectiveCamera).fov / 2) * Math.PI / 180.0);
    const panFactor = 2 * targetDistance / rect.height;
    
    // Pan vectors
    const panLeft = new THREE.Vector3();
    const panUp = new THREE.Vector3();
    
    // Get camera's right vector (X axis in camera space)
    panLeft.setFromMatrixColumn(this.camera.matrix, 0);
    panLeft.multiplyScalar(-this.panDelta.x * panFactor * this.panSpeed);
    
    // Get camera's up vector (Y axis in camera space)
    panUp.setFromMatrixColumn(this.camera.matrix, 1);
    panUp.multiplyScalar(this.panDelta.y * panFactor * this.panSpeed);
    
    // Apply pan
    const pan = new THREE.Vector3().addVectors(panLeft, panUp);
    this.camera.position.add(pan);
    this.target.add(pan);
    
    // Update start position for next frame
    this.panStart.copy(this.panEnd);
  }
  
  dollyCamera(): void {
    if (!this.enableZoom) return;
    
    const zoomScale = Math.pow(0.95, this.dollyDelta.y * this.zoomSpeed);
    
    const eye = this.camera.position.clone().sub(this.target);
    const desiredLength = eye.length() * zoomScale;
    const clamped = Math.min(this.maxDistance, Math.max(this.minDistance, desiredLength));
    eye.setLength(clamped);
    this.camera.position.copy(this.target).add(eye);
    
    this.dollyStart.copy(this.dollyEnd);
  }
  
  update(): void {
    // This method is called by the render loop
    // All actual updates happen in the mouse move handlers
    (this as any).dispatchEvent({ type: 'change' });
  }

  private onContextMenu(event: Event): void {
    if ('preventDefault' in event) {
      (event as any).preventDefault();
    }
  }
  
  onMouseDown(event: MouseEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    switch (event.button) {
      case 0: // Left button
        if (this.enableRotate) {
          this.currentState = this.state.ROTATE;
          this.rotateStart.set(event.clientX, event.clientY);
        }
        break;
        
      case 1: // Middle button
        if (this.enableZoom) {
          this.currentState = this.state.DOLLY;
          this.dollyStart.set(event.clientX, event.clientY);
        }
        break;
        
      case 2: // Right button
        if (this.enablePan) {
          this.currentState = this.state.PAN;
          this.panStart.set(event.clientX, event.clientY);
        }
        break;
    }
    
    if (this.currentState !== this.state.NONE) {
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    }
  }
  
  onMouseMove(event: MouseEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    switch (this.currentState) {
      case this.state.ROTATE:
        this.rotateEnd.set(event.clientX, event.clientY);
        this.rotateCamera();
        this.update();
        break;
        
      case this.state.DOLLY:
        this.dollyEnd.set(event.clientX, event.clientY);
        this.dollyDelta.subVectors(this.dollyEnd, this.dollyStart);
        this.dollyCamera();
        this.dollyDelta.set(0, 0);
        this.update();
        break;
        
      case this.state.PAN:
        this.panEnd.set(event.clientX, event.clientY);
        this.panCamera();
        this.update();
        break;
    }
  }
  
  onMouseUp(event: MouseEvent): void {
    if (!this.enabled) return;
    
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    
    this.currentState = this.state.NONE;
  }
  
  onMouseWheel(event: WheelEvent): void {
    if (!this.enabled || !this.enableZoom) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    this.dollyDelta.y = event.deltaY * 0.01;
    this.dollyCamera();
    this.dollyDelta.set(0, 0);
    this.update();
  }
  
  onTouchStart(event: TouchEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    switch (event.touches.length) {
      case 1: // Single finger - rotate
        if (this.enableRotate) {
          this.currentState = this.state.TOUCH_ROTATE;
          this.rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
        }
        break;
        
      case 2: // Two fingers - zoom/pan
        if (this.enableZoom || this.enablePan) {
          const dx = event.touches[0].pageX - event.touches[1].pageX;
          const dy = event.touches[0].pageY - event.touches[1].pageY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          this.currentState = this.state.TOUCH_DOLLY_PAN;
          this.dollyStart.set(0, distance);
          
          const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
          const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
          this.panStart.set(x, y);
        }
        break;
    }
  }
  
  onTouchMove(event: TouchEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    switch (this.currentState) {
      case this.state.TOUCH_ROTATE:
        if (this.enableRotate) {
          this.rotateEnd.set(event.touches[0].pageX, event.touches[0].pageY);
          this.rotateCamera();
          this.update();
        }
        break;
        
      case this.state.TOUCH_DOLLY_PAN:
        if (this.enableZoom || this.enablePan) {
          const dx = event.touches[0].pageX - event.touches[1].pageX;
          const dy = event.touches[0].pageY - event.touches[1].pageY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (this.enableZoom) {
            this.dollyEnd.set(0, distance);
            this.dollyDelta.set(0, (this.dollyEnd.y - this.dollyStart.y) * 0.01);
            this.dollyCamera();
          }
          
          if (this.enablePan) {
            const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
            const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
            this.panEnd.set(x, y);
            this.panCamera();
          }
          
          this.update();
        }
        break;
    }
  }
  
  onTouchEnd(event: TouchEvent): void {
    if (!this.enabled) return;
    
    this.currentState = this.state.NONE;
  }
  
  dispose(): void {
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.domElement.removeEventListener('wheel', this.onMouseWheel);
    this.domElement.removeEventListener('touchstart', this.onTouchStart);
    this.domElement.removeEventListener('touchmove', this.onTouchMove);
    this.domElement.removeEventListener('touchend', this.onTouchEnd);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }
  
  // Methods for compatibility
  reset(): void {
    this.target.set(0, 0, 0);
    this.camera.position.set(0, 0, 100);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.update();
  }
  
  saveState(): void {
    this.target0 = this.target.clone();
    this.position0 = this.camera.position.clone();
    this.up0 = this.camera.up.clone();
  }
  
  restoreState(): void {
    if (this.target0) this.target.copy(this.target0);
    if (this.position0) this.camera.position.copy(this.position0);
    if (this.up0) this.camera.up.copy(this.up0);
    this.camera.lookAt(this.target);
    this.update();
  }
  
  // Method needed by NeuroSurfaceViewer
  getTarget(): THREE.Vector3 {
    return this.target;
  }
}
