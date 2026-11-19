/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// NAS_CLOUD#160: детекция по маленькому канвасу, порог «мало кадров» от входа, сброс защёлки на новом запуске
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import FaceFrame, { setFaceFrameLevel } from './FaceFrame.js'

const showWarning = vi.hoisted(() => vi.fn())
const calllog = vi.hoisted(() => vi.fn())
vi.mock('@nextcloud/dialogs', () => ({ showWarning }))
vi.mock('@mediapipe/tasks-vision', () => ({}))
vi.mock('../../calllog.js', () => ({ calllog }))
vi.mock('../effects/virtual-background/VideoStreamBackgroundEffect.js', () => ({ getWasmFileset: () => new Promise(() => {}) }))

const vproto = window.HTMLVideoElement.prototype
const mkTrack = (id) => ({ id, kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} })
let ff
let vw
let vh

function start() {
	const out = { stop() {}, addEventListener() {}, removeEventListener() {} }
	window.HTMLCanvasElement.prototype.captureStream = () => ({ getVideoTracks: () => [out] })
	window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: [255, 255, 255, 255] }) })
	ff = new FaceFrame('call')
	const track = mkTrack('cam')
	ff._setInputTrack('default', track)
	return track
}

// камера даёт inFps, колбэки кадра (rVFC) идут с частотой drawFps
function setRates(inFps, drawFps) {
	vproto.getVideoPlaybackQuality = () => ({ totalVideoFrames: Math.floor(performance.now() / 1000 * inFps) })
	vproto.requestVideoFrameCallback = (cb) => setTimeout(() => cb(performance.now(), {}), 1000 / drawFps)
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
	vw = 1920
	vh = 1080
	setFaceFrameLevel('auto', { persist: false })
	window.MediaStream = function(tracks = []) {
		this.getTracks = () => tracks
	}
	window.HTMLMediaElement.prototype.play = () => Promise.resolve()
	Object.defineProperty(vproto, 'videoWidth', { configurable: true, get: () => vw })
	Object.defineProperty(vproto, 'videoHeight', { configurable: true, get: () => vh })
	Object.defineProperty(vproto, 'readyState', { configurable: true, get: () => 4 })
	vi.spyOn(console, 'error').mockImplementation(() => {})
	showWarning.mockClear()
	calllog.mockClear()
})

afterEach(() => {
	ff?.destroy()
	for (const k of ['videoWidth', 'videoHeight', 'readyState', 'getVideoPlaybackQuality', 'requestVideoFrameCallback']) {
		delete vproto[k]
	}
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('FaceFrame: канвас детекции', () => {
	test('1080p: в детектор уходит канвас <= 480 px, рамка плитки пересчитана в систему кадра', async () => {
		setRates(30, 30)
		start()
		const seen = []
		// полный кадр лиц не показывает; в плитке лицо в центре плитки (канвас 480x270)
		ff._digital.detector = {
			detectForVideo(src) {
				seen.push(src)
				if (src.width === 480) {
					return { detections: [{ boundingBox: { originX: 240, originY: 135, width: 48, height: 27 } }] }
				}
				return { detections: [] }
			},
		}
		await vi.advanceTimersByTimeAsync(4000)
		expect(seen.length).toBeGreaterThan(2)
		expect(seen.every((c) => Math.max(c.width, c.height) <= 480)).toBe(true)
		expect(seen.some((c) => c.width === 320 && c.height === 180)).toBe(true)
		expect(new Set(seen).size).toBe(2) // канвас полного кадра и канвас плитки, а не новый на каждый вызов
		// плитка 0: x .25..0.75; рамка в плитке (.5,.5,.1,.1) -> кадр (.5,.5,.05,.05) -> центр по x = .525
		expect(ff._digital.target.cx).toBeCloseTo(0.525, 3)
	})
})

describe('FaceFrame: порог «мало кадров» от входа', () => {
	test('камера 12 к/с, отрисовка 12 к/с -> не сбой', async () => {
		setRates(12, 12)
		start()
		await vi.advanceTimersByTimeAsync(9000)
		expect(ff.path).toBe('digital')
		expect(calllog.mock.calls.filter(([k]) => k === 'framing_error')).toHaveLength(0)
	})
	test('камера 30 к/с, отрисовка 12 к/с -> сбой lowFps, остаёмся на канвасе', async () => {
		setRates(30, 12)
		start()
		await vi.advanceTimersByTimeAsync(9000)
		expect(ff.path).toBe('frozen')
		const err = calllog.mock.calls.find(([k]) => k === 'framing_error')
		expect(err[1]).toMatchObject({ inst: 'call', kind: 'lowFps' })
		expect(err[1].in_fps).toBeGreaterThan(25)
	})
})

describe('FaceFrame: без счётчика входа — прежний порог 15 к/с', () => {
	const rvfcOnly = (drawFps) => {
		vproto.requestVideoFrameCallback = (cb) => setTimeout(() => cb(performance.now(), {}), 1000 / drawFps)
		// счётчик кадров у пробы нужен сторожу выхода, у исходного video его нет
		vproto.getVideoPlaybackQuality = function() {
			return this.srcObject ? undefined : { totalVideoFrames: Math.floor(performance.now() / 33) }
		}
	}
	test('отрисовка 18 к/с -> не сбой', async () => {
		rvfcOnly(18)
		start()
		await vi.advanceTimersByTimeAsync(9000)
		expect(ff.path).toBe('digital')
	})
	test('отрисовка 12 к/с -> сбой, in_fps: null', async () => {
		rvfcOnly(12)
		start()
		await vi.advanceTimersByTimeAsync(9000)
		expect(ff.path).toBe('frozen')
		const err = calllog.mock.calls.find(([k]) => k === 'framing_error')
		expect(err[1]).toMatchObject({ inst: 'call', kind: 'lowFps', in_fps: null })
	})
})

describe('FaceFrame: форма событий журнала', () => {
	test('framing_start и framing_stats', async () => {
		setRates(30, 30)
		start()
		await vi.advanceTimersByTimeAsync(11000)
		const get = (k) => calllog.mock.calls.find(([n]) => n === k)[1]
		expect(Object.keys(get('framing_start')).sort()).toEqual(['frozen', 'h', 'in_fps_cfg', 'inst', 'sched', 'w'])
		expect(get('framing_start')).toMatchObject({ inst: 'call', sched: 'rvfc', frozen: false })
		const st = get('framing_stats')
		expect(Object.keys(st).sort()).toEqual(['detAvg', 'detP95', 'draw_fps', 'gapMax', 'hidden', 'in_fps', 'inst', 'out_fps'])
		expect(st).toMatchObject({ inst: 'call', hidden: false })
		expect(st.in_fps).toBeGreaterThan(25)
	})
})

describe('FaceFrame: защёлка', () => {
	test('новый трек и выкл→вкл камеры сбрасывают защёлку', async () => {
		start()
		await vi.advanceTimersByTimeAsync(600)
		ff._fallback(ff._digital, 'lowFps', 'x')
		expect(ff.path).toBe('frozen')
		expect(ff._frozen).toBe('lowFps')
		ff._setInputTrack('default', mkTrack('cam2'))
		await vi.advanceTimersByTimeAsync(10)
		expect(ff._frozen).toBe(null)
		expect(ff._digital.frozen).toBe(false)
		expect(ff.path).toBe('digital')
		ff._fallback(ff._digital, 'lowFps', 'x')
		expect(ff._frozen).toBe('lowFps')
		ff._handleInputTrackEnabled('default', false)
		ff._handleInputTrackEnabled('default', true)
		expect(ff._digital.frozen).toBe(false)
		expect(ff.path).toBe('digital')
		expect(calllog.mock.calls.filter(([k]) => k === 'framing_mode').map(([, d]) => d.mode)).toEqual(['digital', 'frozen', 'digital', 'frozen', 'off', 'digital'])
	})
})
