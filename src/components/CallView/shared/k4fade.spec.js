/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, expect, test, vi } from 'vitest'
import { FADE_MS, useK4VideoFade } from './k4fade.js'

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
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: [200, 200, 200, 255] }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	const snaps = () => box.querySelectorAll('.k4-vsnap').length

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
