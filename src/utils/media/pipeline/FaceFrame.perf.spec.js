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
	for (const k of ['videoWidth', 'videoHeight', 'readyState', 'getVideoPlaybackQuality', 'requestVideoFrameCallback', 'paused']) {
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
		expect(err[1].infps).toBeGreaterThan(25)
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
	test('отрисовка 12 к/с -> сбой, infps не отправляется', async () => {
		rvfcOnly(12)
		start()
		await vi.advanceTimersByTimeAsync(9000)
		expect(ff.path).toBe('frozen')
		const err = calllog.mock.calls.find(([k]) => k === 'framing_error')
		expect(err[1]).toMatchObject({ inst: 'call', kind: 'lowFps' })
		expect(err[1]).not.toHaveProperty('infps')
	})
})

describe('FaceFrame: форма событий журнала', () => {
	test('framing_start и framing_stats', async () => {
		setRates(30, 30)
		start()
		await vi.advanceTimersByTimeAsync(11000)
		const get = (k) => calllog.mock.calls.find(([n]) => n === k)[1]
		expect(Object.keys(get('framing_start')).sort()).toEqual(['frozen', 'h', 'inst', 'oh', 'ow', 'sched', 'w'])
		expect(get('framing_start')).toMatchObject({ inst: 'call', sched: 'rvfc', frozen: false })
		const st = get('framing_stats')
		expect(Object.keys(st).sort()).toEqual(['cbfps', 'detavg', 'detp', 'drawfps', 'gapmax', 'hidden', 'infps', 'insrc', 'inst', 'outfps'])
		expect(st).toMatchObject({ inst: 'call', hidden: false })
		expect(st.infps).toBeGreaterThan(25)
	})
})

describe('FaceFrame: счётчики кадров, вечный ноль', () => {
	const zeroCounters = () => {
		vproto.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0 })
		// currentTime у MediaStream растёт и без кадров
		Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: () => performance.now() / 1000 })
	}
	afterEach(() => {
		delete window.HTMLMediaElement.prototype.currentTime
	})
	test('проба без rVFC, счётчик всегда 0, currentTime растёт, канвас рисует -> отката нет', async () => {
		zeroCounters()
		start()
		await vi.advanceTimersByTimeAsync(12000)
		expect(ff._digital.published).toBe(true)
		expect(ff.path).toBe('digital')
		expect(calllog.mock.calls.filter(([k]) => k === 'framing_error')).toHaveLength(0)
	})
	test('счётчик входа всегда 0, отрисовка 2 к/с -> сбой lowFps (порог прежний 15)', async () => {
		zeroCounters()
		const seen = new WeakSet() // первый колбэк элемента быстро, иначе таймер RVFC_WAIT_MS уведёт на rAF
		vproto.requestVideoFrameCallback = function(cb) {
			setTimeout(() => cb(performance.now(), {}), seen.has(this) ? 500 : 100)
			seen.add(this)
		}
		start()
		await vi.advanceTimersByTimeAsync(12000)
		expect(ff.path).toBe('frozen')
		expect(calllog.mock.calls.find(([k]) => k === 'framing_error')[1]).toMatchObject({ kind: 'lowFps' })
	})
})

describe('FaceFrame: ключи событий под серверный фильтр', () => {
	test('ключи /^[a-z]{1,12}$/, до 12 на событие, значения скалярные', async () => {
		setRates(30, 12) // даёт start, mode, stats, error (lowFps), mode frozen
		start()
		await vi.advanceTimersByTimeAsync(12000)
		const own = calllog.mock.calls.filter(([k]) => /^framing_(start|stats|error|mode)$/.test(k))
		expect(new Set(own.map(([k]) => k))).toEqual(new Set(['framing_start', 'framing_stats', 'framing_error', 'framing_mode']))
		for (const [, d] of own) {
			const keys = Object.keys(d)
			expect(keys.length).toBeLessThanOrEqual(12)
			for (const k of keys) {
				expect(k).toMatch(/^[a-z]{1,12}$/)
				expect(['string', 'number', 'boolean']).toContain(typeof d[k])
			}
		}
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

// Safari: totalVideoFrames исходного video стоит на 0, rVFC идёт с частотой экрана (screenHz), новый кадр входа — inFps раз в секунду
describe('FaceFrame: Safari, частота входа по rVFC', () => {
	const safari = (inFps, screenHz) => {
		vproto.getVideoPlaybackQuality = function() {
			return this.srcObject ? undefined : { totalVideoFrames: 0 }
		}
		vproto.requestVideoFrameCallback = (cb) => setTimeout(() => {
			const t = performance.now()
			cb(t, { presentedFrames: Math.floor(t / 1000 * inFps), mediaTime: Math.floor(t / 1000 * inFps) / inFps })
		}, 1000 / screenHz)
	}
	const stats = () => calllog.mock.calls.find(([n]) => n === 'framing_stats')[1]
	test('вход 30, экран 60 -> infps ~30, insrc=rvfc, отрисовок ~30 в секунду', async () => {
		safari(30, 60)
		start()
		await vi.advanceTimersByTimeAsync(11000)
		expect(stats().insrc).toBe('rvfc')
		expect(stats().infps).toBeGreaterThan(27)
		expect(stats().infps).toBeLessThan(33)
		expect(stats().drawfps).toBeLessThan(33)
		expect(stats().drawfps).toBeGreaterThan(25)
	})
	test('отрисовка 10 к/с при входе 30 -> lowFps', async () => {
		safari(30, 60)
		start()
		await vi.advanceTimersByTimeAsync(3000)
		ff._digital.fpsFrames = 0 // имитация: ниже — вход 30, рисуем лишь каждый третий новый кадр
		const orig = ff._renderFrame.bind(ff)
		let n = 0
		ff._renderFrame = (d, now) => (n++ % 3 ? undefined : orig(d, now))
		await vi.advanceTimersByTimeAsync(9000)
		expect(ff.path).toBe('frozen')
		expect(calllog.mock.calls.find(([k]) => k === 'framing_error')[1]).toMatchObject({ kind: 'lowFps' })
	})
	test('отрисовка 25 при входе 30 -> не сбой', async () => {
		safari(30, 25)
		start()
		await vi.advanceTimersByTimeAsync(9000)
		expect(ff.path).toBe('digital')
	})
	test('метаданные стоят, дорожка muted -> редкая перерисовка, без переключения', async () => {
		vproto.getVideoPlaybackQuality = () => undefined
		Object.defineProperty(vproto, 'paused', { configurable: true, get: () => false })
		vproto.requestVideoFrameCallback = (cb) => setTimeout(() => cb(performance.now(), { presentedFrames: 5, mediaTime: 1 }), 16)
		start().muted = true
		await vi.advanceTimersByTimeAsync(2000) // HOLD_MS без детектора
		const f0 = ff._digital.frames
		await vi.advanceTimersByTimeAsync(1000)
		const df = ff._digital.frames - f0
		expect(df).toBeGreaterThanOrEqual(3)
		expect(df).toBeLessThanOrEqual(5)
		expect(ff._digital.badSig).toBe(false)
	})
	test('метаданные стоят, дорожка live, колбэки 60 Гц -> за 1,5 с рисуем каждый колбэк, insrc не rvfc', async () => {
		vproto.getVideoPlaybackQuality = () => undefined
		Object.defineProperty(vproto, 'paused', { configurable: true, get: () => false })
		vproto.requestVideoFrameCallback = (cb) => setTimeout(() => cb(performance.now(), { presentedFrames: 5, mediaTime: 1 }), 1000 / 60)
		start()
		await vi.advanceTimersByTimeAsync(1500 + 1500) // HOLD_MS + 1,5 с
		expect(ff._digital.badSig).toBe(true)
		const f0 = ff._digital.frames
		await vi.advanceTimersByTimeAsync(1000)
		expect(ff._digital.frames - f0).toBeGreaterThan(50)
		await vi.advanceTimersByTimeAsync(8000)
		expect(stats().insrc).not.toBe('rvfc')
		expect(calllog.mock.calls.filter(([k, d]) => k === 'framing_mode' && /признак/.test(d.why))).toHaveLength(1)
	})
	// presentedFrames идёт со своей частотой pfHz, колбэки — cbHz, камера заявляет 30
	const pfRun = async (pfHz, cbHz, ms = 12000) => {
		vproto.getVideoPlaybackQuality = function() {
			return this.srcObject ? undefined : { totalVideoFrames: 0 }
		}
		vproto.requestVideoFrameCallback = (cb) => setTimeout(() => {
			const t = performance.now()
			cb(t, { presentedFrames: Math.floor(t / 1000 * pfHz), mediaTime: t / 1000 })
		}, 1000 / cbHz)
		start().getSettings = () => ({ frameRate: 30, width: 1920, height: 1080 })
		await vi.advanceTimersByTimeAsync(ms)
	}
	test.each([[60, 30], [60, 40], [30, 20]])('presentedFrames %i/с при колбэках %i/с -> нет сбоя (база: порог 15)', async (pf, cbHz) => {
		await pfRun(pf, cbHz)
		expect(ff.path).toBe('digital')
		expect(stats().infps).toBeLessThanOrEqual(30)
		expect(stats().cbfps).toBeGreaterThan(cbHz - 3)
	})
	test('колбэки 12/с при входе 30 -> сбой', async () => {
		await pfRun(30, 12)
		expect(ff.path).toBe('frozen')
	})
	test('пауза колбэков 2 с, затем нормальный поток -> badSig не ставится', async () => {
		let paused = true
		Object.defineProperty(vproto, 'paused', { configurable: true, get: () => false })
		vproto.getVideoPlaybackQuality = () => undefined
		vproto.requestVideoFrameCallback = (cb) => setTimeout(() => {
			const t = performance.now()
			cb(t, { presentedFrames: Math.floor(t / 1000 * 30), mediaTime: t / 1000 })
		}, paused ? 2000 : 33)
		start()
		await vi.advanceTimersByTimeAsync(2100)
		paused = false
		await vi.advanceTimersByTimeAsync(5000)
		expect(ff._digital.badSig).toBe(false)
	})
	test('ни счётчика, ни rVFC-метаданных -> frameRate из настроек дорожки', async () => {
		vproto.getVideoPlaybackQuality = () => undefined
		vproto.requestVideoFrameCallback = (cb) => setTimeout(() => cb(performance.now(), {}), 1000 / 30)
		const track = start()
		track.getSettings = () => ({ frameRate: 30, width: 1920, height: 1080 })
		ff._setInputTrack('default', { ...track, id: 'cam2', getSettings: track.getSettings })
		await vi.advanceTimersByTimeAsync(11000)
		expect(stats()).toMatchObject({ insrc: 'settings', infps: 30 })
	})
})

describe('FaceFrame: рабочее разрешение выхода (NAS_CLOUD#160)', () => {
	const draws = []
	const run = async (w, h) => {
		vw = w
		vh = h
		setRates(30, 30)
		start()
		window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: (...a) => draws.push(a), getImageData: () => ({ data: [255, 255, 255, 255] }) })
		ff._digital.ctx = window.HTMLCanvasElement.prototype.getContext()
		await vi.advanceTimersByTimeAsync(2500)
		return ff._digital.canvas
	}
	beforeEach(() => {
		draws.length = 0
	})

	test('вход 1080x1920 -> выход 720x720 (не 1080x1080), окно в координатах входа, в один drawImage', async () => {
		const c = await run(1080, 1920)
		expect([c.width, c.height]).toEqual([720, 720])
		const main = draws.filter((a) => a[5] === 0 && a[7] === 720)
		expect(main.length).toBeGreaterThan(0)
		// окно по центру кадра: квадрат 1080 со сдвигом по y (1920-1080)/2 = 420 — лицо в центре окна
		const [, sx, sy, sw, sh] = main[main.length - 1]
		expect([sx, sy, sw, sh]).toEqual([0, 420, 1080, 1080])
	})
	test('вход 1280x720 -> выход 720x720 как и раньше', async () => {
		const c = await run(1280, 720)
		expect([c.width, c.height]).toEqual([720, 720])
	})
	test('вход 640x480 -> 480x480 без изменений', async () => {
		const c = await run(640, 480)
		expect([c.width, c.height]).toEqual([480, 480])
	})
	test('нехватка мощности: сперва ступень (360, журнал framing_ease), потом остановка', async () => {
		vw = 1080
		vh = 1920
		setRates(30, 12)
		start()
		await vi.advanceTimersByTimeAsync(4500)
		expect(ff.path).toBe('digital')
		expect(ff._digital.canvas.width).toBe(360)
		expect(calllog.mock.calls.filter(([k]) => k === 'framing_ease')).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(5000)
		expect(ff.path).toBe('frozen')
	})
})
