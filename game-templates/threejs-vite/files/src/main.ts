import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#182230');
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(3, 2, 4);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshStandardMaterial({ color: '#6ee7b7', roughness: 0.35 }),
);
scene.add(cube);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(3, 5, 4);
scene.add(light);

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((time: number) => {
  cube.rotation.set(time * 0.0003, time * 0.0006, 0);
  renderer.render(scene, camera);
});
