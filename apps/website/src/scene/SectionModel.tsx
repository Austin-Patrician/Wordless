import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

type SectionModelProps = {
  src: string
  label: string
  variant?: 'default' | 'wide' | 'fold' | 'lattice'
}

export function SectionModel({ src, label, variant = 'default' }: SectionModelProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [active, setActive] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setActive(true)
        observer.disconnect()
      }
    }, { rootMargin: '320px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
    camera.position.set(0, 0, 8)
    scene.add(new THREE.HemisphereLight(0xe4ffc5, 0x060806, 2.8))
    const light = new THREE.DirectionalLight(0xbfff7d, 5)
    light.position.set(3, 4, 6)
    scene.add(light)
    const blueLight = new THREE.PointLight(0x59b9ff, 18, 12)
    blueLight.position.set(-3, -2, 3)
    scene.add(blueLight)

    const root = new THREE.Group()
    root.rotation.set(variant === 'fold' ? -0.1 : variant === 'lattice' ? 0.02 : 0.08, variant === 'lattice' ? -0.08 : -0.25, variant === 'wide' ? -0.12 : 0.05)
    scene.add(root)
    let disposed = false
    new GLTFLoader().load(src, (gltf) => {
      if (disposed) return
      const box = new THREE.Box3().setFromObject(gltf.scene)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const scale = (variant === 'lattice' ? 5.1 : variant === 'wide' ? 3.8 : 3.1) / Math.max(size.x, size.y, size.z, 0.001)
      gltf.scene.scale.setScalar(scale)
      gltf.scene.position.copy(center).multiplyScalar(-scale)
      root.add(gltf.scene)
    }, undefined, () => setFailed(true))

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pointer = new THREE.Vector2()
    const targetPointer = new THREE.Vector2()
    const onPointerMove = (event: PointerEvent) => {
      targetPointer.set((event.clientX / window.innerWidth - 0.5) * 2, (event.clientY / window.innerHeight - 0.5) * 2)
    }
    if (!reducedMotion) window.addEventListener('pointermove', onPointerMove, { passive: true })
    const clock = new THREE.Clock()
    let frameId = 0
    let visible = true
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false })
    observer.observe(canvas)
    const render = () => {
      if (visible) {
        const elapsed = clock.getElapsedTime()
        if (!reducedMotion) {
          pointer.lerp(targetPointer, 0.045)
          const baseRotationY = variant === 'lattice' ? -0.08 : -0.25
          const rotationRange = variant === 'lattice' ? 0.08 : 0.22
          const idleRotation = variant === 'lattice' ? 0.045 : 0.13
          const baseRotationX = variant === 'lattice' ? 0.02 : 0.08
          root.rotation.y += (baseRotationY + pointer.x * rotationRange + Math.sin(elapsed * 0.38) * idleRotation - root.rotation.y) * 0.035
          root.rotation.x += (baseRotationX - pointer.y * 0.12 - root.rotation.x) * 0.035
          root.position.y = Math.sin(elapsed * 0.52) * 0.08
        }
        renderer.render(scene, camera)
      }
      frameId = window.requestAnimationFrame(render)
    }
    render()

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('pointermove', onPointerMove)
      observer.disconnect()
      resizeObserver.disconnect()
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) value.dispose() })
          material.dispose()
        })
      })
      renderer.dispose()
    }
  }, [active, src, variant])

  return (
    <div ref={hostRef} className={`section-model section-model--${variant}`} role="img" aria-label={label}>
      {!failed && <canvas ref={canvasRef} />}
      {failed && <img src="/images/wordless.webp" alt="" />}
      <span className="section-model__label">{label}</span>
    </div>
  )
}

export default SectionModel
