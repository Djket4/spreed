/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('403'))) } }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u) => u }))
vi.mock('./calllog.js', () => ({ calllog: vi.fn() }))
vi.mock('../components/CallView/k4draw/useDrawing.js', () => ({ state: {} }))

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

	it('путь: relay сильнее srflx и host', () => {
		expect(sample(null, rep(1, { lt: 'host', rt: 'relay' })).path).toBe('relay')
		expect(sample(null, rep(1, { lt: 'host', rt: 'host' })).path).toBe('host')
	})
})

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
	const base = { loss: 0, rtt: 50, jit: 5, fps: 25, ab: 1, vb: 1 }

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

	it('обрыв, нет видео/звука, рывки, свой канал', () => {
		const flags = { conn: 'failed', videoAvailable: true, audioAvailable: true, own: 'red' }
		const r = run([{ ...base, ab: 0, vb: 0, fps: 5 }, { ...base, ab: 0, vb: 0, fps: 5 }], flags)
		expect(r[1].warn.map((x) => x.w).sort()).toEqual(['drop', 'fps', 'noaudio', 'novideo', 'own'])
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

	it('новый замер не стартует, пока идёт прошлый', async () => {
		const pc = { getStats: vi.fn(() => new Promise(() => {})) }
		const mdl = { get: (k) => (k === 'peerId' ? 'peerB' : k === 'peer' ? { pc } : undefined) }
		start([mdl])
		await vi.advanceTimersByTimeAsync(10000)
		expect(pc.getStats).toHaveBeenCalledTimes(1)
	})
})
