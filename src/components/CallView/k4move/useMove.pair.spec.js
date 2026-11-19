/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#177): перенос на паре вкладок — экземпляры модуля на общей шине сигналинга (10 мс)
// и общий сервер: список сессий в звонке (fetchPeers), которым управляет тест. Старая вкладка — фикстура с боевого 8bd62f6 (v1).
// Инвариант каждого сценария: моих сессий в звонке на сервере никогда не ноль.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOIN_WAIT, LATE_WAIT, MOVED_WATCH } from './useMove.js'

const bus = new Map()
const srv = { calls: new Set(), spans: [], open: null, t0: 0, allow: null, drop: () => false, delay: () => 20 }

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
/** Пустой звонок (ноль моих сессий) — фиксируем промежутки: начало и конец в мс от старта теста. */
function watchEmpty() {
	const t = Date.now() - srv.t0
	if (!srv.calls.size && !srv.open) {
		srv.open = { from: t }
	} else if (srv.calls.size && srv.open) {
		srv.spans.push({ ...srv.open, to: t })
		srv.open = null
	}
}
/**
 * Ноль сессий допустим только в явно названном окне: начало не раньше from, конец не позже to, суммарно не дольше max мс.
 *
 * @param {number} from мс от старта теста
 * @param {number} to мс от старта теста
 * @param {number} max допустимая длительность
 */
function allowEmpty(from, to, max) {
	srv.allow = { from, to, max }
}
async function run(ms) {
	for (let t = 0; t < ms; t += 5) {
		await vi.advanceTimersByTimeAsync(5)
		watchEmpty()
	}
}

describe('перенос на паре вкладок, истина у сервера (NAS_CLOUD#177)', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		bus.clear()
		srv.calls.clear()
		srv.spans = []
		srv.open = null
		srv.allow = null
		srv.t0 = Date.now()
		srv.drop = () => false
		srv.delay = () => 20
	})
	afterEach(() => {
		bus.forEach((p) => p.unwatch?.())
		watchEmpty()
		const spans = srv.open ? [...srv.spans, { ...srv.open, to: Date.now() - srv.t0 }] : srv.spans
		if (!srv.allow) {
			expect(spans).toEqual([]) // ноль сессий в звонке — никогда, кроме названных окон
		} else {
			spans.forEach((x) => expect([x.from >= srv.allow.from, x.to <= srv.allow.to]).toEqual([true, true]))
			expect(spans.reduce((n, x) => n + x.to - x.from, 0)).toBeLessThanOrEqual(srv.allow.max)
		}
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
		allowEmpty(4100, 4400, 200) // неустранимо: B закрылась во время выхода A — пусто ~120 мс (4150–4270) до возврата A; итог — одна
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
		allowEmpty(500, 5400, 5000) // B закрылась после выхода A: пусто до таймаута GET (5 с) и возврата A, не дольше; итог — одна
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
		allowEmpty(4100, 12700, 8600) // вернуться не удалось: пусто с выхода A (4,1 с) до нажатия «Войти» (~12,6 с), не дольше
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

	it('восстановительный join бросает reject (и синхронный throw): 3 попытки, плашка «Войти», по кнопке — в звонке', async () => {
		allowEmpty(4100, 12700, 8600)
		const a = await tab('a', './useMove.js', { inCall: true, leaveMs: 4000 })
		const b = await tab('b')
		let tries = 0
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(500)
		a.m.setJoiner(async () => {
			tries++
			throw new Error('join rejected')
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
	})

	it('join получателя упал: joined не шлётся, статус failed, звонок остаётся у A', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		const got = []
		a.subs.add((d) => got.push(d.op))
		b.join = async () => {
			throw new Error('join rejected')
		}
		const r = b.m.moveHere(['a'], 't', b.join)
		await run(JOIN_WAIT + 31000)
		expect(await r).toBe('failed')
		expect(got).toEqual(['offer'])
		expect(b.errors.join()).toMatch(/Не удалось войти/)
		expect(calls()).toEqual(['nc-a'])
		expect(a.posts).toEqual([])
	})

	it('очень поздний вход: B входит через 65+ с (после JOIN_WAIT+LATE_WAIT) — её joined будит A, лишняя сессия A убрана', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b', './useMove.js', { joinMs: JOIN_WAIT + LATE_WAIT + 5000 })
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(JOIN_WAIT + LATE_WAIT + 1000)
		expect(calls()).toEqual(['nc-a']) // наблюдение закончилось, B ещё не вошла
		await run(6000)
		expect(calls()).toEqual(['nc-b'])
		expect(a.posts).toEqual(['moved'])
	})

	it('B закрылась уже после moved: A предлагает вернуть звонок, по кнопке — в звонке', async () => {
		allowEmpty(1000, 6500, 5000) // после moved звонок идёт только у B; закрылась — пусто до нажатия «Вернуть сюда» (~3 с наблюдения), не дольше
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(2000)
		expect(calls()).toEqual(['nc-b'])
		expect(a.posts).toEqual(['moved'])
		expect(a.dialogs.map((d) => d.name)).not.toContain('Звонок остался без вас')
		b.close()
		await run(4000)
		expect(a.dialogs.map((d) => d.name)).toContain('Звонок остался без вас')
		a.dialogs.find((d) => d.name === 'Звонок остался без вас').buttons.find((x) => x.label === 'Вернуть сюда').callback()
		await run(1000)
		expect(calls()).toEqual(['nc-a'])
	})

	it('B не закрывалась после moved: предложения вернуться нет', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(MOVED_WATCH + 3000)
		expect(a.dialogs.map((d) => d.name)).not.toContain('Звонок остался без вас')
		expect(calls()).toEqual(['nc-b'])
	})

	it('цепочка A→B→C: другая сессия того же пользователя в звонке — диалога нет', async () => {
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(2000)
		expect(calls()).toEqual(['nc-b'])
		srv.calls.delete('nc-b') // B→C: B ушла, C (чужая вкладка того же пользователя) в звонке
		srv.calls.add('nc-c')
		await run(MOVED_WATCH + 3000)
		expect(a.dialogs.map((d) => d.name)).not.toContain('Звонок остался без вас')
		expect(calls()).toEqual(['nc-c'])
	})

	it('«Вернуть сюда»: пока диалог висел, сессия пользователя появилась — перепроверка, без входа', async () => {
		allowEmpty(1000, 6500, 5000)
		const a = await tab('a', './useMove.js', { inCall: true })
		const b = await tab('b')
		await b.m.moveGate('t', b.join)
		b.click('Перенести звонок сюда')
		await run(2000)
		b.close()
		await run(4000)
		expect(a.dialogs.map((d) => d.name)).toContain('Звонок остался без вас')
		srv.calls.add('nc-c')
		a.dialogs.find((d) => d.name === 'Звонок остался без вас').buttons.find((x) => x.label === 'Вернуть сюда').callback()
		await run(1000)
		expect(calls()).toEqual(['nc-c'])
		expect(a.infos).toContain('Звонок уже идёт в другой вкладке')
	})
})
