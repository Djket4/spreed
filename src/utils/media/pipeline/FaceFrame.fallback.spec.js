/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// NAS_CLOUD#160: откат кадра по лицу — текст по причине, «Выкл» только до перезагрузки, камера не чёрная
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import FaceFrame, { FALLBACK_TEXT, getFaceFrameLevel, setFaceFrameLevel } from './FaceFrame.js'

const showWarning = vi.hoisted(() => vi.fn())
const wasm = vi.hoisted(() => ({ fileset: () => new Promise(() => {}) }))
vi.mock('@nextcloud/dialogs', () => ({ showWarning }))
vi.mock('@mediapipe/tasks-vision', () => ({}))
vi.mock('../effects/virtual-background/VideoStreamBackgroundEffect.js', () => ({ getWasmFileset: () => wasm.fileset() }))

const KEY = 'k4FaceFrameLevel'
const vproto = window.HTMLVideoElement.prototype
const saved = {}
let ff

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
	window.MediaStream = function(tracks = []) {
		this.getTracks = () => tracks
	}
	window.HTMLMediaElement.prototype.play = () => Promise.resolve()
	for (const k of ['videoWidth', 'readyState']) {
		saved[k] = Object.getOwnPropertyDescriptor(vproto, k)
	}
	Object.defineProperty(vproto, 'videoWidth', { configurable: true, get: () => 640 })
	Object.defineProperty(vproto, 'readyState', { configurable: true, get: () => 4 })
	vi.spyOn(console, 'error').mockImplementation(() => {})
	showWarning.mockClear()
	// выбор человека — «Авто», сохранён
	setFaceFrameLevel('off')
	setFaceFrameLevel('auto')
	expect(localStorage.getItem(KEY)).toBe('auto')
})

afterEach(() => {
	ff?.destroy()
	for (const [k, dsc] of Object.entries(saved)) {
		if (dsc) {
			Object.defineProperty(vproto, k, dsc)
		} else {
			delete vproto[k]
		}
	}
	vi.useRealTimers()
	vi.restoreAllMocks()
})

function start({ drawImage = () => {} } = {}) {
	const listeners = []
	const out = { stop() {}, addEventListener: (ev, fn) => ev === 'ended' && listeners.push(fn), removeEventListener() {} }
	window.HTMLCanvasElement.prototype.captureStream = () => ({ getVideoTracks: () => [out] })
	window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage, getImageData: () => ({ data: [255, 255, 255, 255] }) })
	ff = new FaceFrame()
	const track = { id: 'cam', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
	ff._setInputTrack('default', track)
	return { out, track, listeners }
}

function expectFallback(track, kind) {
	expect(ff.path).toBe('fallback')
	expect(ff.getOutputTrack()).toBe(track) // исходная камера, не чёрный канвас
	expect(getFaceFrameLevel()).toBe('off')
	expect(localStorage.getItem(KEY)).toBe('auto') // выбор человека не затёрт
	expect(showWarning).toHaveBeenCalledTimes(1)
	expect(showWarning).toHaveBeenCalledWith(FALLBACK_TEXT[kind])
}

describe('FaceFrame: откат', () => {
	// первым: общий детектор кешируется в модуле, отказ сбрасывает кеш
	// NAS_CLOUD#271: без детектора кадр не отдаёт сырую камеру — остаётся канвас с центральным кропом, без слежения
	test('детектор не загрузился -> канвас с кадром на месте, текст про распознаватель, выбор не тронут', async () => {
		wasm.fileset = () => Promise.reject(new Error('no WebGL'))
		const { out } = start()
		await vi.advanceTimersByTimeAsync(600)
		expect(ff.path).toBe('frozen')
		expect(ff.getOutputTrack()).toBe(out)
		expect(ff.window).toMatchObject({ cx: 0.5, cy: 0.5 })
		expect(getFaceFrameLevel()).toBe('auto')
		expect(showWarning).toHaveBeenCalledTimes(1)
		expect(showWarning).toHaveBeenCalledWith(FALLBACK_TEXT.detector)
		wasm.fileset = () => new Promise(() => {})
	})

	test('выходной трек кончился сам -> исходная камера, текст про сбой видео', async () => {
		const { out, track, listeners } = start()
		await vi.advanceTimersByTimeAsync(500)
		expect(ff.getOutputTrack()).toBe(out)
		listeners.forEach((fn) => fn())
		expectFallback(track, 'output')
	})

	test('отрисовка бросила исключение -> откат сразу, без ожидания сторожка', async () => {
		const { track } = start({
			drawImage() {
				throw new Error('InvalidStateError')
			},
		})
		await vi.advanceTimersByTimeAsync(1600) // NAS_CLOUD#271: первая отрисовка — после ожидания детекции
		expectFallback(track, 'error')
	})

	test('откат действует до перезагрузки: новый выбор человека снова включает и сохраняется', async () => {
		wasm.fileset = () => new Promise(() => {})
		const { track } = start({
			drawImage() {
				throw new Error('x')
			},
		})
		await vi.advanceTimersByTimeAsync(1600)
		expect(ff.getOutputTrack()).toBe(track)
		localStorage.removeItem(KEY)
		setFaceFrameLevel('auto')
		expect(localStorage.getItem(KEY)).toBe('auto')
	})

	test('тексты разные для каждой причины', () => {
		const texts = Object.values(FALLBACK_TEXT)
		expect(new Set(texts).size).toBe(texts.length)
		expect(FALLBACK_TEXT.lowFps).toMatch(/мощности/)
	})
})
