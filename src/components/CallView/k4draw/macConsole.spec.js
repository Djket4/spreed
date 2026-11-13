/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const H = vi.hoisted(() => ({ models: [], L: null }))
const mkTrack = () => {
	const t = { readyState: 'live', stopped: false, getSettings: () => ({ width: 640, height: 480 }), stop: () => { t.stopped = true }, clone: () => Object.assign(mkTrack(), { getSettings: t.getSettings }) }
	return t
}
const track = mkTrack()
const stream = { getVideoTracks: () => [track] }
vi.mock('../../../store/index.js', () => ({ default: { getters: { isInCall: () => true }, dispatch: vi.fn() } }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: () => ({}) }))
vi.mock('../../../utils/webrtc/index.js', () => ({
	callParticipantCollection: { callParticipantModels: H.models },
	localMediaModel: { attributes: { token: 't', audioEnabled: true, videoEnabled: true, localStream: stream } },
}))

describe('macConsole: кадры камер для приложения', () => {
	let mod
	let draw
	let enc
	beforeEach(async () => {
		vi.resetModules()
		draw = vi.fn()
		enc = vi.fn(() => 'data:image/jpeg;base64,AAAA' + enc.mock.calls.length)
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw })
		vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(enc)
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
		Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
		Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
		mod = await import('./macConsole.js')
	})

	it('старое приложение (tick без v): свежий кадр на каждый tick', () => {
		const send = vi.fn()
		mod.consoleTick(send)
		mod.consoleTick(send)
		expect(enc).toHaveBeenCalledTimes(2)
		expect(send.mock.calls[0][0].tiles[0].jpg).not.toBe(send.mock.calls[1][0].tiles[0].jpg)
	})

	it('приложение v2: tick отдаёт прошлый кадр, кодирует только fr', () => {
		const send = vi.fn()
		mod.consoleTick(send, true) // первого кадра ещё нет: кодируется
		mod.consoleTick(send, true)
		mod.consoleTick(send, true)
		expect(enc).toHaveBeenCalledTimes(1)
		expect(send.mock.calls[2][0].tiles[0].jpg).toBe(send.mock.calls[0][0].tiles[0].jpg)
		mod.consoleFrame(send)
		expect(enc).toHaveBeenCalledTimes(2)
		expect(send.mock.calls[3][0].t).toBe('call')
	})

	it('приложение v2: кадр квадратный 128×128, вырез по центру', () => {
		mod.consoleTick(vi.fn(), true)
		const cv = enc.mock.contexts[0]
		expect([cv.width, cv.height]).toEqual([128, 128])
		expect(draw.mock.calls[0].slice(1)).toEqual([280, 0, 720, 720, 0, 0, 128, 128])
		expect(mod.cropWindow(720, 1280)).toEqual([0, 280, 720, 720])
	})

	it('старое приложение (tick без v): кадр 160×90 cover, не квадрат', () => {
		mod.consoleTick(vi.fn())
		const cv = enc.mock.contexts[0]
		expect([cv.width, cv.height]).toEqual([160, 90])
		expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 160, 90])
	})

	// send тратит 20 мс «времени»: бюджет не даёт ответить на следующий fr сразу
	const slow = () => vi.fn(() => vi.advanceTimersByTime(20))

	it('fr слишком рано: ответ откладывается и уходит по таймеру', () => {
		vi.useFakeTimers()
		const send = slow()
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		expect(send).toHaveBeenCalledTimes(1)
		vi.advanceTimersByTime(500)
		expect(send).toHaveBeenCalledTimes(2)
		vi.useRealTimers()
	})

	it('повторные fr объединяются в один отложенный ответ', () => {
		vi.useFakeTimers()
		const send = slow()
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		vi.advanceTimersByTime(500)
		expect(send).toHaveBeenCalledTimes(2)
		vi.useRealTimers()
	})

	it('stopConsole снимает отложенный ответ', () => {
		vi.useFakeTimers()
		const send = slow()
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		mod.stopConsole()
		vi.advanceTimersByTime(500)
		expect(send).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})
})

describe('macConsole: видео v3 (WebRTC)', () => {
	let mod
	let pcs
	let send
	let gate
	let swapFail
	const sent = (k) => send.mock.calls.map((c) => c[0]).filter((m) => m.t === 'rtc' && k in m)
	const lastCall = () => send.mock.calls.map((c) => c[0]).filter((m) => m.t === 'call').at(-1)
	const flush = () => new Promise((r) => setTimeout(r, 0))
	const remote = (id, on = true) => {
		const m = { attributes: { peerId: id, name: id, videoAvailable: on, audioAvailable: true, stream: null } }
		m.set = (t) => { m.attributes.stream = { getVideoTracks: () => [t] } }
		m.set(mkTrack())
		return m
	}
	const answer = async () => {
		await mod.consoleRtc({ sdp: { type: 'answer', sdp: 'a' } })
		await flush()
	}
	const tick = async (rtc = 1) => {
		mod.consoleTick(send, true, rtc)
		await flush()
	}
	beforeEach(async () => {
		vi.resetModules()
		H.models.length = 0
		pcs = []
		gate = null
		swapFail = false
		send = vi.fn()
		class PC {
			constructor() {
				this.trs = []
				this.signalingState = 'stable'
				this.connectionState = 'new'
				this.closed = false
				pcs.push(this)
			}
			addTransceiver(t, o) {
				const tr = { mid: null, track: t, o, stopped: false, stop() { tr.stopped = true }, sender: { pars: { encodings: [{ ...o.sendEncodings[0] }] }, getParameters() { return this.pars }, setParameters: vi.fn(async function (p) { this.pars = p }), replaceTrack: vi.fn(async () => { if (swapFail) { throw new Error('x') } }) } }
				this.trs.push(tr)
				return tr
			}
			async createOffer() { return { type: 'offer', sdp: 'o' } }
			async setLocalDescription(d) {
				if (gate) {
					await gate
				}
				this.signalingState = 'have-local-offer'
				this.trs.forEach((t, i) => { t.mid ??= String(i) })
				this.localDescription = { toJSON: () => ({ type: 'offer', sdp: 'o' + this.trs.length }) }
			}
			async setRemoteDescription() { this.signalingState = 'stable' }
			async addIceCandidate() {}
			close() { this.closed = true }
		}
		vi.stubGlobal('RTCPeerConnection', PC)
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
		vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA')
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
		Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
		Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
		mod = await import('./macConsole.js')
	})

	it('v3, rtc:1, своя камера: клон, параметры 240/30/300k, offer, vid после offer', async () => {
		await tick()
		expect(pcs).toHaveLength(1)
		const tr = pcs[0].trs[0]
		expect(tr.track).not.toBe(track) // клон
		expect(tr.o.direction).toBe('sendonly')
		expect(tr.o.sendEncodings[0]).toMatchObject({ scaleResolutionDownBy: 2, maxFramerate: 30, maxBitrate: 300000, priority: 'low', active: true })
		expect(sent('sdp')).toHaveLength(1)
		expect(lastCall().tiles[0].vid).toBeUndefined() // offer ещё не ушёл: vid только после него
		await tick()
		expect(lastCall().tiles[0]).toMatchObject({ vid: '0', jpg: 'AAAA' }) // пока не connected: и vid, и jpg
		pcs[0].connectionState = 'connected'
		await answer()
		await tick()
		expect(lastCall().tiles[0]).toMatchObject({ vid: '0', jpg: null })
	})

	it('rtc:0 и tick без rtc: соединения нет, jpg как в v2', async () => {
		await tick(0)
		mod.consoleTick(send, true, null)
		mod.consoleTick(send)
		expect(pcs).toHaveLength(0)
		expect(lastCall().tiles[0].vid).toBeUndefined()
	})

	it('участник пришёл и ушёл: перегласование, клон остановлен', async () => {
		await tick()
		await answer()
		H.models.push(remote('p1'))
		await tick()
		expect(pcs[0].trs).toHaveLength(2)
		expect(sent('sdp')).toHaveLength(2)
		await answer()
		const clone = pcs[0].trs[1].track
		H.models.length = 0
		await tick()
		expect(pcs[0].trs[1].stopped).toBe(true)
		expect(clone.stopped).toBe(true)
		expect(sent('sdp')).toHaveLength(3)
	})

	it('изменение во время обмена: второй offer только после answer', async () => {
		await tick()
		H.models.push(remote('p1'))
		await tick()
		expect(sent('sdp')).toHaveLength(1)
		await answer()
		expect(sent('sdp')).toHaveLength(2)
	})

	it('камеры не осталось: bye, соединение закрыто, клоны остановлены; дальше v2', async () => {
		await tick()
		await answer()
		const clone = pcs[0].trs[0].track
		H.models.length = 0
		// своя камера выключена
		const { localMediaModel } = await import('../../../utils/webrtc/index.js')
		localMediaModel.attributes.videoEnabled = false
		await tick()
		expect(sent('bye')).toHaveLength(1)
		expect(pcs[0].closed).toBe(true)
		expect(clone.stopped).toBe(true)
		expect(lastCall().tiles[0].vid).toBeUndefined()
		localMediaModel.attributes.videoEnabled = true
	})

	it('pause / resume: active=false у всех отправителей и обратно', async () => {
		await tick()
		await answer()
		H.models.push(remote('p1'))
		await tick()
		await answer()
		await mod.consoleRtc({ pause: 1 })
		expect(pcs[0].trs.map((t) => t.sender.pars.encodings[0].active)).toEqual([false, false])
		await mod.consoleRtc({ resume: 1 })
		expect(pcs[0].trs.map((t) => t.sender.pars.encodings[0].active)).toEqual([true, true])
	})

	it('bye от приложения: закрыть, остановить клоны, ничего не слать в ответ, v2', async () => {
		await tick()
		await answer()
		const clone = pcs[0].trs[0].track
		await mod.consoleRtc({ bye: 1 })
		expect(pcs[0].closed).toBe(true)
		expect(clone.stopped).toBe(true)
		expect(sent('bye')).toHaveLength(0)
		await tick() // пауза 2 с: заново не предлагаем
		expect(pcs).toHaveLength(1)
		expect(lastCall().tiles[0]).toMatchObject({ jpg: 'AAAA' })
	})

	it('rtc:0 после сбоя: закрыть без bye', async () => {
		await tick()
		await answer()
		await tick(0)
		expect(pcs[0].closed).toBe(true)
		expect(sent('bye')).toHaveLength(0)
	})

	it('сбой соединения (failed): bye приложению', async () => {
		await tick()
		pcs[0].connectionState = 'failed'
		pcs[0].onconnectionstatechange()
		expect(sent('bye')).toHaveLength(1)
		expect(pcs[0].closed).toBe(true)
	})

	it('не больше 6 дорожек', async () => {
		for (let i = 0; i < 7; i++) {
			H.models.push(remote('p' + i))
		}
		await tick()
		expect(pcs[0].trs).toHaveLength(6)
		await tick()
		const tiles = lastCall().tiles
		expect(tiles.filter((t) => t.vid !== undefined)).toHaveLength(6)
		expect(tiles[7].jpg).toBe('AAAA')
	})

	it('конец звонка (stopConsole): закрыть, остановить клоны', async () => {
		await tick()
		const clone = pcs[0].trs[0].track
		mod.stopConsole()
		expect(pcs[0].closed).toBe(true)
		expect(clone.stopped).toBe(true)
	})

	it('tick с новой дорожкой, пока offer в работе: второй offer только после answer', async () => {
		let open
		gate = new Promise((r) => { open = r })
		await tick()
		H.models.push(remote('p1'))
		await tick() // setLocalDescription ещё не завершился, signalingState = stable
		await tick()
		expect(sent('sdp')).toHaveLength(0)
		open()
		await flush()
		expect(sent('sdp')).toHaveLength(1)
		gate = null
		await answer()
		expect(sent('sdp')).toHaveLength(2)
		expect(sent('bye')).toHaveLength(0)
		expect(pcs).toHaveLength(1)
		expect(pcs[0].trs).toHaveLength(2)
	})

	describe('паузы после собственного bye', () => {
		beforeEach(() => vi.useFakeTimers())
		afterEach(() => vi.useRealTimers())
		const ftick = async () => {
			mod.consoleTick(send, true, 1)
			await vi.advanceTimersByTimeAsync(0)
		}

		it('сбой соединения: 30 с новых соединений нет, потом снова', async () => {
			await ftick()
			pcs[0].connectionState = 'failed'
			pcs[0].onconnectionstatechange()
			expect(sent('bye')).toHaveLength(1)
			await vi.advanceTimersByTimeAsync(200)
			await ftick()
			await vi.advanceTimersByTimeAsync(29000)
			await ftick()
			expect(pcs).toHaveLength(1)
			await vi.advanceTimersByTimeAsync(1500)
			await ftick()
			expect(pcs).toHaveLength(2)
		})

		it('10 с без connected после offer: закрыть, bye, пауза 30 с', async () => {
			await ftick()
			expect(sent('sdp')).toHaveLength(1)
			await vi.advanceTimersByTimeAsync(9000)
			expect(pcs[0].closed).toBe(false)
			await vi.advanceTimersByTimeAsync(1500)
			expect(pcs[0].closed).toBe(true)
			expect(sent('bye')).toHaveLength(1)
			await ftick()
			expect(pcs).toHaveLength(1)
		})

		it('connected вовремя: таймаут установки не срабатывает', async () => {
			await ftick()
			pcs[0].connectionState = 'connected'
			pcs[0].onconnectionstatechange()
			await vi.advanceTimersByTimeAsync(20000)
			expect(pcs[0].closed).toBe(false)
		})

		it('ошибка обмена offer/answer: bye и пауза', async () => {
			await ftick()
			pcs[0].setRemoteDescription = async () => { throw new Error('bad') }
			await mod.consoleRtc({ sdp: { type: 'answer', sdp: 'a' } })
			expect(sent('bye')).toHaveLength(1)
			await ftick()
			expect(pcs).toHaveLength(1)
		})
	})

	it('камера участника сменилась: тот же отправитель, масштаб пересчитан', async () => {
		const m = remote('p1')
		H.models.push(m)
		await tick()
		await answer()
		const tr = pcs[0].trs[1]
		const t2 = mkTrack()
		t2.getSettings = () => ({ width: 1280, height: 720 })
		m.set(t2)
		await tick()
		expect(tr.sender.replaceTrack).toHaveBeenCalledTimes(1)
		expect(tr.sender.pars.encodings[0].scaleResolutionDownBy).toBe(3)
		expect(pcs[0].trs).toHaveLength(2)
	})

	it('replaceTrack отказал: transceiver пересоздаётся, новый offer', async () => {
		const m = remote('p1')
		H.models.push(m)
		await tick()
		await answer()
		swapFail = true
		m.set(mkTrack())
		await tick() // replaceTrack отказал: transceiver убран, dirty
		expect(pcs[0].trs[1].stopped).toBe(true)
		swapFail = false
		await tick() // новый transceiver, offer
		expect(pcs[0].trs).toHaveLength(3)
		expect(sent('sdp')).toHaveLength(2) // первый offer с обеими дорожками и новый после отказа
	})
})
