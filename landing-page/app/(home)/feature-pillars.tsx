'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cn } from '@/lib/cn';

type PillarKind = 'coin' | 'mining' | 'transfer' | 'shield';

interface Pillar {
  id: PillarKind;
  title: string;
  description: string;
  cardClass: string;
  titleClass: string;
  descriptionClass: string;
  fallbackGlow: string;
}

const PILLARS: Pillar[] = [
  {
    id: 'coin',
    title: 'LMA Currency',
    description:
      'A fixed-supply asset for everyday settlement — hold, send, and receive with a balanced ledger behind every movement.',
    cardClass: 'bg-[#ececee] dark:bg-[#141414]',
    titleClass: 'text-neutral-900 dark:text-white',
    descriptionClass: 'text-neutral-600 dark:text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #f5d76e 0%, #d4af37 45%, transparent 70%)',
  },
  {
    id: 'mining',
    title: 'Mining',
    description:
      'Earn LMA for keeping the network alive. Rewards settle straight to your wallet, every cycle.',
    cardClass: 'bg-[#141417] dark:bg-[#141414]',
    titleClass: 'text-white',
    descriptionClass: 'text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #a78bfa 0%, #8E53F8 45%, transparent 70%)',
  },
  {
    id: 'transfer',
    title: 'Transfers',
    description:
      'Idempotent by design: the same transfer can never settle twice. Confirm once, receipted forever.',
    cardClass: 'bg-[#e4dcff] dark:bg-[#141414]',
    titleClass: 'text-neutral-900 dark:text-white',
    descriptionClass: 'text-neutral-600 dark:text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #cbd5e1 0%, #64748b 50%, transparent 72%)',
  },
  {
    id: 'shield',
    title: 'Protection',
    description:
      'Every incoming transfer is screened for spam and fraud before it can touch your balance.',
    cardClass: 'bg-[#efedea] dark:bg-[#141414]',
    titleClass: 'text-neutral-900 dark:text-white',
    descriptionClass: 'text-neutral-600 dark:text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #6ee7b7 0%, #10b981 45%, transparent 70%)',
  },
];

/* ------------------------- Three.js builders ------------------------- */

const GOLD = new THREE.Color(0xe3b93c);
const BRIGHT_GOLD = new THREE.Color(0xffe27a);

function goldCoin(radius: number, thick: number): THREE.Group {
  const coin = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, thick, 56),
    new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.24 }),
  );
  body.rotation.x = Math.PI / 2;
  coin.add(body);
  return coin;
}

/** Bold raised "L" placed on a coin face. */
function embossedL(scale: number, depth: number): THREE.Group {
  const mark = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: BRIGHT_GOLD, metalness: 1, roughness: 0.14 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.24 * scale, 0.85 * scale, depth), material);
  bar.position.x = -0.14 * scale;
  mark.add(bar);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, 0.24 * scale, depth), material);
  foot.position.set(0.03 * scale, -0.305 * scale, 0);
  mark.add(foot);
  return mark;
}

function buildShape(kind: PillarKind): THREE.Group {
  const group = new THREE.Group();

  if (kind === 'coin') {
    const coin = goldCoin(1.0, 0.24);
    group.add(coin);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.055, 20, 72),
      new THREE.MeshStandardMaterial({ color: BRIGHT_GOLD, metalness: 1, roughness: 0.16 }),
    );
    group.add(rim);
    const front = embossedL(1, 0.12);
    front.position.z = 0.16;
    group.add(front);
    const back = embossedL(1, 0.12);
    back.position.z = -0.16;
    back.rotation.y = Math.PI;
    group.add(back);
  }

  if (kind === 'mining') {
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.05, 0),
      new THREE.MeshStandardMaterial({
        color: 0x8e53f8,
        emissive: 0x8e53f8,
        emissiveIntensity: 0.35,
        metalness: 0.15,
        roughness: 0.12,
        flatShading: true,
      }),
    );
    group.add(gem);
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({
        color: 0xc4b5fd,
        emissive: 0xc4b5fd,
        emissiveIntensity: 0.2,
        metalness: 0.1,
        roughness: 0.15,
        flatShading: true,
      }),
    );
    shard.position.set(1.05, -0.55, 0.2);
    group.add(shard);
  }

  if (kind === 'transfer') {
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.95, roughness: 0.3 });
    const first = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.2, 24, 72), steel);
    first.rotation.y = Math.PI / 5;
    first.position.x = -0.42;
    group.add(first);
    const second = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.2, 24, 72), steel);
    second.rotation.y = -Math.PI / 5;
    second.rotation.x = Math.PI / 12;
    second.position.x = 0.42;
    group.add(second);
  }

  if (kind === 'shield') {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.05);
    shape.bezierCurveTo(0.5, 0.85, 0.75, 0.8, 0.8, 0.78);
    shape.lineTo(0.8, -0.1);
    shape.bezierCurveTo(0.8, -0.6, 0.4, -0.9, 0, -1.1);
    shape.bezierCurveTo(-0.4, -0.9, -0.8, -0.6, -0.8, -0.1);
    shape.lineTo(-0.8, 0.78);
    shape.bezierCurveTo(-0.75, 0.8, -0.5, 0.85, 0, 1.05);
    const shield = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 }),
      new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.65, roughness: 0.3 }),
    );
    shield.geometry.center();
    group.add(shield);
  }

  return group;
}

/* ------------------------- Canvas per pillar ------------------------- */

function PillarCanvas({ kind, glow }: { kind: PillarKind; glow: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer: THREE.WebGLRenderer | null = null;
    let raf = 0;
    let visible = true;
    let disposed = false;

    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    // Four renderers share the page, so cap the backing store: 1.5 cuts the
    // pixels each one rasterises by ~44% versus 2, with no visible softening
    // at card size.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    // Image-based lighting so metals (gold, steel) read as metal, not mud.
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch {
      // Lights below still carry the scene if IBL is unavailable.
    }
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0.4, 6.2);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3.5, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    rim.position.set(-4, -2, -3);
    scene.add(rim);

    const shape = buildShape(kind);
    scene.add(shape);

    const fit = () => {
      if (disposed || !renderer) return;
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    fit();

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(wrapper);

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(wrapper);

    const tweens: gsap.core.Tween[] = [];
    if (!reduced) {
      tweens.push(
        gsap.to(shape.rotation, { y: '+=6.283', duration: kind === 'coin' ? 7 : 11, repeat: -1, ease: 'none' }),
        gsap.to(shape.position, { y: '+=0.16', duration: 1.9, repeat: -1, yoyo: true, ease: 'sine.inOut' }),
      );
    }

    const render = () => {
      raf = requestAnimationFrame(render);
      if (!visible || disposed || !renderer) return;
      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      tweens.forEach((tween) => tween.kill());
      resizeObserver.disconnect();
      observer.disconnect();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const material = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      scene.environment?.dispose();
      renderer?.dispose();
    };
  }, [kind]);

  return (
    <div ref={wrapperRef} className="relative min-h-0 w-full flex-1">
      {!failed && <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />}
      {failed && (
        <div aria-hidden className="absolute inset-0" style={{ background: glow }} />
      )}
    </div>
  );
}

/* ------------------------- Section ------------------------- */

export function FeaturePillars() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return;
      gsap.from('[data-pillar]', {
        y: 64,
        autoAlpha: 0,
        duration: 0.9,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 82%',
          once: true,
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      aria-label="Louma capabilities"
      className="col-span-full mx-auto w-full max-w-[1400px]"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        {PILLARS.map((pillar) => (
          <article
            key={pillar.id}
            data-pillar
            className={cn(
              'flex h-[440px] flex-col overflow-hidden rounded-[2rem] p-6 sm:h-[500px]',
              pillar.cardClass,
            )}
          >
            <h3 className={cn('text-center text-lg font-medium tracking-tight', pillar.titleClass)}>
              {pillar.title}
            </h3>
            <PillarCanvas kind={pillar.id} glow={pillar.fallbackGlow} />
            <p className={cn('pb-2 text-center text-[13px] leading-6', pillar.descriptionClass)}>
              {pillar.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
