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
  { url: '/glb/optimized/logo-companion-frame.glb', size: 4.5, position: [0.24, 0.28, -0.5], rotation: [0, 0, 0], opacity: 0.68 },
  { url: '/glb/optimized/wordless.glb', size: 1.85, position: [0.24, 0.28, 1.05], rotation: [0, 0, 0] },
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
    const multipleMaterials = Array.isArray(object.material)
    const materials: THREE.Material[] = multipleMaterials ? object.material : [object.material]
    const nextMaterials = materials.map((material) => {
      const clone = material.clone()
      clone.transparent = opacity < 1
      clone.opacity = opacity
      clone.depthWrite = opacity > 0.7
      return clone
    })
    object.material = multipleMaterials ? nextMaterials : nextMaterials[0]!
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

    const coreManager = new THREE.LoadingManager()
    coreManager.onStart = () => onProgress?.(3, 'SCENE LINK')
    coreManager.onProgress = (_url, loaded, total) => onProgress?.(Math.round((loaded / total) * 92), loaded < total ? 'DECODING FORM' : 'COMPOSING LIGHT')
    const loader = new GLTFLoader(coreManager)
    let disposed = false

    const loadModel = (loader: GLTFLoader, { url, size, position, rotation, opacity = 1 }: SceneModel) => new Promise<void>((resolve, reject) => {
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
    })

    Promise.all(heroModels.map((model) => loadModel(loader, model))).then(() => {
      if (disposed) return
      renderer.render(scene, camera)
      onProgress?.(100, 'READY')
      onReady?.()
    }).catch(() => onError?.())

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      stage.userData.baseX = width > 760 ? -0.82 : 0
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
          stage.position.y = Math.sin(elapsed * 0.42) * 0.045
        }
        renderer.render(scene, camera)
      }
      frameId = window.requestAnimationFrame(render)
    }
    render()

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
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
