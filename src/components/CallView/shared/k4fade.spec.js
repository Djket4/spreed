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
})
