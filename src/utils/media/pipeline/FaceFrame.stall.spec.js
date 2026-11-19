/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// NAS_CLOUD#160: постоянный сторож — выходной трек встал после публикации -> откат один раз; идёт -> без отката
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import FaceFrame, { FALLBACK_TEXT, setFaceFrameLevel } from './FaceFrame.js'

const showWarning = vi.hoisted(() => vi.fn())
const calllog = vi.hoisted(() => vi.fn())
vi.mock('@nextcloud/dialogs', () => ({ showWarning }))
vi.mock('@mediapipe/tasks-vision', () => ({}))
vi.mock('../../calllog.js', () => ({ calllog }))
vi.mock('../effects/virtual-background/VideoStreamBackgroundEffect.js', () => ({ getWasmFileset: () => new Promise(() => {}) }))

const mproto = window.HTMLMediaElement.prototype
const vproto = window.HTMLVideoElement.prototype
let ff
let probeTime

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
	probeTime = 0
	setFaceFrameLevel('auto', { persist: false })
	window.MediaStream = function(tracks = []) {
		this.getTracks = () => tracks
	}
	mproto.play = () => Promise.resolve()
	Object.defineProperty(mproto, 'currentTime', { configurable: true, get: () => probeTime })
	Object.defineProperty(vproto, 'videoWidth', { configurable: true, get: () => 640 })
	Object.defineProperty(vproto, 'videoHeight', { configurable: true, get: () => 360 })
	Object.defineProperty(vproto, 'readyState', { configurable: true, get: () => 4 })
	vi.spyOn(console, 'error').mockImplementation(() => {})
	showWarning.mockClear()
	calllog.mockClear()
	const out = { stop() {}, addEventListener() {}, removeEventListener() {} }
	window.HTMLCanvasElement.prototype.captureStream = () => ({ getVideoTracks: () => [out] })
	window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: [255, 255, 255, 255] }) })
	ff = new FaceFrame()
	ff._setInputTrack('default', { id: 'cam', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} })
})

afterEach(() => {
	ff?.destroy()
	delete mproto.currentTime
	delete vproto.videoWidth
	delete vproto.videoHeight
	delete vproto.readyState
	vi.useRealTimers()
	vi.restoreAllMocks()
})

const stallCalls = () => calllog.mock.calls.filter(([k, d]) => k === 'framing_error' && /встал/.test(d.reason))

describe('FaceFrame: сторож выхода', () => {
	test('кадры перестали идти -> откат один раз, причина в журнале', async () => {
		await vi.advanceTimersByTimeAsync(2500)
		expect(ff._digital.published).toBe(true)
		await vi.advanceTimersByTimeAsync(5000)
		expect(ff.path).toBe('fallback')
		expect(stallCalls()).toHaveLength(1)
		expect(stallCalls()[0][1].reason).toMatch(/^выходной трек встал через \d+ с$/)
		expect(showWarning).toHaveBeenCalledTimes(1)
		expect(showWarning).toHaveBeenCalledWith(FALLBACK_TEXT.output)
		await vi.advanceTimersByTimeAsync(5000)
		expect(stallCalls()).toHaveLength(1)
	})

	test('кадры идут -> отката нет', async () => {
		for (let i = 0; i < 20; i++) {
			probeTime += 0.5
			await vi.advanceTimersByTimeAsync(500)
		}
		expect(ff._digital.published).toBe(true)
		expect(ff.path).toBe('digital')
		expect(stallCalls()).toHaveLength(0)
	})
})
