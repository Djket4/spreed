/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, expect, test, vi } from 'vitest'
import { FADE_MS, hasPicture, useK4VideoFade } from './k4fade.js'

vi.mock('vue', async (orig) => ({ ...(await orig()), onBeforeUnmount: () => {} }))

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

test('NAS_CLOUD#271: быстрые выкл/вкл (2 цикла) не оставляют снимок поверх живого видео', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	vi.spyOn(vproto, 'readyState', 'get').mockReturnValue(4)
	vproto.play = () => Promise.resolve()
	vproto.pause = () => {}
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Array(256).fill(200) }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	// снимок — постоянный канвас за видео, виден только на угасании
	const snaps = () => [...box.querySelectorAll('.k4-vsnap')].filter((e) => e.style.opacity === '1').length

	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	expect(fade.state.full).toBe(true)
	for (let i = 0; i < 2; i++) {
		fade.set(false, get)
		expect(snaps()).toBe(1) // гаснет снимок последнего кадра
		await vi.advanceTimersByTimeAsync(300) // переход прерван до конца фейда
		fade.set(true, get)
		expect(snaps()).toBe(0)
		await vi.advanceTimersByTimeAsync(FADE_MS + 100)
		expect(snaps()).toBe(0)
		expect(fade.state.opaque).toBe(true)
	}
	fade.set(false, get)
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	expect(snaps()).toBe(0)
	expect(fade.state.shown).toBe(false)
})

test('NAS_CLOUD#271: кадр поменьше посередине прозрачного поля (первые кадры iOS) — не целый, чёрный — тоже', () => {
	const px = (lit) => {
		const d = new Array(256).fill(0)
		for (let y = 0; y < 8; y++) {
			for (let x = 0; x < 8; x++) {
				if (lit(x, y)) {
					d.fill(200, (y * 8 + x) * 4, (y * 8 + x) * 4 + 3)
				}
			}
		}
		return d
	}
	const check = (data) => {
		vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data }) })
		return hasPicture(document.createElement('video'))
	}
	expect(check(px(() => true))).toBe(true)
	expect(check(px((x, y) => x >= 2 && x <= 5 && y >= 2 && y <= 5))).toBe(false)
	expect(check(px(() => false))).toBe(false)
	// тёмный фон, но лицо посередине и светлые места у каждого края — целый кадр
	expect(check(px((x, y) => (x > 2 && x < 5) || y === 3))).toBe(true)
	// NAS_CLOUD#279 п.4: тёмная комната — края почти чёрные, но непрозрачные, лицо посередине — целый кадр
	const dark = new Array(256).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 5))
	;[[3, 3], [4, 4]].forEach(([x, y]) => dark.fill(90, (y * 8 + x) * 4, (y * 8 + x) * 4 + 3))
	expect(check(dark)).toBe(true)
	// а тот же кадр с прозрачным полем вокруг — нет
	expect(check(dark.map((c, i) => (i % 4 === 3 ? 0 : c)))).toBe(false)
})

test('NAS_CLOUD#271: повторный выкл (сигнал «скоро выкл», затем сам выкл) не начинает угасание заново; видео под снимком скрыто', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	vi.spyOn(vproto, 'readyState', 'get').mockReturnValue(4)
	vproto.play = () => Promise.resolve()
	vproto.pause = () => {}
	const draws = []
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => draws.push(1), getImageData: () => ({ data: new Array(256).fill(200) }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	// копия кадра обновляется, пока камера показана (без rVFC — раз в 300 мс)
	const n = draws.length
	await vi.advanceTimersByTimeAsync(700)
	expect(draws.length).toBeGreaterThan(n)

	fade.set(false, get)
	expect(v.style.visibility).toBe('hidden')
	const snap = box.querySelector('.k4-vsnap')
	expect(snap.style.opacity).toBe('1')
	const frozen = draws.length
	await vi.advanceTimersByTimeAsync(600)
	fade.set(false, get) // сам выкл через 0,6 с после сигнала
	expect(draws.length).toBe(frozen) // снимок не переснят с выключенного трека
	await vi.advanceTimersByTimeAsync(FADE_MS - 600 + 50)
	expect(fade.state.shown).toBe(false) // угасание кончилось через 1 с от первого сигнала
	expect(snap.style.opacity).toBe('0')
	expect(v.style.visibility).toBe('')
})

test('NAS_CLOUD#279 п.3: rVFC не стреляет — плитка проявляется по ходу currentTime, а не через 5 с', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	vi.spyOn(vproto, 'readyState', 'get').mockReturnValue(4)
	let ct = 0
	vi.spyOn(vproto, 'currentTime', 'get').mockImplementation(() => ct)
	vproto.play = () => Promise.resolve()
	vproto.requestVideoFrameCallback = () => 0 // молчит
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Array(256).fill(200) }) })
	const v = document.createElement('video')
	document.createElement('div').append(v)
	const fade = useK4VideoFade()
	fade.set(true, () => v)
	await vi.advanceTimersByTimeAsync(200)
	expect(fade.state.opaque).toBe(false) // время стоит — кадр старый
	ct = 0.1
	await vi.advanceTimersByTimeAsync(100)
	expect(fade.state.opaque).toBe(true)
	delete vproto.requestVideoFrameCallback
})
