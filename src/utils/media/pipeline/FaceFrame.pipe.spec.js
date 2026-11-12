/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, describe, expect, test, vi } from 'vitest'
import FaceFrame, { getFaceFrameLevel, setFaceFrameLevel } from './FaceFrame.js'
import TrackToStream from './TrackToStream.js'

const showWarning = vi.hoisted(() => vi.fn())
vi.mock('@nextcloud/dialogs', () => ({ showWarning }))
vi.mock('@mediapipe/tasks-vision', () => ({}))
vi.mock('../effects/virtual-background/VideoStreamBackgroundEffect.js', () => ({ getWasmFileset: () => new Promise(() => {}) }))

describe('FaceFrame в цепочке превью', () => {
	beforeAll(() => {
		window.MediaStream = function() {
			this._tracks = []
			this.addTrack = (t) => this._tracks.push(t)
			this.removeTrack = (t) => this._tracks.splice(this._tracks.indexOf(t), 1)
			this.getTracks = () => this._tracks
		}
	})
	test('«Выкл»: поток в TrackToStream появляется сразу после установки трека', () => {
		setFaceFrameLevel('off')
		const ff = new FaceFrame()
		const tts = new TrackToStream()
		tts.addInputTrackSlot('video')
		ff.connectTrackSink('default', tts, 'video')
		const track = { id: 'v', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
		ff._setInputTrack('default', track)
		expect(ff.getOutputTrack()).toBe(track)
		expect(tts.getStream()?.getTracks()).toEqual([track])
		ff.destroy() // иначе узел реагирует на смену уровня в следующем тесте
	})
	test('кадр «Выкл»: выключение камеры доходит до получателей (кнопка камеры переключается)', () => {
		setFaceFrameLevel('off')
		const ff = new FaceFrame()
		const seen = []
		ff.on('outputTrackEnabled', (source, trackId, enabled) => seen.push(enabled))
		const track = { id: 'v3', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
		ff._setInputTrack('default', track)
		ff._handleInputTrackEnabled('default', false)
		ff._handleInputTrackEnabled('default', true)
		expect(seen).toEqual([false, true])
		ff.destroy()
	})
	test('страховка: канвас без кадров -> через 2 с на выходе исходный трек', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
		window.MediaStream = function(tracks = []) {
			this._tracks = [...tracks]
			this.getTracks = () => this._tracks
		}
		window.HTMLMediaElement.prototype.play = () => Promise.resolve()
		const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
		const ff = new FaceFrame()
		const track = { id: 'v2', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
		setFaceFrameLevel('auto')
		ff._setInputTrack('default', track)
		return vi.advanceTimersByTimeAsync(100).then(() => {
			expect(ff.path).toBe('digital')
			return vi.advanceTimersByTimeAsync(2600)
		}).then(() => {
			expect(ff.path).toBe('fallback')
			expect(ff.getOutputTrack()).toBe(track)
			expect(getFaceFrameLevel()).toBe('off')
			expect(warn).toHaveBeenCalled()
			expect(document.querySelector('video')).toBeNull()
			vi.useRealTimers()
		})
	})
	test('защита: конвейер упал при запуске -> исходный трек, «Выкл», сообщение', () => {
		window.MediaStream = function() {
			throw new Error('не поддерживается')
		}
		const err = vi.spyOn(console, 'error').mockImplementation(() => {})
		showWarning.mockClear()
		const ff = new FaceFrame()
		const track = { id: 'v4', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
		setFaceFrameLevel('auto')
		ff._setInputTrack('default', track)
		return Promise.resolve().then(() => {
			expect(ff.getOutputTrack()).toBe(track)
			expect(getFaceFrameLevel()).toBe('off')
			expect(err).toHaveBeenCalled()
			expect(showWarning).toHaveBeenCalledTimes(1)
		})
	})
	test('защита: канвас рисует, а выходной трек пуст (проба без кадров) -> откат за 3 с', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
		window.MediaStream = function(tracks = []) {
			this.getTracks = () => tracks
		}
		const out = { stop() {}, addEventListener() {}, removeEventListener() {} }
		const proto = window.HTMLCanvasElement.prototype
		proto.captureStream = () => ({ getVideoTracks: () => [out] })
		proto.getContext = () => ({ drawImage() {} })
		const vw = Object.getOwnPropertyDescriptor(window.HTMLVideoElement.prototype, 'videoWidth')
		Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', {
			configurable: true,
			get() {
				return this.srcObject?.getTracks()[0] === out ? 0 : 640
			},
		})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		showWarning.mockClear()
		setFaceFrameLevel('auto')
		const ff = new FaceFrame()
		const track = { id: 'v5', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
		ff._setInputTrack('default', track)
		return vi.advanceTimersByTimeAsync(3000).then(() => {
			expect(ff.getOutputTrack()).toBe(track)
			expect(getFaceFrameLevel()).toBe('off')
			expect(showWarning).toHaveBeenCalledTimes(1)
			if (vw) {
				Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', vw)
			}
			vi.useRealTimers()
		})
	})
	// проба готова: у <video> на выходном треке есть кадр
	const setup = (out, probeReady) => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
		window.MediaStream = function(tracks = []) {
			this.getTracks = () => tracks
		}
		const proto = window.HTMLCanvasElement.prototype
		proto.captureStream = () => ({ getVideoTracks: () => [out] })
		proto.getContext = () => ({ drawImage() {} })
		const isProbe = (el) => el.srcObject?.getTracks()[0] === out
		const vproto = window.HTMLVideoElement.prototype
		const vw = Object.getOwnPropertyDescriptor(vproto, 'videoWidth')
		const rs = Object.getOwnPropertyDescriptor(vproto, 'readyState')
		Object.defineProperty(vproto, 'videoWidth', { configurable: true, get() { return isProbe(this) && !probeReady ? 0 : 640 } })
		Object.defineProperty(vproto, 'readyState', { configurable: true, get() { return isProbe(this) && !probeReady ? 0 : 4 } })
		vi.spyOn(console, 'error').mockImplementation(() => {})
		showWarning.mockClear()
		setFaceFrameLevel('auto')
		const ff = new FaceFrame()
		const track = { id: 'vp', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
		ff._setInputTrack('default', track)
		const restore = () => {
			for (const [k, dsc] of [['videoWidth', vw], ['readyState', rs]]) {
				if (dsc) {
					Object.defineProperty(vproto, k, dsc)
				} else {
					delete vproto[k]
				}
			}
			vi.useRealTimers()
		}
		return { ff, track, restore }
	}

	test('проба создаётся вместе с выходом, после готовности выход публикуется', async () => {
		const out = { stop() {}, addEventListener() {}, removeEventListener() {} }
		const { ff, restore } = setup(out, true)
		try {
			await vi.advanceTimersByTimeAsync(1500)
			const probe = ff._digital.probe
			expect(probe.srcObject.getTracks()[0]).toBe(out)
			expect(document.body.contains(probe)).toBe(true)
			expect(ff.getOutputTrack()).toBe(out)
			expect(showWarning).not.toHaveBeenCalled()
			ff.destroy()
			expect(document.body.contains(probe)).toBe(false)
		} finally {
			restore()
		}
	})
	test('проба не готова -> откат по таймауту, сообщение про выходной трек, пробы в DOM нет', async () => {
		const out = { stop() {}, addEventListener() {}, removeEventListener() {} }
		const { ff, track, restore } = setup(out, false)
		let probe
		try {
			await vi.advanceTimersByTimeAsync(500)
			probe = ff._digital.probe
			expect(document.body.contains(probe)).toBe(true)
			await vi.advanceTimersByTimeAsync(2500)
			expect(ff.getOutputTrack()).toBe(track)
			expect(console.error.mock.calls.some((c) => String(c[1]).includes('выходной трек не отдаёт кадры'))).toBe(true)
			expect(document.body.contains(probe)).toBe(false)
		} finally {
			restore()
		}
	})
})
