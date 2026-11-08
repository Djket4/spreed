<!--
  - ket4tec: k4draw. SVG-слой пометок поверх показа экрана.
  - Координаты пометок 0..1 от кадра показа (не от окна): область кадра внутри <video object-fit: contain> считается заново при каждой отрисовке.
  - Рендер перенесён из прототипа talk-draw (NAS_CLOUD, ветка talk-draw).
-->

<template>
	<div
		ref="root"
		class="k4-layer"
		:class="{ 'k4-on': state.mode }"
		:style="rootStyle">
		<div ref="surf" class="k4-surf">
			<svg ref="ink" class="k4-ink" />
			<div ref="chips" class="k4-chips">
				<div ref="erc" class="k4-erc" />
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
	cursor,
	eraseMarks,
	hash,
	identity,
	join,
	LIFE,
	myId,
	onDraw,
	ping,
	reducedMotion,
	showOf,
	SP,
	state,
	strokeCancel,
	strokeEnd,
	strokePoint,
	strokeStart,
} from './useDrawing.js'

const props = defineProps({
	/** sessionId показывающего */
	presenter: { type: String, required: true },
	video: { type: Object, default: null },
	/** transform panzoom ({x, y, scale}) */
	transform: { type: Object, default: () => ({ x: 0, y: 0, scale: 1 }) },
})

const NS = 'http://www.w3.org/2000/svg'
const WID = { laser: 6, fade: 5, marker: 5, arrow: 5, frame: 5 }
const PING_MS = 2400

const root = ref(null)
const surf = ref(null)
const ink = ref(null)
const chips = ref(null)
const erc = ref(null)

// вне режима рисования слой повторяет transform видео (panzoom)
const rootStyle = computed(() => {
	const t = props.transform
	return state.mode || !t || (t.scale === 1 && !t.x && !t.y)
		? {}
		: { transform: `matrix(${t.scale},0,0,${t.scale},${t.x},${t.y})` }
})

let W = 0
let H = 0
const views = new Map() // key -> view
const curs = new Map() // автор -> курсор
let pingN = 0
let raf = 0
let leave = null
let off = null
let ro = null
let cur = null // текущий штрих/ластик
let ptr = null
let multi = false
let t0 = 0

const f1 = (v) => Math.round(v * 10) / 10
const pt = (p) => f1(p[0]) + ' ' + f1(p[1])
/**
 *
 * @param tag
 * @param a
 */
function mk(tag, a) {
	const n = document.createElementNS(NS, tag)
	for (const k in a) {
		n.setAttribute(k, a[k])
	}
	return n
}

/** Область кадра внутри <video>: считается при каждой отрисовке. */
function sync() {
	const v = props.video
	if (!v || !v.videoWidth || !v.clientWidth) {
		return false
	}
	const cw = v.clientWidth
	const ch = v.clientHeight
	const ar = v.videoWidth / v.videoHeight
	let w = cw
	let h = cw / ar
	if (h > ch) {
		h = ch
		w = ch * ar
	}
	const s = surf.value.style
	s.left = (cw - w) / 2 + 'px'
	s.top = (ch - h) / 2 + 'px'
	s.width = w + 'px'
	s.height = h + 'px'
	if (Math.abs(w - W) < 0.5 && Math.abs(h - H) < 0.5) {
		return false
	}
	W = w
	H = h
	ink.value.setAttribute('viewBox', `0 0 ${w} ${h}`)
	return true
}

/**
 *
 * @param except
 */
function redrawAll(except) {
	views.forEach((v) => v !== except && draw(v))
}

const px = (m) => m.pts.map((p) => [p[0] * W, p[1] * H])

/**
 *
 * @param m
 */
function samples(m) {
	const P = px(m)
	if (m.tool !== 'arrow' && m.tool !== 'frame') {
		return P
	}
	const a = P[0] || [0, 0]
	const b = P[P.length - 1] || a
	const o = []
	if (m.tool === 'frame') {
		// рамка «от руки»: суперэллипс с перехлёстом
		const seed = hash(m.id) % 600 / 100
		const cx = (a[0] + b[0]) / 2
		const cy = (a[1] + b[1]) / 2
		const rx = Math.max(10, Math.abs(b[0] - a[0]) / 2)
		const ry = Math.max(10, Math.abs(b[1] - a[1]) / 2)
		const ta = -2.4
		const tb = ta + Math.PI * 2 + 0.4
		const N = 160
		const e = 0.18
		for (let i = 0; i <= N; i++) {
			const t = ta + (tb - ta) * i / N
			const c = Math.cos(t)
			const sn = Math.sin(t)
			const k = 1 + 0.012 * Math.sin(t * 1.3 + seed) + 0.03 * i / N
			o.push([cx + rx * k * Math.sign(c) * Math.abs(c) ** e, cy + ry * k * Math.sign(sn) * Math.abs(sn) ** e])
		}
		return o
	}
	// стрелка слегка изогнута
	const dx = b[0] - a[0]
	const dy = b[1] - a[1]
	const Ln = Math.hypot(dx, dy) || 1
	const bend = 0.13 * Ln * (dx >= 0 ? -1 : 1)
	const c = [(a[0] + b[0]) / 2 - dy / Ln * bend, (a[1] + b[1]) / 2 + dx / Ln * bend]
	for (let i = 0; i <= 24; i++) {
		const t = i / 24
		const u = 1 - t
		o.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]])
	}
	return o
}

/**
 *
 * @param P
 */
function smooth(P) {
	if (P.length < 2) {
		return P.length ? `M${pt(P[0])}l.01 0` : ''
	}
	if (P.length < 3) {
		return `M${pt(P[0])}L${pt(P[1])}`
	}
	let d = 'M' + pt(P[0])
	for (let i = 1; i < P.length - 1; i++) {
		d += 'Q' + pt(P[i]) + ' ' + pt([(P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2])
	}
	return d + 'L' + pt(P[P.length - 1])
}

/**
 *
 * @param P
 * @param w
 */
function head(P, w) {
	const b = P[P.length - 1]
	const a = P[Math.max(0, P.length - 4)]
	const an = Math.atan2(b[1] - a[1], b[0] - a[0])
	const h = 14 + w * 1.6
	return `M${pt([b[0] - h * Math.cos(an - 0.5), b[1] - h * Math.sin(an - 0.5)])}L${pt(b)}L${pt([b[0] - h * Math.cos(an + 0.5), b[1] - h * Math.sin(an + 0.5)])}`
}

/**
 *
 * @param m
 */
function view(m) {
	let v = views.get(m.key)
	if (!v) {
		v = { m, c: identity(m.by).color }
		const g = v.g = mk('g', { class: m.tool, 'data-id': m.id, 'data-by': m.by })
		if (m.tool === 'ping') {
			g.append(v.r = mk('circle', { class: 'r', r: 9, fill: 'none', stroke: v.c, 'stroke-width': 3 }), v.p = mk('circle', { r: 8, fill: v.c, stroke: '#0005', 'stroke-width': 1.5 }))
		} else if (m.tool === 'laser') {
			g.append(
				v.gl = mk('path', { class: 'gl', stroke: v.c, 'stroke-width': 16 }),
				v.po = mk('path', { class: 'po', stroke: v.c, 'stroke-width': 5 }),
				v.p = mk('path', { class: 'p', stroke: v.c, 'stroke-width': 6 }),
				v.tc = mk('circle', { r: 13, fill: v.c, opacity: 0.35 }),
				v.tp = mk('circle', { class: 'tip', r: 5.5, stroke: v.c, 'stroke-width': 3 }),
			)
		} else {
			g.append(v.sh = mk('path', { class: 'sh', 'stroke-width': WID[m.tool] + 3 }), v.p = mk('path', { class: 'p', stroke: v.c, 'stroke-width': WID[m.tool] }))
		}
		ink.value.append(g)
		views.set(m.key, v)
		if (m.tool === 'laser') {
			kick()
		}
	}
	return v
}

/**
 *
 * @param v
 */
function draw(v) {
	if (sync()) {
		redrawAll(v)
	}
	const m = v.m
	if (m.tool === 'laser') {
		return drawLaser(v)
	}
	const P = m.tool === 'ping' ? px(m) : samples(m)
	if (!P.length) {
		return
	}
	if (m.tool === 'ping') {
		for (const [i, k] of ['cx', 'cy'].entries()) {
			v.p.setAttribute(k, f1(P[0][i]))
			v.r.setAttribute(k, f1(P[0][i]))
		}
	} else {
		let d = smooth(P)
		if (m.tool === 'arrow' && P.length > 1) {
			d += head(P, WID.arrow)
		}
		v.p.setAttribute('d', d)
		v.sh.setAttribute('d', d)
	}
	v.chip && placeChip(v, P)
}

/**
 * Лазер: рисуются последние 650 мс следа, старая половина бледнее, кончик светится.
 *
 * @param v
 */
function drawLaser(v) {
	const m = v.m
	const now = performance.now()
	const P = []
	const T = []
	m.pts.forEach((p, i) => {
		if (now - m.ts[i] <= LIFE) {
			P.push([p[0] * W, p[1] * H])
			T.push(m.ts[i])
		}
	})
	const k = T.findIndex((t) => now - t < LIFE / 2)
	const old = k < 0 ? P : P.slice(0, k + 1)
	const nw = k < 0 ? [] : P.slice(k)
	v.po.setAttribute('d', smooth(old))
	v.p.setAttribute('d', smooth(nw))
	v.gl.setAttribute('d', smooth(nw))
	const tip = P.length && !m.done ? P[P.length - 1] : null
	for (const n of ['tc', 'tp']) {
		v[n].style.display = tip ? '' : 'none'
		if (tip) {
			v[n].setAttribute('cx', f1(tip[0]))
			v[n].setAttribute('cy', f1(tip[1]))
		}
	}
}

/**
 *
 */
function kick() {
	if (!raf) {
		raf = requestAnimationFrame(loop)
	}
}
/**
 *
 */
function loop() {
	raf = 0
	const L = [...views.values()].filter((v) => v.m.tool === 'laser')
	L.forEach(draw)
	if (L.length) {
		raf = requestAnimationFrame(loop)
	}
}

// ── подписи-капсулы ──
/**
 *
 * @param v
 * @param P
 */
function anchor(v, P) {
	const m = v.m
	if (m.tool === 'arrow') {
		return P[0]
	}
	if (m.tool === 'frame') {
		return P.reduce((q, p) => p[0] - p[1] > q[0] - q[1] ? p : q)
	}
	if (m.tool === 'ping') {
		return [P[0][0] + 6, P[0][1] + 4]
	}
	return P[P.length - 1]
}

/**
 *
 * @param v
 * @param P
 */
function placeChip(v, P) {
	const a = anchor(v, P)
	const w = v.cw || (v.cw = v.chip.offsetWidth || 70)
	let x = a[0] + 8
	let y = a[1] - 34
	if (x + w > W - 4) {
		x = a[0] - w - 8
	}
	if (v.m.tool === 'arrow' && P.length > 2) {
		const dx = P[2][0] - a[0]
		const dy = P[2][1] - a[1]
		x = dx > 0 ? a[0] - w - 6 : a[0] + 6
		y = dy < 0 ? a[1] + 4 : a[1] - 30
	}
	x = Math.max(4, Math.min(W - w - 4, x))
	y = Math.max(4, Math.min(H - 30, y))
	for (let k = 0; k < 4; k++) {
		let hit = null
		views.forEach((q) => {
			if (!hit && q !== v && q.chip && q.cx !== undefined && !q.gone && Math.abs(q.cx - x) < Math.max(q.cw, w) && Math.abs(q.cy - y) < 28) {
				hit = q
			}
		})
		if (!hit) {
			break
		}
		y = hit.cy + (y > H - 60 ? -30 : 30)
	}
	v.cx = x
	v.cy = y
	v.chip.style.transform = `translate(${f1(x)}px,${f1(y)}px)`
}

/**
 *
 * @param v
 * @param animate
 */
function addChip(v, animate = true) {
	if (v.chip) {
		return
	}
	const m = v.m
	const ring = m.tool === 'fade'
	const c = v.chip = document.createElement('div')
	c.className = 'k4-chip' + (ring ? ' tm' : '')
	c.style.setProperty('--c', v.c)
	c.style.setProperty('--ttl', (ring ? m.ttl * 1000 : 0) + 'ms')
	if (ring) {
		const s = mk('svg', { class: 'ring', viewBox: '0 0 16 16' })
		s.append(mk('circle', { class: 'bg', cx: 8, cy: 8, r: 6, pathLength: 1 }), mk('circle', { class: 'fg', cx: 8, cy: 8, r: 6, pathLength: 1 }))
		c.append(s)
	}
	const sp = document.createElement('span')
	sp.textContent = identity(m.by).name // только текст, без HTML
	c.append(sp)
	chips.value.append(c)
	draw(v)
	if (animate && !reducedMotion()) {
		c.animate([{ scale: '.4', opacity: 0 }, { scale: '1', opacity: 1 }], { duration: 500, easing: SP.pop })
	}
}

/**
 *
 * @param v
 * @param out
 */
function remove(v, out) {
	views.delete(v.m.key)
	v.gone = 1
	const rm = () => {
		v.g.remove()
		v.chip?.remove()
	}
	if (out) {
		v.g.classList.add('out')
		v.chip?.classList.add('out')
		setTimeout(rm, 230)
	} else {
		rm()
	}
}

/**
 * Отметка «сюда» (тап): гаснет сама.
 *
 * @param by
 * @param p
 */
function transient(by, p) {
	const m = { key: 'ping' + (++pingN), id: 'ping' + pingN, by, tool: 'ping', pts: [p], ts: [] }
	const v = view(m)
	draw(v)
	addChip(v)
	setTimeout(() => remove(v, true), PING_MS)
}

// ── чужие курсоры ──
/**
 *
 * @param by
 * @param p
 * @param las
 */
function cursorAt(by, p, las) {
	if (by === myId()) {
		return
	}
	let c = curs.get(by)
	if (!c) {
		const el = document.createElement('div')
		el.className = 'k4-rcur'
		el.style.setProperty('--c', identity(by).color)
		const i = document.createElement('i')
		const b = document.createElement('b')
		b.textContent = identity(by).name
		el.append(i, b)
		chips.value.append(el)
		c = { el, timer: 0 }
		curs.set(by, c)
	}
	c.el.classList.toggle('las', !!las)
	c.el.style.opacity = 1
	c.el.style.transform = `translate(${f1(p[0] * W)}px,${f1(p[1] * H)}px)`
	clearTimeout(c.timer)
	c.timer = setTimeout(() => {
		c.el.style.opacity = 0
		c.timer = setTimeout(() => {
			c.el.remove()
			curs.delete(by)
		}, 300)
	}, las ? 900 : 2500)
}

// ── события контроллера ──
/**
 *
 */
function rebuild() {
	views.forEach((v) => {
		v.g.remove()
		v.chip?.remove()
	})
	views.clear()
	curs.forEach((c) => {
		clearTimeout(c.timer)
		c.el.remove()
	})
	curs.clear()
	sync()
	showOf(props.presenter)?.marks.forEach((m) => {
		const v = view(m)
		draw(v)
		if (m.fading) {
			v.g.classList.add('fade')
		} else if (m.done && m.tool !== 'laser') {
			addChip(v, false)
		}
	})
}

/**
 *
 * @param ev
 */
function onEvent(ev) {
	if (ev.t === 'show') {
		ev.show.presenter === props.presenter && rebuild()
		return
	}
	if (!ev.show || ev.show.presenter !== props.presenter) {
		return
	}
	const m = ev.mark
	switch (ev.t) {
		case 'add':
			draw(view(m))
			break
		case 'pts':
			draw(view(m))
			m.tool === 'laser' && cursorAt(m.by, m.pts[m.pts.length - 1], true)
			break
		case 'end': {
			const v = view(m)
			m.tool !== 'laser' && addChip(v)
			draw(v)
			break
		}
		case 'fade': {
			const v = views.get(m.key)
			v?.g.classList.add('fade')
			v?.chip?.classList.add('fade')
			break
		}
		case 'del': {
			const v = views.get(m.key)
			v && remove(v, ev.out)
			break
		}
		case 'ping':
			transient(ev.by, [ev.x, ev.y])
			break
		case 'cur':
			cursorAt(ev.by, [ev.x, ev.y], false)
			break
	}
}

// ── ввод: мышь и палец ──
let rect = null
const nrm = (e) => [Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))]
const show = () => showOf(props.presenter)

/**
 *
 * @param p
 */
function eraseAt(p) {
	const x = p[0] * W
	const y = p[1] * H
	erc.value.style.transform = `translate(${f1(x)}px,${f1(y)}px)`
	const hit = []
	views.forEach((v) => {
		const m = v.m
		if (m.by !== myId() || m.tool === 'laser' || m.tool === 'ping' || v.gone) {
			return
		}
		const P = samples(m)
		const r = 20 + WID[m.tool] / 2
		for (let i = 0; i < P.length; i++) {
			const a = P[i]
			const b = P[i + 1] || a
			const dx = b[0] - a[0]
			const dy = b[1] - a[1]
			const L2 = dx * dx + dy * dy
			const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0
			if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < r) {
				hit.push(m)
				break
			}
		}
	})
	hit.length && eraseMarks(show(), hit)
}

/**
 *
 */
function cancelCur() {
	if (cur?.m) {
		cur.m.tool === 'laser' ? strokeEnd(show(), cur.m) : strokeCancel(show(), cur.m)
	}
	cur = null
	erc.value?.classList.remove('on')
}

/**
 *
 * @param e
 */
function onDown(e) {
	if (!state.mode || !W || !show()) {
		return
	}
	if (ptr !== null) {
		// второй палец отменяет текущий штрих
		cancelCur()
		multi = true
		return
	}
	ptr = e.pointerId
	multi = false
	try {
		ink.value.setPointerCapture(e.pointerId)
	} catch (_) { /* не критично */ }
	rect = surf.value.getBoundingClientRect()
	const p = nrm(e)
	t0 = performance.now()
	if (state.tool === 'eraser') {
		cur = { er: true }
		erc.value.classList.add('on')
		eraseAt(p)
		return
	}
	cur = { m: strokeStart(show(), state.tool, p), last: p }
}

/**
 *
 * @param e
 */
function onMove(e) {
	if (!state.mode || !W || !show()) {
		return
	}
	if (ptr === null) {
		rect = surf.value.getBoundingClientRect()
		cursor(show(), nrm(e))
		return
	}
	if (e.pointerId !== ptr || !cur) {
		return
	}
	const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
	for (const ev of (evs.length ? evs : [e])) {
		const p = nrm(ev)
		if (cur.er) {
			eraseAt(p)
			continue
		}
		const m = cur.m
		if (!m) {
			break
		}
		if (m.tool === 'arrow' || m.tool === 'frame') {
			cur.last = p
		} else if (m.tool === 'laser' || Math.hypot((p[0] - cur.last[0]) * W, (p[1] - cur.last[1]) * H) >= 2) {
			strokePoint(show(), m, p)
			cur.last = p
		}
	}
	if (cur.m) {
		(cur.m.tool === 'arrow' || cur.m.tool === 'frame') && strokePoint(show(), cur.m, cur.last)
		cursor(show(), cur.last)
	}
}

/**
 *
 * @param e
 */
function onUp(e) {
	if (e.pointerId !== ptr) {
		return
	}
	ptr = null
	const c = cur
	cur = null
	if (!c) {
		return
	}
	if (c.er) {
		erc.value.classList.remove('on')
		return
	}
	const m = c.m
	if (!m) {
		return
	}
	const s = show()
	const quick = performance.now() - t0 < 400
	if (m.tool === 'laser') {
		strokeEnd(s, m)
		if (m.pts.length < 3 && quick && !multi && e.type !== 'pointercancel') {
			ping(s, c.last)
		}
		return
	}
	if (e.type === 'pointercancel' || multi) {
		strokeCancel(s, m)
		return
	}
	const P = px(m)
	const len = P.reduce((a, p, i) => i ? a + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0, 0)
	if (len < 8) {
		strokeCancel(s, m)
		quick && ping(s, c.last)
		return
	}
	strokeEnd(s, m)
}

watch(() => state.mode, (on) => {
	if (!on) {
		cancelCur()
		ptr = null
	}
})

/**
 *
 */
function onVideo() {
	sync()
	redrawAll()
}

watch(() => props.video, (nv, ov) => {
	for (const ev of ['resize', 'loadedmetadata']) {
		ov?.removeEventListener(ev, onVideo)
		nv?.addEventListener(ev, onVideo)
	}
	onVideo()
})

onMounted(() => {
	const i = ink.value
	i.addEventListener('pointerdown', onDown)
	i.addEventListener('pointermove', onMove)
	i.addEventListener('pointerup', onUp)
	i.addEventListener('pointercancel', onUp)
	ro = new ResizeObserver(onVideo)
	ro.observe(root.value)
	props.video?.addEventListener('resize', onVideo)
	props.video?.addEventListener('loadedmetadata', onVideo)
	off = onDraw(onEvent)
	leave = join(props.presenter)
	rebuild()
})

onBeforeUnmount(() => {
	cancelCur()
	cancelAnimationFrame(raf)
	ro?.disconnect()
	props.video?.removeEventListener('resize', onVideo)
	props.video?.removeEventListener('loadedmetadata', onVideo)
	off?.()
	leave?.()
	curs.forEach((c) => clearTimeout(c.timer))
})
</script>

<style lang="scss">
.k4-layer {
	position: absolute;
	inset: 0;
	pointer-events: none;
	transform-origin: 0 0;
	z-index: 2;
}
.k4-surf {
	position: absolute;
	pointer-events: none;
}
.k4-ink {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
	touch-action: none;
	z-index: 3;
	path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.sh { stroke: #000; stroke-opacity: .28; }
	.laser .gl { stroke-opacity: .28; }
	.laser .po { stroke-opacity: .38; }
	.laser .tip { fill: #fff; }
	g { transition: opacity .22s ease-in; }
	g.out { opacity: 0; }
	g.fade { opacity: 0; transition: opacity .8s ease-in; }
	.ping .r { transform-box: fill-box; transform-origin: center; animation: k4-ping 1.1s ease-out 3; }
}
.k4-on .k4-ink { pointer-events: auto; cursor: crosshair; }
@keyframes k4-ping { from { transform: scale(1); opacity: .9; } to { transform: scale(3.4); opacity: 0; } }
.k4-chips { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
.k4-chip {
	position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 5px; height: 26px; padding: 0 11px; border-radius: 999px;
	background: var(--c); color: #1d1819; font-size: 12.5px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 6px #0005; transition: opacity .22s ease-in;
	&.out, &.fade { opacity: 0; }
	&.fade { transition: opacity .8s ease-in; }
	.ring { display: none; width: 14px; height: 14px; margin-left: -4px; transform: rotate(-90deg); }
	&.tm .ring { display: block; }
	.ring circle { fill: none; stroke: #1d1819; stroke-width: 2.4; stroke-dasharray: 1 1; stroke-linecap: round; }
	.ring .bg { stroke-opacity: .22; }
	.ring .fg { animation: k4-ttl var(--ttl) linear forwards; }
}
@keyframes k4-ttl { to { stroke-dashoffset: 1; } }
.k4-rcur {
	position: absolute; left: 0; top: 0; pointer-events: none; z-index: 5; transition: opacity .3s;
	i { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px #fff, 0 4px 14px #0007; }
	&.las i { display: none; }
	b { position: absolute; left: 14px; top: -34px; height: 24px; padding: 0 9px; border-radius: 999px; background: var(--c); color: #1d1819; font-size: 12px; font-weight: 700; line-height: 24px; white-space: nowrap; }
}
.k4-erc {
	position: absolute; left: 0; top: 0; width: 40px; height: 40px; margin: -20px; border-radius: 50%; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #0004; pointer-events: none; opacity: 0; transition: opacity .15s;
	&.on { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
	.k4-ink .ping .r { animation: none; }
	.k4-chip .ring .fg { animation-duration: 0s; }
}
</style>
