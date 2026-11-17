/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, expect, test, vi } from 'vitest'
import { LocalMediaModel } from './LocalMediaModel.js'

afterEach(() => {
	vi.useRealTimers()
})

const setup = () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
	const m = new LocalMediaModel()
	m._webRtc = { pauseVideo: vi.fn(), resumeVideo: vi.fn(), emit: vi.fn() }
	return m
}

test('NAS_CLOUD#271: выкл камеры — сначала k4videoLeaving (плитка гаснет), трек выключается после отрисовки', () => {
	const m = setup()
	m.disableVideo()
	expect(m.get('k4videoLeaving')).toBe(true)
	expect(m._webRtc.emit).toHaveBeenCalledWith('videoOff') // собеседники гаснут до чёрных кадров
	expect(m._webRtc.pauseVideo).not.toHaveBeenCalled()
	vi.advanceTimersToNextFrame()
	vi.advanceTimersToNextFrame()
	expect(m._webRtc.pauseVideo).toHaveBeenCalledTimes(1)
	expect(m.get('k4videoLeaving')).toBe(false)
	vi.advanceTimersByTime(200) // запасной таймер второй раз не выключает
	expect(m._webRtc.pauseVideo).toHaveBeenCalledTimes(1)
})

test('NAS_CLOUD#271: фоновая вкладка без отрисовки — трек всё равно выключается за 150 мс', () => {
	const m = setup()
	m.disableVideo()
	vi.advanceTimersByTime(150)
	expect(m._webRtc.pauseVideo).toHaveBeenCalledTimes(1)
})

test('NAS_CLOUD#271: вкл до того, как выкл дошло до трека, — выкл отменяется', () => {
	const m = setup()
	m.disableVideo()
	m.enableVideo()
	expect(m.get('k4videoLeaving')).toBe(false)
	vi.advanceTimersByTime(200)
	vi.advanceTimersToNextFrame()
	expect(m._webRtc.pauseVideo).not.toHaveBeenCalled()
	expect(m._webRtc.resumeVideo).toHaveBeenCalledTimes(1)
})
