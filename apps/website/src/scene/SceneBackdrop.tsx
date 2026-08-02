import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

type SceneBackdropProps = {
  onProgress?: (progress: number, phase: string) => void
  onReady?: () => void
  onError?: () => void
}

type SceneModel = {
  url: string
  size: number
  position: [number, number, number]
  rotation: [number, number, number]
  opacity?: number
}

const heroModels: SceneModel[] = [
  { url: '/glb/optimized/logo-companion-frame.glb', size: 5.7, position: [0.55, 0, -0.5], rotation: [0.04, -0.28, -0.08], opacity: 0.32 },
  { url: '/glb/optimized/wordless.glb', size: 4.35, position: [0.32, 0.02, 1.05], rotation: [0.06, 0.22, 0.02] },
  { url: '/glb/optimized/intent-glyph.glb', size: 1.12, position: [-2.55, 1.7, 1.2], rotation: [0.22, -0.35, -0.2], opacity: 0.72 },
  { url: '/glb/optimized/archive-flower.glb', size: 0.9, position: [2.75, -1.75, 0.2], rotation: [-0.12, 0.4, 0.15], opacity: 0.48 },
]

function fitModel(model: THREE.Object3D, targetSize: number) {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const scale = targetSize / Math.max(size.x, size.y, size.z, 0.001)
  model.scale.setScalar(scale)
  model.position.copy(center).multiplyScalar(-scale)
}

function setOpacity(model: THREE.Object3D, opacity: number) {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    object.material = materials.map((material) => {
      const clone = material.clone()
      clone.transparent = opacity < 1
      clone.opacity = opacity
      clone.depthWrite = opacity > 0.7
      return clone
    })
  })
}

export function SceneBackdrop({ onProgress, onReady, onError }: SceneBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      onError?.()
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    camera.position.set(0, 0.1, 10)

    const stage = new THREE.Group()
    stage.userData.baseX = 0
    scene.add(stage)
    scene.add(new THREE.HemisphereLight(0xe6ffd0, 0x080b08, 2.4))

    const keyLight = new THREE.DirectionalLight(0xd8ff9e, 5.5)
    keyLight.position.set(4, 5, 7)
    scene.add(keyLight)
    const rimLight = new THREE.PointLight(0x75d7ff, 32, 15, 1.7)
    rimLight.position.set(-4, -2, 4)
    scene.add(rimLight)

    const manager = new THREE.LoadingManager()
    manager.onStart = () => onProgress?.(3, 'SCENE LINK')
    manager.onProgress = (_url, loaded, total) => onProgress?.(Math.round((loaded / total) * 92), loaded < total ? 'DECODING FORM' : 'COMPOSING LIGHT')
    manager.onError = () => onError?.()
    const loader = new GLTFLoader(manager)
    let disposed = false

    Promise.all(heroModels.map(({ url, size, position, rotation, opacity = 1 }) => new Promise<void>((resolve, reject) => {
      loader.load(url, (gltf) => {
        if (disposed) return resolve()
        fitModel(gltf.scene, size)
        setOpacity(gltf.scene, opacity)
        const anchor = new THREE.Group()
        anchor.position.set(...position)
        anchor.rotation.set(...rotation)
        anchor.add(gltf.scene)
        stage.add(anchor)
        resolve()
      }, undefined, reject)
    }))).then(() => {
      if (disposed) return
      renderer.render(scene, camera)
      onProgress?.(100, 'READY')
      onReady?.()
    }).catch(() => onError?.())

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pointer = new THREE.Vector2()
    const targetPointer = new THREE.Vector2()
    const onPointerMove = (event: PointerEvent) => {
      targetPointer.set((event.clientX / window.innerWidth - 0.5) * 2, (event.clientY / window.innerHeight - 0.5) * 2)
    }
    if (!reducedMotion) window.addEventListener('pointermove', onPointerMove, { passive: true })

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      stage.userData.baseX = width > 760 ? Math.min(0.65, width / 1600) : 0
      stage.position.x = stage.userData.baseX
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()

    let visible = true
    const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false })
    visibilityObserver.observe(canvas)
    const clock = new THREE.Clock()
    let frameId = 0

    const render = () => {
      if (visible) {
        const elapsed = clock.getElapsedTime()
        if (!reducedMotion) {
          pointer.lerp(targetPointer, 0.045)
          stage.rotation.y += (pointer.x * 0.28 - stage.rotation.y) * 0.035
          stage.rotation.x += (-pointer.y * 0.16 - stage.rotation.x) * 0.035
          stage.position.x += (stage.userData.baseX + pointer.x * 0.34 - stage.position.x) * 0.03
          stage.position.y = Math.sin(elapsed * 0.42) * 0.08
          rimLight.position.x += (pointer.x * 3.8 - rimLight.position.x) * 0.035
          rimLight.position.y += (-pointer.y * 2.5 - rimLight.position.y) * 0.035
          stage.children.forEach((child, index) => {
            child.rotation.z += (index % 2 ? -1 : 1) * (0.0026 + index * 0.0005)
            child.position.y += (Math.sin(elapsed * (0.52 + index * 0.08) + index) * 0.045 + (index === 1 ? 0.02 : 0) - child.position.y) * 0.04
          })
          camera.position.x += (pointer.x * 0.35 - camera.position.x) * 0.025
          camera.position.y += (0.1 - pointer.y * 0.2 - camera.position.y) * 0.025
          camera.lookAt(0, 0, 0)
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
      resizeObserver.disconnect()
      visibilityObserver.disconnect()
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value instanceof THREE.Texture) value.dispose()
          })
          material.dispose()
        })
      })
      renderer.dispose()
    }
  }, [onError, onProgress, onReady])

  return <canvas ref={canvasRef} className="scene-backdrop" aria-hidden="true" />
}

export default SceneBackdrop
