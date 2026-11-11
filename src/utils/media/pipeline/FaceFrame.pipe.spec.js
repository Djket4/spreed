/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, describe, expect, test, vi } from 'vitest'
import FaceFrame, { getFaceFrameLevel, setFaceFrameLevel } from './FaceFrame.js'
import TrackToStream from './TrackToStream.js'

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
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
})
