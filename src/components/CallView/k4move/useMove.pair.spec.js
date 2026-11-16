/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#177): перенос на паре вкладок — экземпляры модуля на общей шине сигналинга (10 мс)
// и общий сервер: список сессий в звонке (fetchPeers), которым управляет тест. Старая вкладка — фикстура с боевого 8bd62f6 (v1).
// Инвариант каждого сценария: моих сессий в звонке на сервере никогда не ноль.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOIN_WAIT } from './useMove.js'

const bus = new Map()
const srv = { calls: new Set(), min: Infinity, drop: () => false, delay: () => 20 }

/**
 * Вкладка: свой экземпляр useMove со своим store, диалогами и сигналингом.
 *
 * @param {string} sid сигнальная сессия; Nextcloud-сессия — 'nc-' + sid
 * @param {string} file модуль: новый или фикстура боевого
 * @param {object} o переопределения: inCall, leaveFail, leaveMs, joinMs
 */
async function tab(sid, file = './useMove.js', o = {}) {
	const p = { sid, nc: 'nc-' + sid, inCall: false, subs: new Set(), dialogs: [], infos: [], errors: [], posts: [], leaveFail: false, leaveMs: 50, joinMs: 100, ...o }
	bus.set(sid, p)
	if (p.inCall) {
		srv.calls.add(p.nc)
	}
	vi.resetModules()
	vi.doMock('../k4draw/macBridge.js', () => ({ appPost: (t) => p.posts.push(t) }))
	vi.doMock('@nextcloud/dialogs', () => ({
		showInfo: (t) => p.infos.push(t),
		showError: (t) => p.errors.push(t),
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
	vi.doMock('@nextcloud/axios', () => ({ default: { get: async () => ({ data: { ocs: { data: [{ attendeeId: 1, inCall: srv.calls.size ? 7 : 0 }] } } }) } }))
	vi.doMock('../../../services/callsService.ts', () => ({
		fetchPeers: () => {
			const data = [ // снимок на момент запроса; ответ приходит через srv.delay()
				...[...srv.calls].map((s) => ({ actorType: 'users', actorId: 'u', sessionId: s })),
				{ actorType: 'users', actorId: 'other', sessionId: 'nc-other' }, // чужой участник в звонке не считается
			]
			return new Promise((resolve) => setTimeout(() => resolve({ data: { ocs: { data } } }), srv.delay()))
		},
	}))
	vi.doMock('../../../store/index.js', () => ({
		default: {
			getters: { isInCall: () => p.inCall },
			// как настоящая цепочка: ошибка выхода проглатывается в callsService, store всё равно «не в звонке»
			dispatch: () => new Promise((resolve) => setTimeout(() => {
				p.leaveFail || srv.calls.delete(p.nc)
				p.inCall = false
				p.unwatch?.() // CallView размонтирован
				p.unwatch = null
				resolve()
			}, p.leaveMs)),
		},
	}))
	vi.doMock('../../../stores/actor.ts', () => ({ useActorStore: () => ({ actorType: 'users', actorId: 'u', sessionId: p.nc, participantIdentifier: { attendeeId: 1 } }) }))
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
				srv.drop(data) || setTimeout(() => to?.subs.forEach((fn) => fn(data)), 10)
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
		await new Promise((resolve) => setTimeout(resolve, p.joinMs))
		srv.calls.add(p.nc)
		p.inCall = true
		p.watch()
	}
	p.m.setJoiner(() => p.join())
	p.close = () => { // окно закрыто: сессия ушла с сервера
		srv.calls.delete(p.nc)
		p.inCall = false
		p.unwatch?.()
		p.unwatch = null
		bus.delete(p.sid)
	}
	if (p.inCall) {
		p.watch()
	}
	p.click = (label) => p.dialogs.flatMap((d) => d.buttons).find((b) => b.label === label).callback()
	return p
}

const OLD = './useMove.v1prod.fixture.js'
const calls = () => [...srv.calls].sort()
async function run(ms) {
	for (let t = 0; t < ms; t += 5) {
		await vi.advanceTimersByTimeAsync(5)
		srv.min = srv.min < 0 ? srv.min : Math.min(srv.min, srv.calls.size)
	}
}

describe('перенос на паре вкладок, истина у сервера (NAS_CLOUD#177)', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		bus.clear()
		srv.calls.clear()
		srv.min = Infinity
		srv.drop = () => false
		srv.delay = () => 20
	})
	afterEach(() => {
		bus.forEach((p) => p.unwatch?.())
		srv.min < 0 || expect(srv.min).toBeGreaterThan(0) // ноль сессий в звонке — никогда (кроме v1)
		vi.useRealTimers()
	})

	it('1. обычный перенос A→B и «Вернуть сюда» B→A: каждый раз ровно одна, moved после выхода по серверу', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		expect(await b.m.moveGate('t', b.join)).toBe(true)
		b.click('Перенести звонок сюда')
		await run(1500)
		expect(calls()).toEqual(['nc-b'])
		expect(a.posts).toEqual(['moved'])
		a.click('Вернуть сюда')
		await run(1500)
		expect(calls()).toEqual(['nc-a'])
		expect(b.posts).toEqual(['moved'])
		expect([...a.infos, ...b.infos, ...a.errors, ...b.errors]).toEqual([])
	})

	it('2. поздний вход: B входит через 35 с — A остаётся после срока, видит две сессии и добивает', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b', './useMove.js', { joinMs: JOIN_WAIT + 5000 })
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(JOIN_WAIT + 1000)
		expect(calls()).toEqual(['nc-a']) // срок вышел — звонок остался у A
		expect(a.posts).toEqual([])
		await run(5500)
		expect(calls()).toEqual(['nc-b'])
		expect(a.posts).toEqual(['moved'])
	})

	it('3. joined потерян в сигналинге: A всё равно видит B по серверу и выходит', async () => {
		srv.drop = (d) => d.op === 'joined'
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(2500)
		expect(calls()).toEqual(['nc-b'])
		expect(a.posts).toEqual(['moved'])
	})

	it('4. выход A не удался (ошибка проглочена, store «не в звонке»): сервер видит A — ошибка, moved и appPost нет, B не выходит', async () => {
		const a = await tab('a', './useMove.js', { inCall: true, leaveFail: true })
		const b = await tab('b')
		const moved = []
		b.subs.add((d) => d.op === 'moved' && moved.push(d))
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(2000)
		expect(calls()).toEqual(['nc-a', 'nc-b']) // две и видно: у A ошибка
		expect(a.errors.join()).toMatch(/Не удалось выйти/)
		expect(a.posts).toEqual([])
		expect(moved).toEqual([])
	})

	it('5. третья вкладка C во время 4-секундного выхода A — busy, перенос B доходит, в звонке одна', async () => {
		const a = await tab('a', './useMove.js', { inCall: true, leaveMs: 4000 })
		const b = await tab('b')
		const c = await tab('c')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(500)
		const rc = c.m.moveHere(['a'], 't', c.join)
		await run(6000)
		expect(await rc).toBe('busy')
		expect(calls()).toEqual(['nc-b'])
		expect(a.posts).toEqual(['moved'])
	})

	it('встречные переносы A→B и B→A одновременно: обе busy, в звонке A', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		b.unwatch = b.m.watchMove()
		const ra = a.m.moveHere(['b'], 't', a.join)
		const rb = b.m.moveHere(['a'], 't', b.join)
		await run(6000)
		expect(await ra).toBe('busy')
		expect(await rb).toBe('busy')
		expect(calls()).toEqual(['nc-a'])
	})

	it('B вошла, а сервер её не показывает: A остаётся в звонке, B не выходит сама', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		b.join = async () => {
			b.inCall = true // в store вошла, на сервере нет
		}
		b.m.setJoiner(() => b.join())
		const r = b.m.moveHere(['a'], 't', b.join)
		await run(JOIN_WAIT + 31000)
		expect(await r).toBe('joined')
		expect(calls()).toEqual(['nc-a'])
		expect(a.posts).toEqual([])
		expect(b.inCall).toBe(true)
	})

	it('старая принимающая (боевой 8bd62f6) → новая исходная: выходит после входа по серверу, окну moved', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b', OLD)
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(3000)
		expect(calls()).toEqual(['nc-b'])
		expect(a.posts).toEqual(['moved'])
	})

	it('новая принимающая → старая исходная (боевой 8bd62f6): не входит, «Обновите страницу», звонок остаётся там', async () => {
		await tab('a', OLD, { inCall: true })
		await run(2000) // старый слушатель ставится раз в 2 с
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(6000)
		expect(calls()).toEqual(['nc-a'])
		expect(b.infos.join()).toMatch(/Обновите страницу/)
	})

	it('B закрылась во время 4-секундного выхода A: A возвращается в звонок, moved и appPost нет', async () => {
		srv.min = -1 // ожидаемо и неустранимо: B закрылась сама во время выхода A — пусто ~0,1 с до возврата A; итог — одна
		const a = await tab('a', './useMove.js', { inCall: true, leaveMs: 4000 })
		const b = await tab('b')
		const moved = []
		b.subs.add((d) => d.op === 'moved' && moved.push(d))
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(500)
		b.close()
		await run(5000)
		expect(calls()).toEqual(['nc-a'])
		expect(a.posts).toEqual([])
		expect(moved).toEqual([])
		expect(a.infos.join()).toMatch(/Перенос не удался/)
	})

	it('зависший GET до выхода: ответ с B через 20 с после закрытия B отброшен по таймауту — A не выходит', async () => {
		srv.drop = (d) => d.op === 'joined' // только опрос
		let slow = false
		srv.delay = () => (srv.calls.has('nc-b') && !slow ? (slow = true, 20000) : 20)
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(2000)
		b.close()
		await run(21000)
		expect(calls()).toEqual(['nc-a'])
		expect(a.posts).toEqual([])
	})

	it('задержанный проверочный GET после выхода A: B закрылась, ответ через 20 с — таймаут, A возвращается, moved нет', async () => {
		srv.min = -1 // ожидаемо: B закрылась уже после выхода A — пусто до таймаута GET (5 с) и возврата A; итог — одна
		let slow = false
		srv.delay = () => (!srv.calls.has('nc-a') && srv.calls.has('nc-b') && !slow ? (slow = true, 20000) : 20)
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		const moved = []
		b.subs.add((d) => d.op === 'moved' && moved.push(d))
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(500)
		expect(calls()).toEqual(['nc-b']) // A вышла, проверочный GET висит
		b.close()
		await run(21000)
		expect(calls()).toEqual(['nc-a'])
		expect(a.posts).toEqual([])
		expect(moved).toEqual([])
	})

	it('восстановительный join падает: 3 попытки с проверкой по серверу, потом плашка «Войти»; по кнопке — в звонке', async () => {
		srv.min = -1 // ожидаемо: вернуться не удалось — пусто до нажатия «Войти»
		const a = await tab('a', './useMove.js', { inCall: true, leaveMs: 4000 })
		const b = await tab('b')
		let tries = 0
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(500)
		a.m.setJoiner(async () => {
			tries++ // вход не состоялся
		})
		b.close()
		await run(12000)
		expect(tries).toBe(3)
		expect(calls()).toEqual([])
		expect(a.dialogs.map((d) => d.name)).toContain('Не удалось вернуться в звонок')
		a.m.setJoiner(() => a.join())
		a.click('Войти')
		await run(500)
		expect(calls()).toEqual(['nc-a'])
		expect(a.posts).toEqual([])
	})

	it('старая принимающая (v1): вход упал — исходная не выходит, звонок не теряется', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b', OLD)
		b.join = async () => {} // вход не состоялся: на сервере B нет (боевой код ошибку не ловит, поэтому без throw)
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(JOIN_WAIT + 31000)
		expect(calls()).toEqual(['nc-a'])
		expect(a.posts).toEqual([])
	})
})
