import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../i18n';
import styles from './Model3dViewer.module.css';

export interface Model3dViewerProps {
  /** Same-origin address of a binary glTF file. */
  src: string;
  name: string;
  /** Fixed height for a card; without it the viewer fills its container. */
  height?: number;
  onOpen?: (() => void) | undefined;
}

type Phase = 'loading' | 'ready' | 'failed';

/**
 * Shows a GLB you can turn and zoom. three.js loads only when a model is on screen,
 * because most sessions never show one.
 */
export function Model3dViewer({ src, name, height, onOpen }: Model3dViewerProps): ReactElement {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let stopped = false;
    let teardown = () => {};
    setPhase('loading');
    void (async () => {
      const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ]);
      if (stopped) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3550, 2.4));
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(3, 5, 4);
      scene.add(key);
      const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.2;
      controls.addEventListener('start', () => { controls.autoRotate = false; });

      const resize = () => {
        const width = element.clientWidth;
        const tall = element.clientHeight;
        if (!width || !tall) return;
        renderer.setSize(width, tall, false);
        camera.aspect = width / tall;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();

      let frame = 0;
      const loop = () => {
        frame = requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
      };
      teardown = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };

      try {
        const gltf = await new GLTFLoader().loadAsync(src);
        if (stopped) return;
        scene.add(gltf.scene);
        // Frame the model whatever scale it arrived in.
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
        const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.position.set(center.x + distance * 0.6, center.y + distance * 0.35, center.z + distance * 0.75);
        camera.near = distance / 100;
        camera.far = distance * 10;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        loop();
        setPhase('ready');
      } catch {
        if (!stopped) setPhase('failed');
      }
    })().catch(() => { if (!stopped) setPhase('failed'); });
    return () => { stopped = true; teardown(); };
  }, [src]);

  return (
    <figure className={styles.viewer} style={height ? { height } : undefined} data-testid="model3d-viewer" aria-label={name}>
      <div ref={host} className={styles.canvas} />
      {phase !== 'ready' ? <p className={styles.status} role={phase === 'failed' ? 'alert' : 'status'}>
        {t(phase === 'failed' ? 'model3d.failed' : 'model3d.loading')}</p> : null}
      {phase === 'ready' ? <figcaption className={styles.caption}>
        <span>{t('model3d.hint')}</span>
        {onOpen ? <Button size="sm" variant="secondary" onClick={onOpen}>{t('model3d.open')}</Button> : null}
      </figcaption> : null}
    </figure>
  );
}
