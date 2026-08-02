import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export function SceneBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    camera.position.set(0, 0, 8.2)

    const stage = new THREE.Group()
    stage.rotation.x = 0.22
    scene.add(stage)

    const lime = new THREE.Color('#c9ff79')
    const mutedLime = new THREE.Color('#6e9a46')
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: lime,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })

    const rings = [
      { radius: 2.38, tube: 0.006, rotation: [0.2, 0.08, 0.1] },
      { radius: 3.08, tube: 0.004, rotation: [0.5, -0.48, 0.24] },
      { radius: 3.76, tube: 0.003, rotation: [-0.28, 0.64, -0.38] },
    ].map(({ radius, tube, rotation }) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 128), ringMaterial.clone())
      ring.rotation.set(rotation[0], rotation[1], rotation[2])
      stage.add(ring)
      return ring
    })

    const grid = new THREE.GridHelper(12, 32, mutedLime, 0x253a1b)
    grid.position.set(0, -2.7, -1.2)
    grid.material.transparent = true
    grid.material.opacity = 0.2
    stage.add(grid)

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(5.6, 3.6, 0.4)),
      new THREE.LineBasicMaterial({ color: lime, transparent: true, opacity: 0.1 }),
    )
    outline.rotation.set(-0.13, 0.16, -0.03)
    outline.position.set(0, 0, -1.8)
    stage.add(outline)

    const pointer = { x: 0, y: 0 }
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      if (width === 0 || height === 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()

    let frameId = 0
    let visible = true
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
    })
    observer.observe(canvas)

    const clock = new THREE.Clock()
    const render = () => {
      const elapsed = clock.getElapsedTime()
      if (visible) {
        stage.rotation.y += (pointer.x * 0.1 - stage.rotation.y) * 0.018
        stage.rotation.x += (0.22 - pointer.y * 0.06 - stage.rotation.x) * 0.018
        rings[0].rotation.z += 0.002
        rings[1].rotation.z -= 0.0014
        rings[2].rotation.z += 0.0008
        grid.position.z = -1.2 + Math.sin(elapsed * 0.25) * 0.08
        renderer.render(scene, camera)
      }
      frameId = window.requestAnimationFrame(render)
    }
    render()

    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      stage.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose()
          const material = object.material
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
          else material.dispose()
        }
      })
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="scene-backdrop" aria-hidden="true" />
}

export default SceneBackdrop
