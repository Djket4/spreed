/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const user = vi.hoisted(() => ({ cur: { uid: 'u' } }))
vi.mock('@nextcloud/auth', () => ({ getCurrentUser: () => user.cur }))
vi.mock('@nextcloud/axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('403'))) } }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u) => u }))
vi.mock('./calllog.js', () => ({ calllog: vi.fn() }))
vi.mock('../components/CallView/k4draw/useDrawing.js', () => ({ state: {} }))

import axios from '@nextcloud/axios'
import { calllog } from './calllog.js'
import { classify, k4stats, sample, startK4stats, stopK4stats } from './k4stats.js'

function rep(ts, o = {}) {
	return new Map([
		['ia', { type: 'inbound-rtp', kind: 'audio', timestamp: ts, bytesReceived: o.ab ?? 0, packetsReceived: o.pa ?? 0, packetsLost: o.lost ?? 0, jitter: o.jitter ?? 0.01 }],
		['iv', { type: 'inbound-rtp', kind: 'video', timestamp: ts, bytesReceived: o.vb ?? 0, packetsReceived: o.pv ?? 0, packetsLost: 0, ...(o.fps === undefined ? {} : { framesPerSecond: o.fps }) }],
		['cp', { type: 'candidate-pair', nominated: true, state: 'succeeded', timestamp: ts, currentRoundTripTime: o.rtt, localCandidateId: 'l', remoteCandidateId: 'r' }],
		['l', { type: 'local-candidate', candidateType: o.lt ?? 'host', protocol: 'udp' }],
		['r', { type: 'remote-candidate', candidateType: o.rt ?? 'srflx' }],
	])
}

describe('sample', () => {
	it('Chrome: битрейт, потери, задержка, дрожание, fps, путь', () => {
		const s = sample(rep(0, { vb: 0, pa: 0 }), rep(3000, { ab: 30000, vb: 360000, pa: 90, lost: 10, rtt: 0.08, fps: 24 }))
		expect(s).toMatchObject({ kbps: 1040, loss: 10, rtt: 80, jit: 10, fps: 24, path: 'srflx', proto: 'udp' })
	})

	it('Safari: нет framesPerSecond и RTT -> null, не 0', () => {
		const s = sample(rep(0), rep(3000, { vb: 3000, pa: 10 }))
		expect(s.fps).toBeNull()
		expect(s.rtt).toBeNull()
	})

	it('первый замер без прошлого и сброс счётчиков дают null', () => {
		expect(sample(null, rep(3000, { vb: 5 })).kbps).toBeNull()
		const s = sample(rep(0, { vb: 9000, pa: 100 }), rep(3000, { vb: 10, pa: 5 }))
		expect(s.kbps).toBeNull()
		expect(s.loss).toBeNull()
	})

	it('out: верхний активный слой simulcast и число слоёв (NAS_CLOUD#375)', () => {
		const L = (w, h, fps) => ({ type: 'outbound-rtp', kind: 'video', timestamp: 1, bytesSent: 1, frameWidth: w, frameHeight: h, framesPerSecond: fps })
		const r = new Map([['q', L(480, 270, 30)], ['h', L(1920, 1080, 30)], ['m', L(960, 540, 30)], ['off', L(0, 0, 0)]])
		expect(sample(null, r, 'out').out).toBe('1920x1080@30 ×3')
		expect(sample(null, rep(1), 'out').out).toBeNull()
		// отключённый слой и слой без кадров/с в out не попадают
		const off = new Map([['a', { ...L(1920, 1080, 30), active: false }], ['b', L(1280, 720, undefined)]])
		expect(sample(null, off, 'out').out).toBeNull()
	})

	it('путь: relay сильнее srflx и host', () => {
		expect(sample(null, rep(1, { lt: 'host', rt: 'relay' })).path).toBe('relay')
		expect(sample(null, rep(1, { lt: 'host', rt: 'host' })).path).toBe('host')
	})
})

const base = { loss: 0, rtt: 50, jit: 5, fps: 25, ab: 1, vb: 1 }

describe('classify', () => {
	const run = (samples, flags) => {
		let st = null
		const all = []
		for (const s of samples) {
			const r = classify(st, s, flags)
			st = r.state
			all.push(r)
		}
		return all
	}

	it('включается после 2 замеров подряд, один раз на вход', () => {
		const r = run([{ ...base, loss: 6 }, { ...base, loss: 6 }, { ...base, loss: 7 }], {})
		expect(r.map((x) => x.changes.length)).toEqual([0, 1, 0])
		expect(r[2].warn).toEqual([{ w: 'loss', lvl: 'yellow' }])
	})

	it('один плохой замер между хорошими не включает', () => {
		expect(run([{ ...base, loss: 20 }, base, { ...base, loss: 20 }], {}).every((x) => !x.warn.length)).toBe(true)
	})

	it('гаснет после 3 хороших', () => {
		const bad = { ...base, rtt: 900 }
		const r = run([bad, bad, base, base, base], {})
		expect(r[1].warn).toEqual([{ w: 'rtt', lvl: 'red' }])
		expect(r[3].warn).toHaveLength(1)
		expect(r[4].warn).toHaveLength(0)
		expect(r[4].changes).toEqual([{ w: 'rtt', lvl: 'red', on: 0 }])
	})

	it('обрыв, нет видео/звука, рывки, свой канал, поток встал', () => {
		const flags = { conn: 'failed', videoAvailable: true, audioAvailable: true, own: 'red' }
		const r = run([{ ...base, ab: 0, vb: 0, fps: 5 }, { ...base, ab: 0, vb: 0, fps: 5 }], flags)
		expect(r[1].warn.map((x) => x.w).sort()).toEqual(['drop', 'fps', 'noaudio', 'novideo', 'own', 'stall'])
	})

	it('stall (NAS_CLOUD#183): встали все включённые потоки; заблокированное видео и выключенное не считаются; гаснет с первым байтом', () => {
		const zero = { ...base, ab: 0, vb: 0 }
		const r = run([zero, zero, base], { audioAvailable: true, videoAvailable: true })
		expect(r[1].warn.map((x) => x.w)).toContain('stall')
		expect(r[2].warn.map((x) => x.w)).not.toContain('stall')
		const onlyAudio = { ...base, vb: 0 }
		expect(run([onlyAudio, onlyAudio], { audioAvailable: true, videoAvailable: true, videoBlocked: true })[1].warn.map((x) => x.w)).not.toContain('stall')
		expect(run([zero, zero], { audioAvailable: false, videoAvailable: false })[1].warn.map((x) => x.w)).not.toContain('stall')
	})

	it('Safari (null) не даёт предупреждений', () => {
		const n = { kbps: null, loss: null, rtt: null, jit: null, fps: null, ab: null, vb: null }
		expect(run([n, n, n], { videoAvailable: true }).every((x) => !x.warn.length)).toBe(true)
	})
})

describe('рантайм', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => {
		stopK4stats()
		vi.useRealTimers()
		calllog.mockClear()
	})

	it('rtc_stats раз в 15 с, rtc_path один раз, ключи a-z до 12, по пиру в k4stats', async () => {
		let n = 0
		const pc = {
			getStats: vi.fn(async () => {
				n++
				return rep(n * 3000, { vb: n * 30000, pa: n * 10, rtt: 0.05, fps: 20 })
			}),
		}
		const mdl = { get: (k) => ({ peerId: 'peer1234567', peer: { pc }, connectionState: 'connected', videoAvailable: true, audioAvailable: false })[k] }
		const on = () => {}
		startK4stats({ token: 't', local: { get: () => undefined }, collection: { callParticipantModels: [mdl] }, localMedia: { on, off: on } })
		await vi.advanceTimersByTimeAsync(14000)
		expect(calllog.mock.calls.filter((c) => c[0] === 'rtc_stats')).toHaveLength(0)
		await vi.advanceTimersByTimeAsync(1500)
		expect(calllog.mock.calls.filter((c) => c[0] === 'rtc_stats')).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(15000)
		expect(calllog.mock.calls.filter((c) => c[0] === 'rtc_stats')).toHaveLength(2)
		expect(calllog.mock.calls.filter((c) => c[0] === 'rtc_path')).toHaveLength(1)
		expect(k4stats.peers.peer1234567.kbps).toBe(80)
		for (const [, d] of calllog.mock.calls) {
			for (const k of Object.keys(d || {})) {
				expect(k).toMatch(/^[a-z]{1,12}$/)
			}
		}
		expect(Object.keys(calllog.mock.calls.find((c) => c[0] === 'rtc_stats')[1]).length).toBeLessThanOrEqual(12)
		stopK4stats()
		expect(k4stats.peers).toEqual({})
	})

	function start(models = [], local = { get: () => undefined }) {
		const h = {}
		const localMedia = { on: (e, f) => Object.assign(h, { [e]: f }), off: () => {} }
		startK4stats({ token: 't', local, collection: { callParticipantModels: models }, localMedia })
		return h
	}

	it('media: on берётся вторым аргументом (первый — модель)', () => {
		const h = start()
		h['change:audioEnabled']({}, true)
		h['change:videoEnabled']({}, false)
		expect(calllog).toHaveBeenCalledWith('media', { kind: 'a', on: 1, by: 'self' })
		expect(calllog).toHaveBeenCalledWith('media', { kind: 'v', on: 0, by: 'self' })
	})

	it('media: выключение ведущим не даёт второго события by=self', async () => {
		const h = start()
		k4stats.hostMute = Date.now()
		h['change:audioEnabled']({}, false)
		expect(calllog).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1100)
		h['change:audioEnabled']({}, false)
		expect(calllog).toHaveBeenCalledWith('media', { kind: 'a', on: 0, by: 'self' })
	})

	it('обрыв по connectionState виден без peer и при падении getStats; запись живёт при пересоздании', async () => {
		const model = { peer: null, connectionState: 'failed' }
		const mdl = { get: (k) => (k === 'peerId' ? 'peerAAAAAAA' : model[k]) }
		const coll = [mdl]
		start(coll)
		await vi.advanceTimersByTimeAsync(6500)
		expect(k4stats.peers.peerAAAAAAA.warn).toEqual([{ w: 'drop', lvl: 'red' }])
		expect(calllog).toHaveBeenCalledWith('rtc_warn', { peer: 'peerAA', w: 'drop', lvl: 'red', on: 1 })
		coll.length = 0 // модель на миг пропала
		await vi.advanceTimersByTimeAsync(3100)
		expect(k4stats.peers.peerAAAAAAA).toBeDefined()
		await vi.advanceTimersByTimeAsync(9000)
		expect(k4stats.peers.peerAAAAAAA).toBeUndefined()
	})

	it('новый замер не стартует, пока идёт прошлый; после таймаута 5 с сбор продолжается', async () => {
		const pc = { getStats: vi.fn(() => new Promise(() => {})) }
		const mdl = { get: (k) => (k === 'peerId' ? 'peerB' : k === 'peer' ? { pc } : undefined) }
		start([mdl])
		await vi.advanceTimersByTimeAsync(7500)
		expect(pc.getStats).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(2500)
		expect(pc.getStats).toHaveBeenCalledTimes(2)
	})

	it('пустой замер не гасит предупреждение', () => {
		const bad = { ...base, loss: 20 }
		const empty = { kbps: null, loss: null, rtt: null, jit: null, fps: null, ab: null, vb: null }
		let st = classify(classify(null, bad, {}).state, bad, {}).state
		for (let i = 0; i < 5; i++) {
			const r = classify(st, empty, {})
			st = r.state
			expect(r.warn).toEqual([{ w: 'loss', lvl: 'red' }])
		}
	})

	it('feed: гость (нет текущего пользователя) пробу не делает, вошедший делает', () => {
		axios.get.mockClear()
		user.cur = null
		start()
		expect(axios.get).not.toHaveBeenCalled()
		expect(k4stats.testmode).toBe(false)
		stopK4stats()
		user.cur = { uid: 'u' }
		start()
		expect(axios.get).toHaveBeenCalledTimes(1)
	})

	describe('NAS_CLOUD#160', () => {
		const outRep = (n, o = {}) => new Map([
			['o', { type: 'outbound-rtp', kind: 'video', timestamp: n * 3000, bytesSent: o.vb ?? n * 30000, packetsSent: n, frameWidth: 1280, frameHeight: 720, framesPerSecond: o.fps ?? 25, qualityLimitationReason: 'cpu' }],
		])
		function startLocal({ videoEnabled = true, zero = true } = {}) {
			let n = 0
			const track = { kind: 'video', readyState: 'live', muted: false, enabled: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
			const pc = { iceConnectionState: 'connected', connectionState: 'connected', addEventListener: vi.fn(), removeEventListener: vi.fn(), getStats: vi.fn(async () => {
				n++
				return outRep(n, { vb: zero ? 0 : n * 30000 })
			}) }
			const local = { get: (k) => (k === 'peer' ? { pc } : k === 'connectionState' ? 'connected' : undefined) }
			const localMedia = { on() {}, off() {}, attributes: { videoEnabled, localStream: { getTracks: () => [track], getVideoTracks: () => [track] } } }
			startK4stats({ token: 't', local, collection: { callParticipantModels: [] }, localMedia })
			return { track, pc }
		}
		const ev = (k) => calllog.mock.calls.filter((c) => c[0] === k)

		it('lag: макс. отклонение шага за интервал, сбрасывается после rtc_health', async () => {
			startLocal({ zero: false })
			await vi.advanceTimersByTimeAsync(5000)
			vi.setSystemTime(Date.now() + 700) // шаг стал ~1700
			await vi.advanceTimersByTimeAsync(10500)
			const h = ev('rtc_health')
			expect(h).toHaveLength(1)
			expect(h[0][1].lag).toBe(700)
			expect(h[0][1]).toMatchObject({ qlim: 'cpu', encfps: 25, hidden: 0 })
			await vi.advanceTimersByTimeAsync(15000)
			expect(ev('rtc_health')[1][1].lag).toBe(0)
		})

		it('send_zero: при нуле и включённой камере раз в интервал; при выключенной нет', async () => {
			startLocal()
			await vi.advanceTimersByTimeAsync(31000)
			const z = ev('send_zero')
			expect(z.length).toBeGreaterThanOrEqual(2)
			expect(z.length).toBeLessThanOrEqual(3)
			expect(z[0][1]).toEqual({ qlim: 'cpu', lag: 0, trk: 'live', muted: 0, enabled: 1, ice: 'connected', conn: 'connected', hidden: 0 })
			stopK4stats()
			calllog.mockClear()
			startLocal({ videoEnabled: false })
			await vi.advanceTimersByTimeAsync(31000)
			expect(ev('send_zero')).toHaveLength(0)
		})

		it('stall: шаг > 3000 мс; track_state и pc_state подписаны; ключи новых событий валидны', async () => {
			const { track, pc } = startLocal({ zero: false })
			await vi.advanceTimersByTimeAsync(2000)
			vi.setSystemTime(Date.now() + 4000)
			await vi.advanceTimersByTimeAsync(1000)
			expect(ev('stall')[0][1]).toEqual({ ms: 5000, hidden: 0 })
			const fire = (m, name) => m.mock.calls.find((c) => c[0] === name)[1]()
			fire(track.addEventListener, 'mute')
			fire(pc.addEventListener, 'connectionstatechange')
			expect(ev('track_state')[0][1]).toEqual({ kind: 'video', st: 'mute' })
			expect(ev('pc_state')[0][1]).toEqual({ ice: 'connected', conn: 'connected' })
			document.dispatchEvent(new Event('freeze'))
			expect(ev('page_state')[0][1]).toEqual({ st: 'freeze' })
			await vi.advanceTimersByTimeAsync(15000)
			for (const k of ['rtc_health', 'stall', 'track_state', 'pc_state', 'page_state']) {
				for (const [, d] of ev(k)) {
					expect(Object.keys(d).length).toBeLessThanOrEqual(12)
					Object.keys(d).forEach((x) => {
						expect(x).toMatch(/^[a-z]{1,12}$/)
						expect(['ev', 'room', 't', 'dt', 'sess', 'ty']).not.toContain(x) // их выбрасывает parse_client на сервере
					})
				}
			}
		})
	})
})
