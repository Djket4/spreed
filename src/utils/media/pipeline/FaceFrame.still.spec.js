/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { expect, test } from 'vitest'
import FaceFrame from './FaceFrame.js'

// NAS_CLOUD#271: лицо неподвижно, детектор шумит (±1% положения, ±3% размера), часть детекций пустые,
// лицо пропадает на 2,5 с (рука, контровой свет). Окно кадра (сторона квадрата и центр) гуляет не больше 2%.
// Прогон настоящего _renderFrame: 20 с по 30 кадров, детекции из сценария вместо MediaPipe.
function run(seed) {
	let r = seed
	const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
	const ff = new FaceFrame()
	const W = 720
	const H = 1280
	let t = 0
	const lost = (s) => (s > 6 && s < 8.5) || rnd() < -0.7 // ~15% пустых детекций
	// поиск по плиткам (когда лица нет) тоже ничего не находит
	ff._detectBoxes = (d, src) => src === d.tileCanvas || lost(t / 1000)
		? []
		: [{ x: 0.36 + rnd() * 0.01, y: 0.32 + rnd() * 0.01, w: 0.28 * (1 + rnd() * 0.03), h: 0.16 * (1 + rnd() * 0.03) }]
	const d = {
		video: { videoWidth: W, videoHeight: H },
		canvas: { width: W, height: W },
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
		detCount: 0,
		fpsT: 0,
		fpsFrames: 0,
		frozen: false,
	}
	const side = []
	const cx = []
	const cy = []
	for (t = 1; t < 20000; t += 1000 / 30) {
		ff._renderFrame(d, t)
		if (t > 4000) { // окно уже встало
			side.push(1 / d.win.zoom)
			cx.push(d.win.cx)
			cy.push(d.win.cy)
		}
	}
	ff.destroy()
	const spread = (a) => (Math.max(...a) - Math.min(...a))
	return { side: spread(side) / Math.min(...side), cx: spread(cx), cy: spread(cy), zoom: d.win.zoom }
}

test('NAS_CLOUD#271: неподвижное лицо — окно кадра стоит (±2%), потеря лица на 2,5 с не уводит в общий план', () => {
	for (const seed of [1, 7, 42]) {
		const s = run(seed)
		expect(s.zoom).toBeGreaterThan(1.3) // приближение к лицу есть
		expect(s.side).toBeLessThan(0.02)
		expect(s.cx).toBeLessThan(0.02)
		expect(s.cy).toBeLessThan(0.02)
	}
})
