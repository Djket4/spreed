/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#177): перенос на паре вкладок — два экземпляра модуля на общей шине сигналинга (задержка 10 мс).
// Старая вкладка — фикстура с боевого 8bd62f6 (перенос v1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bus = new Map()

/**
 * Вкладка: свой экземпляр useMove со своим store, диалогами и сигналингом.
 *
 * @param {string} sid сессия
 * @param {string} file модуль: новый или фикстура боевого
 * @param {object} o переопределения: inCall, leaveFail
 */
async function tab(sid, file = './useMove.js', o = {}) {
	const p = { sid, inCall: false, subs: new Set(), dialogs: [], infos: [], posts: [], leaveFail: false, ...o }
	bus.set(sid, p)
	vi.resetModules()
	vi.doMock('../k4draw/macBridge.js', () => ({ appPost: (t) => p.posts.push(t) }))
	vi.doMock('@nextcloud/dialogs', () => ({
		showInfo: (t) => p.infos.push(t),
		getDialogBuilder: (name) => {
			const d = { name }
			const b = {
				setText: () => b,
				setButtons: (x) => {
					d.buttons = x
					return b
				},
				build: () => ({ show: () => p.dialogs.push(d) }),
			}
			return b
		},
	}))
	vi.doMock('@nextcloud/router', () => ({ generateUrl: (u) => u, generateOcsUrl: (u) => u }))
	vi.doMock('@nextcloud/axios', () => ({ default: { get: async () => ({ data: { ocs: { data: [{ attendeeId: 1, inCall: [...bus.values()].some((x) => x.inCall) ? 7 : 0 }] } } }) } }))
	vi.doMock('../../../store/index.js', () => ({
		default: {
			getters: { isInCall: () => p.inCall },
			dispatch: () => new Promise((resolve, reject) => setTimeout(() => {
				if (p.leaveFail) {
					reject(new Error('leave'))
					return
				}
				p.inCall = false
				p.unwatch?.() // CallView размонтирован
				p.unwatch = null
				resolve()
			}, 50)),
		},
	}))
	vi.doMock('../../../stores/actor.ts', () => ({ useActorStore: () => ({ actorType: 'users', participantIdentifier: { attendeeId: 1 } }) }))
	vi.doMock('../../../stores/session.ts', () => ({
		useSessionStore: () => ({
			sessions: Object.fromEntries([...bus.keys()].map((s) => [s, { token: 't', attendeeId: 1, signalingSessionId: s, inCall: 0 }])),
			getSession: () => ({ token: 't', attendeeId: 1 }),
		}),
	}))
	vi.doMock('../../../stores/token.ts', () => ({ useTokenStore: () => ({ token: 't' }) }))
	vi.doMock('../../../utils/webrtc/index.js', () => ({
		k4drawSignaling: () => ({
			doSend: (m) => {
				const to = bus.get(m.message.recipient.sessionid)
				const data = { ...m.message.data, from: p.sid }
				setTimeout(() => to?.subs.forEach((fn) => fn(data)), 10)
			},
			on: (_e, fn) => p.subs.add(fn),
			off: (_e, fn) => p.subs.delete(fn),
			getSessionId: () => p.sid,
		}),
	}))
	p.m = await import(file)
	p.watch = () => {
		p.unwatch ||= p.m.watchMove() // CallView смонтирован
	}
	p.join = async () => {
		await new Promise((resolve) => setTimeout(resolve, 100))
		p.inCall = true
		p.watch()
	}
	p.m.setJoiner(() => p.join())
	if (p.inCall) {
		p.watch()
	}
	p.click = (label) => p.dialogs.flatMap((d) => d.buttons).find((b) => b.label === label).callback()
	return p
}

const OLD = './useMove.v1prod.fixture.js'
const inCall = () => [...bus.values()].filter((p) => p.inCall).map((p) => p.sid)

describe('перенос на паре вкладок (NAS_CLOUD#177)', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		bus.clear()
	})
	afterEach(() => {
		bus.forEach((p) => p.unwatch?.())
		vi.useRealTimers()
	})

	it('обычный перенос A→B и «Вернуть сюда» через 100 мс: слушатель новой исходной уже стоит', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		expect(await b.m.moveGate('t', b.join)).toBe(true)
		b.click('Перенести звонок сюда')
		await vi.advanceTimersByTimeAsync(400)
		expect(inCall()).toEqual(['b'])
		expect(a.posts).toEqual(['moved'])
		await vi.advanceTimersByTimeAsync(100)
		a.click('Вернуть сюда')
		await vi.advanceTimersByTimeAsync(1000)
		expect(inCall()).toEqual(['a'])
		expect(a.infos).toEqual([])
	})

	it('старая принимающая (боевой 8bd62f6) → новая исходная: исходная выходит, как раньше, окну moved', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b', OLD)
		expect(await b.m.moveGate('t', b.join)).toBe(true)
		b.click('Перенести звонок сюда')
		await vi.advanceTimersByTimeAsync(3000)
		expect(inCall()).toEqual(['b'])
		expect(a.posts).toEqual(['moved'])
	})

	it('новая принимающая → старая исходная (боевой 8bd62f6): не входит, «Обновите страницу», звонок остаётся там', async () => {
		await tab('a', OLD, { inCall: true })
		await vi.advanceTimersByTimeAsync(2000) // старый слушатель ставится раз в 2 с
		const b = await tab('b')
		expect(await b.m.moveGate('t', b.join)).toBe(true)
		b.click('Перенести звонок сюда')
		await vi.advanceTimersByTimeAsync(6000)
		expect(inCall()).toEqual(['a'])
		expect(b.infos.join()).toMatch(/Обновите страницу/)
	})

	it('встречные переносы A→B и B→A одновременно: обе получают busy, в звонке ровно одна', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		b.unwatch = b.m.watchMove()
		const ra = a.m.moveHere(['b'], 't', a.join)
		const rb = b.m.moveHere(['a'], 't', b.join)
		await vi.advanceTimersByTimeAsync(6000)
		expect(await ra).toBe('busy')
		expect(await rb).toBe('busy')
		expect(inCall()).toEqual(['a'])
	})

	it('выход исходной не удался: failed, получатель выходит сам, в звонке одна, moved нет', async () => {
		const a = await tab('a', './useMove.js', { inCall: true, leaveFail: true })
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await vi.advanceTimersByTimeAsync(1000)
		expect(inCall()).toEqual(['a'])
		expect(a.posts).toEqual([])
	})
})
