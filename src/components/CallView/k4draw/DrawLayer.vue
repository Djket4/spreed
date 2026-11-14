<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -
  - ket4tec: k4draw. SVG-слой пометок поверх показа экрана.
  - Координаты пометок 0..1 от кадра показа (не от окна): область кадра внутри <video object-fit: contain> считается заново при каждой отрисовке.
  - Рендер перенесён из прототипа talk-draw (NAS_CLOUD, ветка talk-draw).
-->

<template>
	<div
		ref="root"
		class="k4-layer"
		:class="{ 'k4-on': state.mode, 'k4-bd': board && canDraw() }"
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
	amMod,
	canDraw,
	cursor,
	eraseMarks,
	hash,
	identity,
	join,
	laserLife,
	moveMark,
	myColor,
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
	textPut,
} from './useDrawing.js'

const props = defineProps({
	/** sessionId показывающего */
	presenter: { type: String, required: true },
	video: { type: Object, default: null },
	/** transform panzoom ({x, y, scale}) */
	transform: { type: Object, default: () => ({ x: 0, y: 0, scale: 1 }) },
	/** доска: кадра нет, соотношение сторон из показа (`h.ar`) */
	board: { type: Boolean, default: false },
})

const NS = 'http://www.w3.org/2000/svg'
const WID = { laser: 6, fade: 5, marker: 5, arrow: 5, frame: 5 }
const wid = (m) => WID[m.tool] * (m.wm || 1) // ket4tec: k4draw. толщина, выбранная автором (1/2/4)
const PING_MS = 2400
const BANDS = 8 // полосы прозрачности хвоста лазера
const HAND_MS = 2000 // ket4tec (п.6/39): подпись у руки рисующего гаснет через 2 с
const SZ = { s: [16, 5], m: [21, 6], l: [28, 7] } // [кегль, вертикальный отступ] как в прототипе

const root = ref(null)
const surf = ref(null)
const ink = ref(null)
const chips = ref(null)
const erc = ref(null)

// слой всегда повторяет transform видео (panzoom): штрихи держатся за картинку и при зуме во время рисования (NAS_CLOUD#108)
const rootStyle = computed(() => {
	const t = props.transform
	return !t || (t.scale === 1 && !t.x && !t.y)
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
let tap = 0 // время последнего короткого тапа (двойной тап по своему тексту = правка)
let edit = null // открытое поле ввода текста
let ptrPen = false // текущий штрих пером
let penAt = -1e9 // когда перо последний раз было у экрана (пальцы в это время — ладонь)
let gest = false // два пальца на показе (вкл. поля вокруг кадра): до полного отпускания ни штриха, ни курсора (NAS_CLOUD#108)
let tbox = null

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
	let cw, ch, ar
	if (props.board) {
		ar = showOf(props.presenter)?.ar
		cw = root.value?.clientWidth
		ch = root.value?.clientHeight
		if (!ar || !cw || !ch) {
			return false
		}
	} else {
		if (!v || !v.videoWidth || !v.clientWidth) {
			return false
		}
		cw = v.clientWidth
		ch = v.clientHeight
		ar = v.videoWidth / v.videoHeight
	}
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
	views.forEach((v) => v !== except && paint(v))
}

// ket4tec (NAS_CLOUD#103 п.52): точки штриха приходят чаще кадра (coalesced-события, сеть). Рисуем раз в кадр:
// грязные пометки копятся, sync() (чтение раскладки) — один раз на кадр, а не на каждую точку.
const dirty = new Set()
let fr = 0
const perf = (window.__k4perf ||= { ev: 0, fr: 0, ms: 0, max: 0 }) // замеры для e2e: событий, кадров, время отрисовки
/**
 * Отрисовать пометку в ближайшем кадре.
 *
 * @param v вид пометки
 */
function later(v) {
	dirty.add(v)
	fr ||= requestAnimationFrame(flush)
}
/** Кадр: раскладка один раз, затем только изменившиеся пометки. */
function flush() {
	fr = 0
	const t = performance.now()
	if (sync()) {
		redrawAll()
	} else {
		dirty.forEach((v) => !v.gone && paint(v))
	}
	dirty.clear()
	const ms = performance.now() - t
	perf.fr++
	perf.ms += ms
	perf.max = Math.max(perf.max, ms)
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
 * Линия переменной толщины (нажим пера): контур с круглыми концами.
 *
 * @param P точки px
 * @param D толщина в каждой точке
 */
function inkPath(P, D) {
	const n = P.length
	if (n < 2) {
		const r = f1((D[0] || 4) / 2)
		return P.length ? `M${pt([P[0][0] - r, P[0][1]])}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : ''
	}
	const L = []
	const Rr = []
	for (let i = 0; i < n; i++) {
		const a = P[Math.max(0, i - 1)]
		const b = P[Math.min(n - 1, i + 1)]
		const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
		const nx = -(b[1] - a[1]) / l * D[i] / 2
		const ny = (b[0] - a[0]) / l * D[i] / 2
		L.push([P[i][0] + nx, P[i][1] + ny])
		Rr.push([P[i][0] - nx, P[i][1] - ny])
	}
	const r0 = f1(D[0] / 2)
	const r1 = f1(D[n - 1] / 2)
	return 'M' + L.map(pt).join('L') + `A${r1} ${r1} 0 0 0 ${pt(Rr[n - 1])}L` + Rr.reverse().map(pt).join('L') + `A${r0} ${r0} 0 0 0 ${pt(L[0])}Z`
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
		v = { m, c: m.col || identity(m.by).color }
		const g = v.g = mk('g', { class: m.tool, 'data-id': m.id, 'data-by': m.by, 'data-ttl': m.ttl || 0 })
		if (m.tool === 'text') {
			g.append(v.bg = mk('rect', { fill: '#141112', 'fill-opacity': 0.66 }), v.tx = mk('text', { fill: v.c, 'dominant-baseline': 'central', 'font-weight': 700 }))
		} else if (m.tool === 'ping') {
			g.append(v.r = mk('circle', { class: 'r', r: 9, fill: 'none', stroke: v.c, 'stroke-width': 3 }), v.p = mk('circle', { r: 8, fill: v.c, stroke: '#0005', 'stroke-width': 1.5 }))
		} else if (m.tool === 'laser') {
			g.append(
				v.gl = mk('g', { stroke: v.c }),
				v.p = mk('g', { stroke: v.c }),
				v.tc = mk('circle', { r: 13, fill: v.c, opacity: 0.35 }),
				v.tp = mk('circle', { class: 'tip', r: 5.5, stroke: v.c, 'stroke-width': 3 }),
			)
		} else {
			g.append(v.sh = mk('path', { class: 'sh', 'stroke-width': wid(m) + 3 }), v.p = mk('path', { class: 'p', stroke: v.c, 'stroke-width': wid(m) }))
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
	paint(v)
}

/**
 * Отрисовать пометку без пересчёта раскладки.
 *
 * @param v вид пометки
 */
function paint(v) {
	const m = v.m
	if (m.tool === 'laser') {
		return drawLaser(v)
	}
	if (m.tool === 'text') {
		return drawText(v)
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
		// предсказанные точки пера (getPredictedEvents) — только на экране, до следующего события
		m.pred?.length && !m.done && P.push(...m.pred.map((q) => [q[0] * W, q[1] * H]))
		let d
		if (m.pr && m.pr.length === m.pts.length) {
			const D = m.pr.map((q) => wid(m) * (0.3 + 1.4 * q))
			while (D.length < P.length) {
				D.push(D[D.length - 1] || wid(m))
			}
			d = inkPath(P, D)
			if (!v.pen) {
				v.pen = 1
				v.p.style.fill = v.c
				v.p.style.stroke = 'none'
				v.sh.setAttribute('stroke-width', 1.5)
			}
		} else {
			d = smooth(P)
			if (m.tool === 'arrow' && P.length > 1) {
				d += head(P, wid(m))
			}
		}
		v.p.setAttribute('d', d)
		v.sh.setAttribute('d', d)
	}
	v.chip && placeChip(v, P)
}

/**
 * Текст: капсула и подпись внутри SVG, только textContent.
 *
 * @param v
 */
function drawText(v) {
	const m = v.m
	const [fs, py] = SZ[m.size]
	const h = Math.round(fs * 1.25 + py * 2)
	v.tx.textContent = m.text
	v.g.dataset.ttl = m.ttl || 0 // правка может сменить «остаётся/гаснет»
	v.tx.setAttribute('font-size', fs)
	let tw = 0
	try {
		tw = v.tx.getComputedTextLength()
	} catch (_) { /* не критично */ }
	const w = Math.round(tw + 24)
	const x = m.x * W // ровно по присланному: подгонка внутрь кадра только у автора до отправки (finishEdit)
	const y = m.y * H
	v.tx.setAttribute('x', f1(x + 12))
	v.tx.setAttribute('y', f1(y + h / 2))
	for (const [k, a] of Object.entries({ x: f1(x), y: f1(y), width: w, height: h, rx: h / 2 })) {
		v.bg.setAttribute(k, a)
	}
	v.bb = [x, y, w, h]
	v.chip && placeChip(v, [[x, y]])
}

/**
 * Лазер: рисуются последние 650 мс следа, старая половина бледнее, кончик светится.
 *
 * @param v
 */
function drawLaser(v) {
	const m = v.m
	const now = performance.now()
	const life = laserLife(m)
	const P = []
	const T = []
	m.pts.forEach((p, i) => {
		if (now - m.ts[i] <= life) {
			P.push([p[0] * W, p[1] * H])
			T.push(m.ts[i])
		}
	})
	// хвост гаснет плавно по всей длине: кривая Катмулла–Рома; кусочки по возрасту — в BANDS полос (своя толщина и прозрачность).
	// Узлы SVG создаются один раз, в кадре меняется только `d` (п.52: раньше — сотни новых <line> на каждый кадр)
	const [Q, QT] = curve(P, T)
	if (!v.bands) {
		v.bands = []
		for (let b = 0; b < BANDS; b++) {
			const f = (b + 0.5) / BANDS
			const g = mk('path', { 'stroke-width': f1(2 + 14 * (1 - f)), 'stroke-opacity': (0.26 * (1 - f)).toFixed(3) })
			const c = mk('path', { 'stroke-width': f1(1.2 + 5 * (1 - f) ** 0.7), 'stroke-opacity': ((1 - f) ** 1.3).toFixed(3) })
			v.gl.append(g)
			v.p.append(c)
			v.bands.push([g, c])
		}
	}
	const D = new Array(BANDS).fill('')
	let prev = -1
	for (let i = 1; i < Q.length; i++) {
		const f = (now - (QT[i - 1] + QT[i]) / 2) / life
		if (f >= 1) {
			prev = -1
			continue
		}
		const b = Math.min(BANDS - 1, Math.max(0, Math.floor(f * BANDS)))
		D[b] += (b === prev ? '' : 'M' + pt(Q[i - 1])) + 'L' + pt(Q[i])
		prev = b
	}
	v.bands.forEach(([g, c], b) => {
		g.setAttribute('d', D[b])
		c.setAttribute('d', D[b])
	})
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
 * Точки по кривой Катмулла–Рома (4 на отрезок) и время каждой.
 *
 * @param P точки в пикселях
 * @param T время точек
 */
function curve(P, T) {
	if (P.length < 2) {
		return [P, T]
	}
	const Q = [P[0]]
	const QT = [T[0]]
	for (let i = 0; i < P.length - 1; i++) {
		const p0 = P[Math.max(0, i - 1)]
		const p1 = P[i]
		const p2 = P[i + 1]
		const p3 = P[Math.min(P.length - 1, i + 2)]
		for (let s = 1; s <= 4; s++) {
			const t = s / 4
			const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
			Q.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])])
			QT.push(T[i] + (T[i + 1] - T[i]) * t)
		}
	}
	return [Q, QT]
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
	sync() && redrawAll()
	L.forEach(paint)
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
	if (m.tool === 'text') {
		const [x, y, , h] = v.bb
		return [x - 8, y < 34 ? y + h + 34 : y]
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
	const ring = m.ttl > 0
	const c = v.chip = document.createElement('div')
	c.className = 'k4-chip' + (ring ? ' tm' : '')
	c.style.setProperty('--c', v.c)
	c.dataset.tool = m.tool // для снимка (snapshot.js)
	c.dataset.by = m.by
	c.dataset.ttl = m.ttl || 0
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
 * @param ms через сколько подпись гаснет
 */
function cursorAt(by, p, las, ms = las ? 900 : 2500) {
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
	}, ms)
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
		case 'upd': {
			const v = view(m)
			v.g.classList.remove('fade')
			v.g.style.opacity = ''
			if (m.tool === 'text') { // рамка/стрелка после переноса остаётся с подписью, она едет следом
				v.chip?.remove()
				v.chip = null
				v.cw = 0
			}
			draw(v)
			break
		}
		case 'pts':
			perf.ev++
			later(view(m))
			// одна подпись у руки чужого рисующего вместо капсулы на каждом штрихе (п.6/39)
			cursorAt(m.by, m.pts[m.pts.length - 1], m.tool === 'laser', m.tool === 'laser' ? 900 : HAND_MS)
			break
		case 'end':
			draw(view(m))
			break
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
		if ((m.by !== myId() && !amMod()) || m.tool === 'laser' || m.tool === 'ping' || v.gone) {
			return
		}
		if (m.tool === 'text') {
			v.bb && inBox(v.bb, x, y, 12) && hit.push(m)
			return
		}
		const P = samples(m)
		const r = 20 + wid(m) / 2
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
	const s = show()
	// показ уже забыт (доску закрыли посреди штриха): без проверки — TypeError, и onBeforeUnmount не доходит до leave()
	if (cur?.m && s) {
		cur.m.tool === 'laser' ? strokeEnd(s, cur.m) : strokeCancel(s, cur.m)
	}
	cur = null
	erc.value?.classList.remove('on')
}

/**
 *
 * @param e
 */
function onTouch(e) {
	const ts = [...e.touches].filter((t) => tbox.contains(t.target))
	const all = [...e.touches]
	// touchstart самого штриха (все новые касания внутри .k4-ink) вторым пальцем не считаем: палец-держатель мог лежать вне показа до штриха
	const fresh = [...(e.changedTouches || [])].some((t) => !ink.value?.contains(t.target))
	if (e.type === 'touchstart' && ptr !== null && all.length > 1 && fresh && !all.some((t) => t.touchType === 'stylus')) {
		// второй палец мог встать на поле вокруг кадра или вообще за контейнер показа (.grid-main-wrapper):
		// до .k4-ink он не доходит, ловим на window в capture и отдаём жест зуму
		gest = true
		if (!ptrPen) {
			cancelCur()
			multi = true
		}
	} else if (!ts.length) {
		gest = false
	} else if (ts.length > 1 && !ts.some((t) => t.touchType === 'stylus')) {
		gest = true
		if (ptr !== null && !ptrPen) {
			cancelCur()
			multi = true
		}
	}
}

/**
 *
 * @param e
 */
function onDown(e) {
	if (e.pointerType === 'touch' && gest) {
		return
	}
	if (!state.mode && props.board && canDraw()) {
		state.mode = true // доска — сама поверхность для рисования: касание сразу рисует (п.49)
	}
	if (!state.mode || !W || !show() || !canDraw()) {
		return
	}
	const pen = e.pointerType === 'pen'
	if (pen) {
		penAt = performance.now()
	} else if (e.pointerType === 'touch' && (ptrPen || performance.now() - penAt < 1000)) {
		return // ладонь, пока рисуют пером
	}
	if (ptr !== null) {
		if (pen && !ptrPen) {
			// перо важнее пальца: палец (ладонь) отменяется, рисует перо
			cancelCur()
			ptr = null
		} else {
			// второй палец отменяет текущий штрих
			cancelCur()
			multi = true
			return
		}
	}
	ptr = e.pointerId
	ptrPen = pen
	multi = false
	try {
		ink.value.setPointerCapture(e.pointerId)
	} catch (_) { /* не критично */ }
	rect = surf.value.getBoundingClientRect()
	const p = nrm(e)
	t0 = performance.now()
	if (edit) {
		// тап мимо поля = фиксация
		finishEdit()
		ptr = null
		return
	}
	const own = ownText(p[0] * W, p[1] * H)
	if (state.tool === 'text' || (own && tap && t0 - tap < 450)) {
		cur = { txt: true, p, own }
		return
	}
	if (state.tool === 'eraser') {
		cur = { er: true }
		erc.value.classList.add('on')
		eraseAt(p)
		return
	}
	const g = state.tool === 'frame' && grabFrame(p[0] * W, p[1] * H)
	if (g) {
		cur = { mv: g.m, P: g.m.pts.map((q) => [...q]), corner: g.corner, o: p }
		return
	}
	cur = { m: strokeStart(show(), state.tool, p, force(e)), last: p }
}

/**
 * Нажим пера для маркеров (у пальца и мыши толщина постоянная).
 *
 * @param e PointerEvent
 */
function force(e) {
	return e.pointerType === 'pen' && (state.tool === 'marker' || state.tool === 'fade') ? (e.pressure > 0 ? e.pressure : 0.5) : undefined
}

/**
 * Своя рамка под точкой (инструмент «рамка»): за угол — новый размер, за край — перенос; внутри рисуется новая.
 *
 * @param x px внутри кадра
 * @param y px внутри кадра
 */
function grabFrame(x, y) {
	let r = null
	views.forEach((v) => {
		const m = v.m
		if (r || m.tool !== 'frame' || m.by !== myId() || !m.done || v.gone || m.pts.length < 2) {
			return
		}
		const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]].map((q) => [q[0] * W, q[1] * H])
		const corner = [a, b, [a[0], b[1]], [b[0], a[1]]].findIndex((c) => Math.hypot(c[0] - x, c[1] - y) < 14)
		const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
		const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
		const inX = x > x0 - 10 && x < x1 + 10
		const inY = y > y0 - 10 && y < y1 + 10
		const edge = inX && inY && (Math.abs(x - x0) < 10 || Math.abs(x - x1) < 10 || Math.abs(y - y0) < 10 || Math.abs(y - y1) < 10)
		if (corner >= 0 || edge) {
			r = { m, corner }
		}
	})
	return r
}

/**
 * Перетаскивание своей рамки: новые две точки по исходным и сдвигу.
 *
 * @param c текущее перетаскивание
 * @param p точка 0..1
 */
function dragFrame(c, p) {
	const [a, b] = [c.P[0], c.P[c.P.length - 1]]
	let P
	if (c.corner < 0) {
		const dx = Math.min(1 - Math.max(a[0], b[0]), Math.max(-Math.min(a[0], b[0]), p[0] - c.o[0]))
		const dy = Math.min(1 - Math.max(a[1], b[1]), Math.max(-Math.min(a[1], b[1]), p[1] - c.o[1]))
		P = [[a[0] + dx, a[1] + dy], [b[0] + dx, b[1] + dy]]
	} else {
		// противоположный угол стоит на месте
		const opp = [b, a, [b[0], a[1]], [a[0], b[1]]][c.corner]
		P = [opp, p]
	}
	moveMark(show(), c.mv, P)
}

/**
 *
 * @param e
 */
function onMove(e) {
	if (e.pointerType === 'pen') {
		penAt = performance.now()
	}
	if (!state.mode || !W || !show()) {
		return
	}
	if (ptr === null) {
		if (gest) {
			return
		}
		rect = surf.value.getBoundingClientRect()
		cursor(show(), nrm(e))
		return
	}
	if (e.pointerId !== ptr || !cur) {
		return
	}
	rect = surf.value.getBoundingClientRect() // зум колесом посреди штриха
	const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
	for (const ev of (evs.length ? evs : [e])) {
		const p = nrm(ev)
		if (cur.txt) {
			break
		}
		if (cur.mv) {
			dragFrame(cur, p)
			continue
		}
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
			strokePoint(show(), m, p, m.pr ? force(ev) : undefined)
			cur.last = p
		}
	}
	if (cur.m && ptrPen && (cur.m.tool === 'marker' || cur.m.tool === 'fade') && e.getPredictedEvents) {
		cur.m.pred = e.getPredictedEvents().map(nrm)
		cur.m.pred.length && later(view(cur.m))
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
	ptrPen = false
	const c = cur
	cur = null
	if (!c) {
		return
	}
	c.m && (c.m.pred = null)
	if (c.txt) {
		if (e.type !== 'pointercancel' && !multi) {
			openEdit(c.p, c.own)
		}
		return
	}
	if (c.er) {
		erc.value.classList.remove('on')
		return
	}
	if (c.mv) {
		return
	}
	const m = c.m
	if (!m) {
		return
	}
	const s = show()
	const quick = performance.now() - t0 < 400
	tap = quick ? performance.now() : 0
	const P = px(m)
	const len = P.reduce((a, p, i) => i ? a + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0, 0)
	// ket4tec (NAS_CLOUD#106 п.6): мигающая точка — только у указки, один инструмент: тап — точка, ведёшь — шлейф.
	// Тап — по пройденному пути, а не по числу точек: палец на iPhone дрожит и даёт несколько точек за касание.
	if (m.tool === 'laser') {
		if (len < 8 && !multi && e.type !== 'pointercancel') {
			strokeCancel(s, m)
			ping(s, c.last)
		} else {
			strokeEnd(s, m)
		}
		return
	}
	if (e.type === 'pointercancel' || multi || len < 8) {
		strokeCancel(s, m)
		return
	}
	strokeEnd(s, m)
}

const inBox = (b, x, y, g) => x > b[0] - g && x < b[0] + b[2] + g && y > b[1] - g && y < b[1] + b[3] + g
/**
 * Свой текст под точкой.
 *
 * @param x px внутри кадра
 * @param y px внутри кадра
 */
function ownText(x, y) {
	let r = null
	views.forEach((v) => {
		if (!r && v.m.tool === 'text' && v.m.by === myId() && !v.gone && v.bb && inBox(v.bb, x, y, 8)) {
			r = v
		}
	})
	return r
}

// ── поле ввода текста: у касания, шрифт >= 16 px (iOS не зумит), сцена поднимается над клавиатурой ──
/**
 * @param p точка касания 0..1
 * @param v view правимого текста или null
 */
function openEdit(p, v) {
	const c = v ? v.c : myColor()
	const box = document.createElement('div')
	box.className = 'k4-tedit'
	box.style.setProperty('--c', c)
	const inp = document.createElement('input')
	inp.type = 'text'
	inp.maxLength = 200
	inp.placeholder = 'Текст'
	inp.enterKeyHint = 'done'
	inp.autocomplete = 'off'
	inp.setAttribute('aria-label', 'Текст пометки')
	const hd = document.createElement('button')
	hd.type = 'button'
	hd.setAttribute('aria-label', 'Перетащить')
	const ic = mk('svg', { viewBox: '0 0 24 24' })
	ic.append(mk('path', { d: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3' }))
	hd.append(ic)
	const mir = document.createElement('span')
	mir.className = 'mir'
	box.append(inp, hd, mir)
	chips.value.append(box)
	const E = edit = { box, inp, v, x: 0, y: 0, drag: null, fit: fitEdit }
	if (v) {
		inp.value = v.m.text
		state.tsz = v.m.size
		E.x = v.bb[0]
		E.y = v.bb[1]
		v.g.style.opacity = 0
		v.chip && (v.chip.style.opacity = 0)
	}
	E.fit()
	if (!v) {
		E.x = p[0] * W - 8
		E.y = p[1] * H - box.offsetHeight / 2
		E.fit()
	}
	inp.addEventListener('input', E.fit)
	inp.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter') {
			ev.preventDefault()
			finishEdit()
		} else if (ev.key === 'Escape') {
			finishEdit(true)
		}
	})
	inp.addEventListener('blur', () => setTimeout(() => {
		edit === E && !E.drag && document.activeElement !== inp && finishEdit()
	}, 150))
	hd.addEventListener('pointerdown', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		// слой может быть под зумом: экранный сдвиг делим на масштаб
		E.drag = { x: ev.clientX, y: ev.clientY, ex: E.x, ey: E.y, s: props.transform?.scale || 1 }
		try {
			hd.setPointerCapture(ev.pointerId)
		} catch (_) { /* не критично */ }
	})
	hd.addEventListener('pointermove', (ev) => {
		if (E.drag) {
			E.x = E.drag.ex + (ev.clientX - E.drag.x) / E.drag.s
			E.y = E.drag.ey + (ev.clientY - E.drag.y) / E.drag.s
			E.fit()
		}
	})
	const dend = () => {
		if (E.drag) {
			E.drag = null
			inp.focus({ preventScroll: true })
			kbFit()
		}
	}
	hd.addEventListener('pointerup', dend)
	hd.addEventListener('pointercancel', dend)
	if (!reducedMotion()) {
		box.animate([{ opacity: 0, scale: '.85' }, { opacity: 1, scale: '1' }], { duration: 360, easing: SP.menu })
	}
	inp.focus({ preventScroll: true })
	setTimeout(kbFit, 320)
	setTimeout(kbFit, 700)
}

/** Подогнать размер и положение поля под текст, кегль и границы кадра. */
function fitEdit() {
	const E = edit
	if (!E) {
		return
	}
	const [fs, py] = SZ[state.tsz]
	E.box.style.setProperty('--fs', fs + 'px')
	E.box.style.setProperty('--py', py + 'px')
	E.box.querySelector('.mir').textContent = E.inp.value || E.inp.placeholder
	E.inp.style.width = Math.min(W - 60, E.box.querySelector('.mir').offsetWidth + 2) + 'px'
	const w = E.box.offsetWidth
	const h = E.box.offsetHeight
	E.x = Math.max(4, Math.min(W - w - 4, E.x))
	E.y = Math.max(4, Math.min(H - h - 4, E.y))
	E.box.style.transform = `translate(${f1(E.x)}px,${f1(E.y)}px)`
}

/**
 * @param {boolean} cancel не фиксировать
 */
function finishEdit(cancel = false) {
	const E = edit
	if (!E) {
		return
	}
	edit = null
	const bw = E.box.offsetWidth
	const bh = E.box.offsetHeight
	const x = Math.max(0, Math.min(W - bw, E.x)) / W // подгонка внутрь кадра по рамке автора, в нормированных координатах
	const y = Math.max(0, Math.min(H - bh, E.y)) / H
	const text = E.inp.value
	E.box.remove()
	kbReset()
	const v = E.v
	if (v) {
		v.g.style.opacity = ''
		v.chip && (v.chip.style.opacity = '')
	}
	const s = show()
	if (cancel || !s) {
		return
	}
	textPut(s, { id: v?.m.id, x, y, size: state.tsz, text })
}

/** Сцена (видео + слой) поднимается над клавиатурой: по visualViewport, как в прототипе. */
function kbFit() {
	const E = edit
	const vv = window.visualViewport
	const sc = root.value?.parentElement
	if (!E || !vv || !sc) {
		return
	}
	const d = E.box.getBoundingClientRect().bottom - (vv.offsetTop + vv.height - 14)
	if (d > 0 || kb) {
		kb = Math.max(0, kb + d)
		sc.style.transition = 'transform .28s ease-out'
		sc.style.transform = kb ? `translateY(${-Math.round(kb)}px)` : ''
	}
}
/** Опустить сцену обратно. */
function kbReset() {
	const sc = root.value?.parentElement
	if (sc && (kb || sc.style.transform)) {
		kb = 0
		sc.style.transform = ''
	}
}
let kb = 0

watch(() => state.tsz, fitEdit)
watch(() => state.mode, (on) => {
	if (!on) {
		finishEdit()
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
	window.visualViewport?.addEventListener('resize', kbFit)
	window.visualViewport?.addEventListener('scroll', kbFit)
	const i = ink.value
	i.addEventListener('pointerdown', onDown)
	i.addEventListener('pointermove', onMove)
	i.addEventListener('pointerup', onUp)
	i.addEventListener('pointercancel', onUp)
	tbox = root.value.parentElement
	window.addEventListener('touchstart', onTouch, { capture: true, passive: true })
	for (const t of ['touchend', 'touchcancel']) {
		tbox.addEventListener(t, onTouch, { capture: true, passive: true })
	}
	ro = new ResizeObserver(onVideo)
	ro.observe(root.value)
	props.video?.addEventListener('resize', onVideo)
	props.video?.addEventListener('loadedmetadata', onVideo)
	off = onDraw(onEvent)
	leave = join(props.presenter)
	rebuild()
})

onBeforeUnmount(() => {
	window.visualViewport?.removeEventListener('resize', kbFit)
	window.visualViewport?.removeEventListener('scroll', kbFit)
	window.removeEventListener('touchstart', onTouch, { capture: true })
	for (const t of ['touchend', 'touchcancel']) {
		tbox?.removeEventListener(t, onTouch, { capture: true })
	}
	finishEdit()
	cancelCur()
	cancelAnimationFrame(raf)
	cancelAnimationFrame(fr)
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
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	z-index: 3;
	path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.sh { stroke: #000; stroke-opacity: .28; }
	.laser line { stroke-linecap: butt; }
	.laser .tip { fill: #fff; }
	g { transition: opacity .22s ease-in; }
	g.out { opacity: 0; }
	g.fade { opacity: 0; transition: opacity .8s ease-in; }
	.ping .r { transform-box: fill-box; transform-origin: center; animation: k4-ping 1.1s ease-out 3; }
}
.k4-on .k4-ink, .k4-bd .k4-ink { pointer-events: auto; cursor: crosshair; }
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
.k4-tedit {
	position: absolute; left: 0; top: 0; display: flex; align-items: center; height: calc(var(--fs, 21px) * 1.25 + var(--py, 6px) * 2); border-radius: 999px; pointer-events: auto; z-index: 6;
	background: #141112ee; box-shadow: 0 0 0 2px var(--c), 0 6px 20px #0008;
	input { font: 700 max(16px, var(--fs, 21px)) / 1.25 var(--font-face, inherit); color: var(--c); background: none; border: 0; outline: 0; padding: 0 0 0 12px; min-width: 40px; max-width: none; margin: 0; height: 100%; box-shadow: none; }
	input::placeholder { color: #ffffff66; }
	button { flex: none; width: 34px; height: 34px; margin: 0 4px 0 2px; border: 0; border-radius: 50%; background: #ffffff1c; display: grid; place-items: center; touch-action: none; cursor: grab; padding: 0; }
	button svg { width: 18px; height: 18px; fill: none; stroke: #f3eee9; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.mir { position: absolute; visibility: hidden; white-space: pre; font: 700 max(16px, var(--fs, 21px)) / 1.25 var(--font-face, inherit); pointer-events: none; }
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
