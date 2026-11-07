import { useState, useEffect, useRef, useCallback } from 'react'
import manifest from '../data/cloudinary_manifest.json'

const COLS = 10, ROWS = 8, CW = 210, CH = 265, W = COLS*CW, H = ROWS*CH, PAD = 240
const TARGET_AREA = 38000, MAX_W = 360, MAX_H = 240
const COLL_W = 255, COLL_H = 215  // collision box — matches typical photo size, not worst-case

function rnd(s) { const x = Math.sin(s*999.13)*43758.5453; return x - Math.floor(x) }

// Insert Cloudinary transformations into a URL:
// https://res.cloudinary.com/cloud/image/upload/TRANSFORMS/public_id.jpg
function clUrl(src, transforms) {
  return src.replace('/image/upload/', `/image/upload/${transforms}/`)
}
const thumb  = src => clUrl(src, 'f_auto,q_auto,w_500')   // canvas tiles
const cover  = src => clUrl(src, 'f_auto,q_auto,w_800')   // album ring covers
const medium = src => clUrl(src, 'f_auto,q_auto,w_900')   // album detail grid
const full   = src => clUrl(src, 'f_auto,q_auto')          // lightbox / fullscreen — full original resolution

const infoModules = import.meta.glob('../photos/*/info.json', { import: 'default', eager: true })

const photoSrcByFolder = Object.fromEntries(manifest.photos.map(p => [p.num, p.src]))

const DATA = manifest.photos
  .map(({ num, src }) => {
    const info = infoModules[`../photos/${num}/info.json`] ?? {}
    return {
      num, src,
      title: info.title ?? `Photo ${num}`,
      place: info.place ?? '',
      date:  info.date  ?? '',
      story: info.story ?? '',
      meta:  info.meta  ?? []
    }
  })
  .sort((a, b) => {
    const an = parseInt(a.num, 10), bn = parseInt(b.num, 10)
    return isNaN(an) || isNaN(bn) ? a.num.localeCompare(b.num) : an - bn
  })

const IS_MOBILE_INIT = window.innerWidth < 768
const TILE_COUNT = IS_MOBILE_INIT ? Math.min(DATA.length, 12) : Math.max(3, DATA.length)

const TILES = DATA.length === 0 ? [] : (() => {
  const placed = []
  const MARGIN = 14

  // Check all 9 wrap combinations (3 x-shifts × 3 y-shifts) so tiles never
  // overlap after the canvas wraps in x or y during panning
  const fits = (x, y, w, h) => placed.every(p => {
    for (const dx of [0, W, -W])
      for (const dy of [0, H, -H]) {
        const px = p.bx + dx, py = p.by + dy
        if (x < px + p.w + MARGIN && px < x + w + MARGIN &&
            y < py + p.h + MARGIN && py < y + h + MARGIN) return false
      }
    return true
  })

  // Shuffled cells so initial positions spread across the full canvas
  const totalCells = COLS * ROWS
  const cells = Array.from({ length: totalCells }, (_, i) => i)
  for (let i = totalCells - 1; i > 0; i--) {
    const j = Math.floor(rnd(i * 7 + 5) * (i + 1))
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
  }

  return Array.from({ length: TILE_COUNT }, (_, k) => {
    const p = k % DATA.length
    const d = DATA[p]
    const w = COLL_W, h = COLL_H

    const cell = cells[k % totalCells]
    const cx = (cell % COLS) * CW, cy = Math.floor(cell / COLS) * CH
    let bx = Math.round(cx + rnd(k + 11) * CW) % (W - w)
    let by = Math.round(cy + rnd(k + 13) * CH) % (H - h - 30)

    let found = fits(bx, by, w, h)
    for (let a = 1; a <= 600 && !found; a++) {
      bx = Math.round(rnd(k * 600 + a * 3 + 11) * (W - w))
      by = Math.round(rnd(k * 600 + a * 3 + 13) * (H - h - 30))
      found = fits(bx, by, w, h)
    }
    // Guaranteed fallback: scan a grid so we always find a free spot if one exists
    if (!found) {
      const step = 40
      outer: for (let gy = 0; gy <= H - h - 30; gy += step)
        for (let gx = 0; gx <= W - w; gx += step)
          if (fits(gx, gy, w, h)) { bx = gx; by = gy; found = true; break outer }
    }

    placed.push({ bx, by, w, h })
    return { ...d, i: k, p, w, h, bx, by }
  })
})()

const albumInfoModules = import.meta.glob('../albums/*/info.json', { import: 'default', eager: true })

const ALBUMS = Object.entries(albumInfoModules)
  .map(([path, info]) => {
    const folder     = path.match(/\/([^/]+)\/info\.json$/)[1]
    const num        = folder.split('_')[0]
    const { coverSrc: manifestCover, imageSrcs } = manifest.albums[folder] ?? { coverSrc: null, imageSrcs: [] }
    const refNums    = info.photos ?? []
    const coverSrc   = manifestCover ?? imageSrcs[0] ?? (refNums[0] ? photoSrcByFolder[refNums[0]] : null) ?? null
    return {
      num, folder,
      title:       info.title       ?? (folder.split('_').slice(1).join(' ') || `Album ${num}`),
      year:        info.year        ?? '',
      description: info.description ?? '',
      photos:      refNums,
      directSrcs:  imageSrcs,
      count:       imageSrcs.length + refNums.length,
      coverSrc
    }
  })
  .sort((a, b) => {
    const an = parseInt(a.num, 10), bn = parseInt(b.num, 10)
    return isNaN(an) || isNaN(bn) ? a.num.localeCompare(b.num) : an - bn
  })
  .map((a, i) => ({ ...a, i }))

const INITIAL_ALBUM_IDX = ALBUMS.length > 0 ? Math.floor(Math.random() * ALBUMS.length) : 0

function PhotoSlot({ src, fallback, placeholder, fit = 'cover', natural = false, maxH }) {
  const [currentSrc, setCurrentSrc] = useState(src)
  const [failed, setFailed] = useState(false)

  useEffect(() => { setCurrentSrc(src); setFailed(false) }, [src])

  const onErr = () => {
    if (currentSrc !== fallback && fallback) { setCurrentSrc(fallback) }
    else { setFailed(true) }
  }

  if (failed || !currentSrc) {
    return natural
      ? <div style={{ width: '100%', aspectRatio: '3/2', background: '#1a1815', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 10, color: '#3a3835', letterSpacing: '.04em', textTransform: 'uppercase' }}>{placeholder}</span>
        </div>
      : <div style={{ position: 'absolute', inset: 0, background: '#1a1815', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 10, color: '#3a3835', letterSpacing: '.04em', textTransform: 'uppercase' }}>{placeholder}</span>
        </div>
  }
  const noSave = e => e.preventDefault()
  if (natural) {
    return <img src={currentSrc} alt={placeholder} onError={onErr} draggable={false} onContextMenu={noSave}
      style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: maxH ?? 'none' }} />
  }
  return (
    <img src={currentSrc} alt={placeholder} onError={onErr} draggable={false} onContextMenu={noSave}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit }} />
  )
}

function NavBtn({ onClick, children }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width: 48, height: 48, background: '#171513', border: `1px solid ${hov ? '#ecebe7' : '#2a2724'}`, color: '#ecebe7', fontSize: 18, cursor: 'pointer', transition: 'border-color .15s' }}>
      {children}
    </button>
  )
}

function CloseBtn({ onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: 'none', border: `1px solid ${hov ? '#ecebe7' : '#3a3632'}`, color: '#ecebe7', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', padding: '10px 14px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'border-color .15s' }}>
      Close · Esc
    </button>
  )
}

function NavPanel({ dir, onClick, label }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ textAlign: dir === 'prev' ? 'left' : 'right', background: '#171513', border: `1px solid ${hov ? '#ecebe7' : '#2a2724'}`, color: '#ecebe7', padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: dir === 'next' ? 'flex-end' : 'flex-start', gap: 6, fontFamily: 'Archivo, sans-serif', transition: 'border-color .15s' }}>
      <span style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 11, color: '#8d8a84', letterSpacing: '.08em' }}>{dir === 'prev' ? '← PREV' : 'NEXT →'}</span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
    </button>
  )
}

function CanvasTile({ t, onOpen }) {
  const [dw, setDw] = useState(t.w)
  const onLoad = e => {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget
    if (!nw || !nh) return
    let w = Math.sqrt(TARGET_AREA * nw / nh)
    let h = TARGET_AREA / w
    if (w > MAX_W) { w = MAX_W; h = MAX_W * nh / nw }
    if (h > MAX_H) { h = MAX_H; w = MAX_H * nw / nh }
    setDw(Math.round(w))
  }
  return (
    <div data-tile={t.i} onClickCapture={onOpen}
      style={{ position: 'absolute', left: 0, top: 0, width: dw, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer', willChange: 'transform' }}>
      <div className="pic-tile-frame" style={{ filter: 'grayscale(1) brightness(.85)', transition: 'filter .5s ease, box-shadow .5s ease', boxShadow: '0 20px 60px rgba(0,0,0,.55)' }}>
        <img src={thumb(t.src)} alt={t.num} onLoad={onLoad}
          style={{ width: '100%', height: 'auto', display: 'block' }} />
      </div>
      <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 10, letterSpacing: '.04em', color: '#8d8a84', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.num} {t.title}</div>
    </div>
  )
}

export default function PicMoAr() {
  const [open, setOpen] = useState(null)
  const [openAlbum, setOpenAlbum] = useState(null)
  const [albumPhotoOpen, setAlbumPhotoOpen] = useState(null)
  const [frontIdx, setFrontIdx] = useState(INITIAL_ALBUM_IDX)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const albumPhotoOpenR = useRef(null)
  const currentAlbumDirectCountR = useRef(0)
  const [focused, setFocused] = useState(false)

  const planeRef = useRef()

  // Canvas physics refs
  const oxR = useRef(0), oyR = useRef(0)
  const vxR = useRef(0), vyR = useRef(0)
  const mxR = useRef(null), myR = useRef(null)
  const tx0R = useRef(0), ty0R = useRef(0)

  // Ring physics refs
  const raR = useRef(ALBUMS.length > 0 ? -INITIAL_ALBUM_IDX * (360 / ALBUMS.length) : 0), rvR = useRef(0)
  const rTargetR = useRef(null), rDragR = useRef(false), rMovedR = useRef(0)
  const tx_R = useRef(0), tz_R = useRef(0)
  const tmxR = useRef(0), tmyR = useRef(0)
  const bendSR = useRef(0), focusAmtR = useRef(0)

  // DOM element caches — avoid querySelectorAll every frame
  const cardElsR = useRef(null)
  const tileElsR = useRef(null)
  // Idle flags — skip DOM writes when nothing is moving
  const ringIdleR = useRef(false)
  const canvasIdleR = useRef(false)
  // Last touch timestamp — pause auto-scroll briefly after touch
  const lastTouchR = useRef(0)
  // Mobile flag ref — readable inside rAF closure without re-creating the loop
  const isMobileR = useRef(IS_MOBILE_INIT)
  const mobileCarouselRef = useRef(null)

  // Mirrors of React state for use inside rAF
  const openR = useRef(null), frontR = useRef(0), focusedR = useRef(false)
  useEffect(() => { openR.current = open }, [open])
  useEffect(() => { frontR.current = frontIdx }, [frontIdx])
  useEffect(() => { isMobileR.current = isMobile }, [isMobile])
  useEffect(() => { focusedR.current = focused }, [focused])
  useEffect(() => { albumPhotoOpenR.current = albumPhotoOpen }, [albumPhotoOpen])
  useEffect(() => {
    if (openAlbum == null) { currentAlbumDirectCountR.current = 0; return }
    const a = ALBUMS[openAlbum]
    if (!a) { currentAlbumDirectCountR.current = 0; return }
    const refCount = a.photos.filter(num => DATA.find(d => d.num === num)).length
    currentAlbumDirectCountR.current = a.directSrcs.length + refCount
  }, [openAlbum])

  const nearest = useCallback((idx) => {
    const n = ALBUMS.length, st = 360/n
    let t = -idx * st
    while (t - raR.current > 180) t -= 360
    while (t - raR.current < -180) t += 360
    return t
  }, [])

  useEffect(() => {
    let raf

    const ringTick = () => {
      if (isMobileR.current) return
      // Lazy-cache card elements once
      if (!cardElsR.current) {
        const ring = document.querySelector('[data-ring="1"]')
        if (!ring) return
        cardElsR.current = { ring, cards: [...ring.querySelectorAll('[data-card]')] }
      }
      const { ring, cards } = cardElsR.current
      const n = ALBUMS.length, st = 360/n
      const R = Math.round(250 / (2 * Math.tan(Math.PI / Math.max(3, n))))

      if (!rDragR.current) {
        if (rTargetR.current != null) {
          const d = rTargetR.current - raR.current
          rvR.current = d * 0.12; raR.current += rvR.current
          if (Math.abs(d) < 0.05) { raR.current = rTargetR.current; rTargetR.current = null; rvR.current = 0 }
        } else {
          rvR.current *= 0.94; raR.current += rvR.current
          if (Math.abs(rvR.current) < 0.25 && Math.abs(rvR.current) > 0) {
            const idx = Math.round(-raR.current / st)
            rTargetR.current = nearest(((idx % n) + n) % n)
          }
        }
      }

      const bend = Math.max(-28, Math.min(28, rvR.current * 4))
      bendSR.current += (bend - bendSR.current) * 0.15
      focusAmtR.current += ((focusedR.current ? 1 : 0) - focusAmtR.current) * 0.12

      // Skip 3D tilt on mobile (mouse-only feature)
      if (!isMobile) {
        tx_R.current += (-tmyR.current * 24 - tx_R.current) * 0.07
        tz_R.current += (tmxR.current * 6 - tz_R.current) * 0.07
      }

      const fi = ((Math.round(-raR.current / st) % n) + n) % n
      if (fi !== frontR.current) {
        setFrontIdx(fi)
        if (rTargetR.current == null) setFocused(false)
      }

      ring.style.transform = `translateZ(${-R}px) rotateX(${tx_R.current}deg) rotateZ(${tz_R.current}deg)`
      const stg = ring.parentElement
      if (stg) stg.style.perspectiveOrigin = `${50 + tmxR.current*20}% ${50 + tmyR.current*25}%`

      cards.forEach(el => {
        const i = +el.dataset.card
        const th = i * st + raR.current
        const c = Math.cos(th * Math.PI / 180)
        const isF = i === fi
        const fz = isF ? focusAmtR.current * 160 : 0
        el.style.transform = `rotateY(${th}deg) translateZ(${R+fz}px) rotateY(${-bendSR.current}deg) skewY(${bendSR.current*.25}deg) scale(${1+(isF?focusAmtR.current*.08:0)})`
        el.style.opacity = String(Math.max(0.08, (0.35+0.65*Math.max(0,c))*(isF?1:1-focusAmtR.current*.6)))
        el.style.zIndex = String(Math.round(c*100)+100)
      })
    }

    const tick = () => {
      ringTick()
      const pl = planeRef.current; if (!pl) return
      // Lazy-cache tile elements once
      if (!tileElsR.current) {
        tileElsR.current = [...pl.querySelectorAll('[data-tile]')]
      }
      let txv = 0, tyv = 0
      if (mxR.current != null && openR.current == null) {
        const f = v => { const a=Math.abs(v); if(a<.25)return 0; const k=(a-.25)/.75; return Math.sign(v)*k*k }
        txv = -f(mxR.current)*14; tyv = -f(myR.current)*14
      }
      // Auto-scroll: pause briefly after touch on mobile
      const sinceTouch = Date.now() - lastTouchR.current
      if (txv===0 && tyv===0 && openR.current==null && sinceTouch > 600) { txv=-0.6; tyv=-0.27 }
      vxR.current += (txv - vxR.current)*.06; vyR.current += (tyv - vyR.current)*.06
      oxR.current += vxR.current; oyR.current += vyR.current

      // Skip tile DOM writes when canvas is idle
      const moving = Math.abs(vxR.current) > 0.08 || Math.abs(vyR.current) > 0.08
      if (!moving && canvasIdleR.current) return
      canvasIdleR.current = !moving

      const md = (a,b) => ((a%b)+b)%b
      tileElsR.current.forEach(el => {
        const i = +el.dataset.tile, d = TILES[i]; if(!d) return
        el.style.transform = `translate3d(${md(d.bx+oxR.current+PAD,W)-PAD}px,${md(d.by+oyR.current+PAD,H)-PAD}px,0)`
      })
    }

    const loop = () => { tick(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)

    const onKey = e => {
      if (e.key === 'Escape') {
        if (openR.current != null) setOpen(null)
        else if (albumPhotoOpenR.current != null) setAlbumPhotoOpen(null)
        else setOpenAlbum(null)
        return
      }
      if (albumPhotoOpenR.current != null) {
        const n = currentAlbumDirectCountR.current
        if (n > 1) {
          if (e.key === 'ArrowRight') setAlbumPhotoOpen(i => (i + 1) % n)
          if (e.key === 'ArrowLeft')  setAlbumPhotoOpen(i => (i - 1 + n) % n)
        }
        return
      }
      if (openR.current == null) return
      if (e.key === 'ArrowRight') setOpen(o => (o+1) % DATA.length)
      if (e.key === 'ArrowLeft') setOpen(o => (o-1+DATA.length) % DATA.length)
    }
    window.addEventListener('keydown', onKey)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey) }
  }, [nearest])

  const handleRingDown = useCallback(e => {
    if (e.button !== 0) return
    e.preventDefault()
    rDragR.current = true; rMovedR.current = 0; rTargetR.current = null; ringIdleR.current = false
    let lx = e.clientX
    const mv = ev => { const dx=ev.clientX-lx; lx=ev.clientX; rMovedR.current+=Math.abs(dx); const sens=isMobile?.4:.22; raR.current+=dx*sens; rvR.current=dx*sens }
    const up = () => { rDragR.current=false; window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }, [isMobile])

  const ringClick = useCallback((i) => {
    if (i === frontR.current && rTargetR.current == null && Math.abs(rvR.current) < 0.5) {
      if (focusedR.current) { setOpenAlbum(i) }
      else { setFocused(true) }
      return
    }
    rTargetR.current = nearest(i); setFocused(true)
  }, [nearest])

  const ringGo = useCallback((idx) => {
    const n = ALBUMS.length
    const target = ((idx % n) + n) % n
    if (isMobileR.current) {
      setFrontIdx(target)
      if (mobileCarouselRef.current)
        mobileCarouselRef.current.scrollTo({ left: target * 236, behavior: 'smooth' })
    } else {
      rTargetR.current = nearest(target); setFocused(false)
    }
  }, [nearest])

  const cur = DATA.length > 0 ? DATA[open ?? 0] : null
  const prevTitle = DATA.length > 0 ? DATA[(((open??0)-1)+DATA.length) % DATA.length].title : ''
  const nextTitle = DATA.length > 0 ? DATA[((open??0)+1) % DATA.length].title : ''

  const currentAlbum = openAlbum != null ? ALBUMS[openAlbum] : null
  const currentAlbumPhotos = currentAlbum ? [
    ...currentAlbum.directSrcs.map((src, i) => ({ type: 'direct', src, directIdx: i })),
    ...currentAlbum.photos.map(num => DATA.find(d => d.num === num)).filter(Boolean).map(d => ({ type: 'ref', ...d }))
  ] : []

  return (
    <div style={{ background: '#0d0c0b', color: '#ecebe7', fontFamily: 'Archivo, Helvetica, sans-serif', minHeight: '100vh', overflowX: 'hidden' }}>

      {/* Canvas section — 2-row swipe grid on mobile, infinite physics canvas on desktop */}
      {isMobile ? (
        <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', background: '#0d0c0b' }}>
          <div className="sl-blob sl-blob-1" />
          <div className="sl-blob sl-blob-2" />
          <div className="sl-blob sl-blob-3" />

          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 70, paddingBottom: 54 }}>
            {[0, 1].map(row => (
              <div key={row} style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 3, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                {DATA.filter((_, i) => i % 2 === row).map(d => (
                  <div key={d.num} onClick={() => setOpen(DATA.indexOf(d))} style={{ flexShrink: 0, height: '100%', cursor: 'pointer' }}>
                    <img src={medium(d.src)} alt={d.num} draggable={false} onContextMenu={e => e.preventDefault()}
                      style={{ height: '100%', width: 'auto', display: 'block' }} />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 160px 40px #0d0c0b', zIndex: 1 }} />

          <div style={{ position: 'absolute', left: 20, right: 20, top: 24, zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', pointerEvents: 'none' }}>
            <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.02em' }}>PicMoAr</div>
            <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em', textTransform: 'uppercase' }}>{DATA.length} photograph{DATA.length !== 1 ? 's' : ''}</div>
          </div>

          <div style={{ position: 'absolute', left: 20, right: 20, bottom: 20, zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'oklch(0.68 0.17 32)', display: 'inline-block' }} />
              Swipe to explore
            </div>
            <div>Tap to open</div>
          </div>
        </div>
      ) : (
        <div
          onMouseMove={e => { const r=e.currentTarget.getBoundingClientRect(); mxR.current=(e.clientX-r.left-r.width/2)/(r.width/2); myR.current=(e.clientY-r.top-r.height/2)/(r.height/2) }}
          onMouseLeave={() => { mxR.current = null }}
          style={{ position: 'relative', height: '100vh', overflow: 'hidden', background: '#0d0c0b', cursor: 'crosshair' }}>

          <div className="sl-blob sl-blob-1" />
          <div className="sl-blob sl-blob-2" />
          <div className="sl-blob sl-blob-3" />

          <div ref={planeRef} style={{ position: 'absolute', inset: 0 }}>
            {TILES.map(t => (
              <CanvasTile key={t.i} t={t} onOpen={e => { e.stopPropagation(); e.preventDefault(); mxR.current=null; vxR.current=vyR.current=0; setOpen(t.p) }} />
            ))}
          </div>

          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 220px 60px #0d0c0b' }} />

          <div style={{ position: 'absolute', left: 32, right: 32, top: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', pointerEvents: 'none' }}>
            <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.02em' }}>PicMoAr</div>
            <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em', textTransform: 'uppercase' }}>{DATA.length} photograph{DATA.length !== 1 ? 's' : ''}</div>
          </div>

          <div style={{ position: 'absolute', left: 32, right: 32, bottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'oklch(0.68 0.17 32)', display: 'inline-block' }} />
              Move toward an edge to explore
            </div>
            <div>Click a photo to open</div>
          </div>
        </div>
      )}

      {/* Collections */}
      <section style={{ position: 'relative', padding: '112px 32px 72px', borderTop: '1px solid #2a2724', display: 'flex', flexDirection: 'column', gap: 32, overflow: 'hidden', minHeight: '100vh' }}>
        {/* World contours background */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/world-contours.svg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', filter: 'sepia(1) hue-rotate(320deg) saturate(2) brightness(0.7)', opacity: 0.15, pointerEvents: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: 'oklch(0.68 0.17 32)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Albums</div>
            <h2 style={{ margin: 0, fontWeight: 800, fontSize: 'clamp(28px,4vw,52px)', lineHeight: .95, letterSpacing: '-.03em' }}>Collections</h2>
          </div>
          <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em', textTransform: 'uppercase' }}>{isMobile ? 'Swipe · Tap to open' : 'Drag to spin · Click to focus'}</div>
        </div>

        {isMobile ? (
          /* Mobile: flat snap carousel — no ring physics */
          <div ref={mobileCarouselRef}
            style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none', gap: 16, padding: '0 calc(50% - 110px)', margin: '8px 0', WebkitOverflowScrolling: 'touch' }}
            onScroll={e => {
              const idx = Math.min(ALBUMS.length - 1, Math.max(0, Math.round(e.currentTarget.scrollLeft / 236)))
              if (idx !== frontIdx) setFrontIdx(idx)
            }}>
            {ALBUMS.map(a => (
              <div key={a.i} style={{ flexShrink: 0, width: 220, scrollSnapAlign: 'center', cursor: 'pointer' }}
                onClick={() => { if (a.i === frontIdx) setOpenAlbum(a.i) }}>
                <div style={{ height: 300, position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,.6)', outline: '1px solid rgba(236,235,231,.08)', filter: a.i === frontIdx ? 'none' : 'grayscale(1) brightness(.55)', transition: 'filter .3s' }}>
                  <PhotoSlot src={a.coverSrc ? cover(a.coverSrc) : null} placeholder={`album ${a.num}`} />
                </div>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8d8a84' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                  <span style={{ flexShrink: 0 }}>{a.count} photo{a.count !== 1 ? 's' : ''}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Desktop: 3D ring carousel */
          <div data-ring-stage="1"
            onPointerDown={handleRingDown}
            onMouseMove={e => { const r=e.currentTarget.getBoundingClientRect(); tmxR.current=(e.clientX-r.left)/r.width*2-1; tmyR.current=(e.clientY-r.top)/r.height*2-1 }}
            onMouseLeave={() => { tmxR.current=0; tmyR.current=0 }}
            style={{ height: 560, perspective: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}>
            <div data-ring="1" style={{ position: 'relative', width: 220, height: 300, transformStyle: 'preserve-3d' }}>
              {ALBUMS.map(a => (
                <div key={a.i} data-card={a.i}
                  onClickCapture={e => { e.stopPropagation(); e.preventDefault(); if(rMovedR.current>6)return; ringClick(a.i) }}
                  style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, willChange: 'transform,opacity' }}>
                  <div className="pic-card-frame" style={{ flex: 1, minHeight: 0, position: 'relative', filter: 'grayscale(1) brightness(.85)', transition: 'filter .5s ease', boxShadow: '0 30px 70px rgba(0,0,0,.6)', outline: '1px solid rgba(236,235,231,.08)' }}>
                    <PhotoSlot src={a.coverSrc ? cover(a.coverSrc) : null} placeholder={`album ${a.num}`} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8d8a84' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                    <span style={{ flexShrink: 0 }}>{a.count} photo{a.count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap', borderTop: '1px solid #2a2724', paddingTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 800, fontSize: 32, letterSpacing: '-.02em' }}>{ALBUMS[frontIdx]?.title}</div>
            <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em', textTransform: 'uppercase' }}>{ALBUMS[frontIdx]?.year} · {ALBUMS[frontIdx]?.count} photo{ALBUMS[frontIdx]?.count !== 1 ? 's' : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <NavBtn onClick={() => ringGo(frontIdx-1)}>←</NavBtn>
            <NavBtn onClick={() => ringGo(frontIdx+1)}>→</NavBtn>
          </div>
        </div>
      </section>

      {/* Album detail */}
      {openAlbum != null && currentAlbum && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#0d0c0b', overflowY: 'auto' }}>
          <div style={{ padding: '28px clamp(20px,3vw,48px)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #2a2724', position: 'sticky', top: 0, background: '#0d0c0b', zIndex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: 'oklch(0.68 0.17 32)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Album {currentAlbum.num}</div>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 'clamp(32px,5vw,56px)', lineHeight: .95, letterSpacing: '-.03em' }}>{currentAlbum.title}</h2>
              <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em', textTransform: 'uppercase' }}>{currentAlbum.year} · {currentAlbum.count} photo{currentAlbum.count !== 1 ? 's' : ''}</div>
              {currentAlbum.description && <p style={{ margin: '4px 0 0', fontSize: 15, color: '#bdbab4', maxWidth: '52ch', lineHeight: 1.6 }}>{currentAlbum.description}</p>}
            </div>
            <CloseBtn onClick={() => setOpenAlbum(null)} />
          </div>
          <div style={{ padding: 'clamp(20px,3vw,48px)', columns: '4 200px', columnGap: 12 }}>
            {currentAlbumPhotos.map((photo, idx) => (
              <div key={photo.type === 'direct' ? `d-${idx}` : photo.num}
                onClick={() => setAlbumPhotoOpen(idx)}
                style={{ cursor: 'pointer', breakInside: 'avoid', marginBottom: 12 }}>
                <img src={medium(photo.src)} alt={photo.title ?? ''} draggable={false} onContextMenu={e => e.preventDefault()}
                  style={{ width: '100%', height: 'auto', display: 'block', filter: 'grayscale(1) brightness(.85)', transition: 'filter .3s' }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'none'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'grayscale(1) brightness(.85)'} />
                {photo.type === 'ref' && <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 11, color: '#8d8a84', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 6 }}>{photo.num} · {photo.title}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Direct album photo viewer */}
      {albumPhotoOpen != null && currentAlbum && (
        <div onClick={() => setAlbumPhotoOpen(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(13,12,11,0.96)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={currentAlbumPhotos[albumPhotoOpen]?.src ? full(currentAlbumPhotos[albumPhotoOpen].src) : undefined} draggable={false} onContextMenu={e => e.preventDefault()} style={{ maxWidth: '88vw', maxHeight: '88vh', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
          {currentAlbumPhotos.length > 1 && <>
            <div style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)' }} onClick={e => e.stopPropagation()}>
              <NavBtn onClick={() => setAlbumPhotoOpen(i => (i - 1 + currentAlbumPhotos.length) % currentAlbumPhotos.length)}>←</NavBtn>
            </div>
            <div style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)' }} onClick={e => e.stopPropagation()}>
              <NavBtn onClick={() => setAlbumPhotoOpen(i => (i + 1) % currentAlbumPhotos.length)}>→</NavBtn>
            </div>
            <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em' }}>
              {albumPhotoOpen + 1} / {currentAlbumPhotos.length}
            </div>
          </>}
          <div style={{ position: 'absolute', top: 24, right: 24 }} onClick={e => e.stopPropagation()}>
            <CloseBtn onClick={() => setAlbumPhotoOpen(null)} />
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ padding: '24px 32px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
        <img src="/favicon.png" alt="PicMoAr" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
        <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: '-.01em' }}>PicMoAr</span>
        <span style={{ color: '#3a3835', fontSize: 14 }}>|</span>
        <a href="https://www.instagram.com/picmoar" target="_blank" rel="noopener noreferrer"
          style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 13, color: '#8d8a84', letterSpacing: '.04em', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, transition: 'color .15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#ecebe7'}
          onMouseLeave={e => e.currentTarget.style.color = '#8d8a84'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/>
          </svg>
          @picmoar
        </a>
      </footer>

      {/* Lightbox */}
      {open != null && cur != null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, background: '#0d0c0b', overflowY: 'auto',
          ...(isMobile
            ? { display: 'flex', flexDirection: 'column' }
            : { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) clamp(280px,30%,420px)', gridAutoRows: 'minmax(100vh,auto)' }
          )
        }}>
          {isMobile ? (
            <div style={{ position: 'relative', width: '100%', height: '65vw', flexShrink: 0, background: '#0d0c0b' }}>
              <PhotoSlot src={full(cur.src)} placeholder={cur.num} fit="contain" />
            </div>
          ) : (
            <div style={{ position: 'relative', padding: 'clamp(20px,4vw,72px) clamp(16px,3vw,48px)', display: 'flex', minHeight: 'min(70vh,100%)', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box', flexGrow: 1 }}>
              <div style={{ flex: 1, minHeight: 0, minWidth: 0, height: '100%', position: 'relative' }}>
                <PhotoSlot src={full(cur.src)} placeholder={cur.num} fit="contain" />
              </div>
            </div>
          )}
          <div style={{
            borderTop: isMobile ? '1px solid #2a2724' : 'none',
            borderLeft: isMobile ? 'none' : '1px solid #2a2724',
            padding: isMobile ? '24px 20px 40px' : '28px clamp(20px,3vw,40px) 40px',
            display: 'flex', flexDirection: 'column', gap: 28,
            ...(isMobile ? {} : { overflowY: 'auto', minHeight: 0, minWidth: 0, boxSizing: 'border-box', maxHeight: '100vh' })
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 12, color: '#8d8a84', letterSpacing: '.06em' }}>{cur.num} / {DATA.length}</div>
              <CloseBtn onClick={() => setOpen(null)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h1 style={{ margin: 0, fontWeight: 800, fontSize: isMobile ? 40 : 56, lineHeight: .95, letterSpacing: '-.03em' }}>{cur.title}</h1>
              <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 13, color: 'oklch(0.68 0.17 32)', letterSpacing: '.06em', textTransform: 'uppercase' }}>{cur.place} · {cur.date}</div>
            </div>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: '#bdbab4', maxWidth: '46ch' }}>{cur.story}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', borderTop: '1px solid #2a2724' }}>
              {cur.meta.map(m => (
                <div key={m.k} style={{ padding: '14px 0', borderBottom: '1px solid #2a2724', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: "'Source Sans 3',system-ui,sans-serif", fontSize: 11, color: '#8d8a84', letterSpacing: '.08em', textTransform: 'uppercase' }}>{m.k}</div>
                  <div style={{ fontSize: 15 }}>{m.v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: isMobile ? 0 : 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <NavPanel dir="prev" onClick={() => setOpen(o => (o-1+DATA.length)%DATA.length)} label={prevTitle} />
              <NavPanel dir="next" onClick={() => setOpen(o => (o+1)%DATA.length)} label={nextTitle} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
