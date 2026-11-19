/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { expect, test } from 'vitest'
import FaceFrame, { holdZoom, TILES } from './FaceFrame.js'

// NAS_CLOUD#160: iPad, сверхширокая камера 1920x1080, лицо мелкое. Прогон настоящего _renderFrame,
// детекции из сценария: size(t) — ширина рамки (доля ширины кадра), jit — дрожание размера, miss — пропуск замеров.
function run({ size, jit = 0.15, miss = (n) => n % 3 === 2, tileK = 1, secs = 20, seed = 3, extra = null }) {
	let r = seed
	const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
	const ff = new FaceFrame()
	const W = 1920
	const H = 1080
	let t = 0
	let n = 0
	ff._detectBoxes = (d, src) => {
		if (miss(n++)) {
			return []
		}
		const w = size(t / 1000) * (1 + rnd() * jit)
		const h = w * W / H * 1.15
		if (src === d.tileCanvas) { // рамка в долях плитки: после tileToFrame — ширина w * tileK, центр по x 0.5, верх 0.4
			const tl = TILES[d.tileIdx % TILES.length]
			const wt = w * tileK
			return [{ x: (0.5 - tl.x) / tl.w - wt / tl.w / 2, y: (0.4 - tl.y) / tl.h, w: wt / tl.w, h: h / tl.h }]
		}
		return [{ x: 0.5 - w / 2, y: 0.4, w, h }, ...(extra?.(t) ? [extra(t)] : [])]
	}
	const d = {
		video: { videoWidth: W, videoHeight: H },
		canvas: { width: H, height: H },
		ctx: { drawImage() {} },
		win: { cx: 0.5, cy: 0.5, zoom: 1 },
		target: { cx: 0.5, cy: 0.5, zoom: 1 },
		lastFace: 0,
		placed: false,
		tileIdx: 0,
		noFace: true,
		nextDetectAt: 0,
		nextTileAt: 0,
		lastTick: 0,
		detector: {},
		startedAt: 0,
		frames: 0,
		published: true,
		durs: [],
		tileCanvas: { getContext: () => ({ drawImage() {} }) },
		fullCanvas: { getContext: () => ({ drawImage() {} }) },
		detCount: 0,
		fpsT: 0,
		fpsFrames: 0,
		frozen: false,
	}
	const zoom = []
	for (t = 1; t < secs * 1000; t += 1000 / 30) {
		ff._renderFrame(d, t)
		zoom.push({ t, z: d.win.zoom, cx: d.win.cx })
	}
	ff.destroy()
	return { zoom, d }
}

// число смен направления масштаба (размах > 1% от последней крайней точки) и размах после t0
function flips(zoom, t0, t1) {
	const a = zoom.filter((p) => p.t >= t0 && p.t < t1).map((p) => p.z)
	let n = 0
	let dir = 0
	let ext = a[0]
	for (const z of a) {
		if (dir >= 0 && z < ext * 0.99) {
			n += dir === 1 ? 1 : 0
			dir = -1
			ext = z
		} else if (dir <= 0 && z > ext * 1.01) {
			n += dir === -1 ? 1 : 0
			dir = 1
			ext = z
		} else if ((dir >= 0 && z > ext) || (dir <= 0 && z < ext)) {
			ext = z
		}
	}
	return { n, span: (Math.max(...a) - Math.min(...a)) / Math.min(...a) }
}

test('мелкое лицо, дрожание рамки +-15%, пропуск каждого 3-го замера — масштаб не дышит', () => {
	for (const w of [0.05, 0.09, 0.11, 0.12, 0.14]) {
		for (const seed of [3, 11]) {
			const { zoom } = run({ size: () => w, seed })
			const f = flips(zoom, 5000, 15000)
			expect(f.n).toBeLessThanOrEqual(1)
			expect(f.span).toBeLessThan(0.05)
		}
	}
})

test('рамка из плиток крупнее на 25% чем из полного кадра, лицо то находится то нет — масштаб не дышит', () => {
	const { zoom } = run({ size: () => 0.12, tileK: 1.25, miss: (n) => n % 4 === 1 || n % 4 === 2 })
	const f = flips(zoom, 5000, 15000)
	expect(f.n).toBeLessThanOrEqual(1)
	expect(f.span).toBeLessThan(0.05)
})

test('человек подошёл (лицо x1.5 с 8-й секунды) — масштаб меняется за 1,5 с', () => {
	const size = (s) => (s < 8 ? 0.09 : 0.135)
	const { zoom } = run({ size, jit: 0.05, miss: () => false })
	const z0 = zoom.find((p) => p.t > 7900).z
	const z1 = zoom.find((p) => p.t > 8000 + 1500).z
	expect(Math.abs(z1 / z0 - 1)).toBeGreaterThan(0.1)
})

test('детектор молчит 5 с — окно держится, в общий план не уходит', () => {
	const { zoom } = run({ size: () => 0.09, jit: 0.05, miss: (n) => n > 40 && n < 100, secs: 20 })
	const before = zoom.find((p) => p.t > 4000).z
	const after = zoom[zoom.length - 1].z
	expect(Math.abs(after / before - 1)).toBeLessThan(0.05)
	const mid = zoom.find((p) => p.t > 8000).z // середина молчания (замеры 41..99 ~ 5.5..13 с)
	expect(Math.abs(mid / before - 1)).toBeLessThan(0.05)
})

// левая/правая граница окна в долях ширины кадра (кадр 1920x1080, окно квадрат H/zoom)
function edges(p) {
	const half = 0.5625 / p.z / 2
	const cx = Math.min(1 - half, Math.max(half, p.cx))
	return [cx - half, cx + half]
}

test('мигающая вторая рамка (люстра, 400 мс вкл/выкл): настоящее лицо целиком в окне, центр не гуляет', () => {
	const extra = (t) => (Math.floor(t / 400) % 2 === 0 ? { x: 0.85, y: 0.3, w: 0.1, h: 0.1 * 1920 / 1080 * 1.15 } : null)
	const { zoom } = run({ size: () => 0.1, jit: 0.05, miss: () => false, extra, secs: 20 })
	const tail = zoom.filter((p) => p.t > 3000)
	let minMargin = 1
	for (const p of tail) {
		const [l, r] = edges(p)
		minMargin = Math.min(minMargin, 0.35 - l, r - 0.45)
	}
	const cxs = tail.map((p) => p.cx)
	const drift = Math.max(...cxs) - Math.min(...cxs)
	expect(minMargin).toBeGreaterThan(0)
	expect(drift).toBeLessThanOrEqual(0.02)
})

test('смена «Дальности» сбрасывает удержание масштаба', () => {
	const d = {}
	const z0 = holdZoom(d, 1.5, 0, 0.5)
	expect(z0).toBe(1.5)
	expect(holdZoom(d, 1.5 * 1.1, 100, 0.5)).toBe(1.5) // дрожание внутри окна допуска — держим
	expect(holdZoom(d, 1.79, 200, 0.6)).toBe(1.79) // другой range — цель сразу
	expect(holdZoom(d, 1, 300, 0)).toBe(1) // range=0 — без задержки 500 мс
})
