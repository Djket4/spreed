/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#113): другая сессия того же пользователя и фильтр ссылок шапки
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	inCall: true,
	sent: [],
	subs: new Set(),
	store: { getters: {}, dispatch: null },
}))
vi.mock('../k4draw/macBridge.js', () => ({ appPost: vi.fn() }))
const dialog = {
	setText: () => dialog,
	setButtons: () => dialog,
	build: () => ({ show: () => {} }),
}
vi.mock('@nextcloud/dialogs', () => ({ getDialogBuilder: () => dialog, showInfo: vi.fn() }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (u) => '/index.php' + u }))
vi.mock('../../../store/index.js', () => ({ default: h.store }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: () => ({ actorType: 'users', participantIdentifier: { attendeeId: 1 } }) }))
vi.mock('../../../stores/session.ts', () => ({ useSessionStore: () => ({ getSession: (sid) => ({ token: 't', attendeeId: sid === 'stranger' ? 2 : 1 }) }) }))
vi.mock('../../../stores/token.ts', () => ({ useTokenStore: () => ({ token: 't' }) }))
vi.mock('../../../utils/webrtc/index.js', () => ({
	k4drawSignaling: () => ({
		doSend: (m) => h.sent.push([m.message.recipient.sessionid, m.message.data.op, m.message.data.id]),
		on: (_e, fn) => h.subs.add(fn),
		off: (_e, fn) => h.subs.delete(fn),
	}),
}))

import { showInfo } from '@nextcloud/dialogs'
import { appPost } from '../k4draw/macBridge.js'
import { ACCEPT_WAIT, headerLinkToOpen, isTrustedTake, JOIN_WAIT, LATE_CANCEL, leaveOnce, moveHere, otherSessionsInCall, watchMove } from './useMove.js'

describe('другая сессия в звонке', () => {
	const S = [
		{ token: 't', attendeeId: 1, signalingSessionId: 'me', inCall: 0 },
		{ token: 't', attendeeId: 1, signalingSessionId: 'old', inCall: 7 },
		{ token: 't', attendeeId: 1, signalingSessionId: 'idle', inCall: 0 },
		{ token: 't', attendeeId: 2, signalingSessionId: 'other', inCall: 7 },
		{ token: 'x', attendeeId: 1, signalingSessionId: 'room2', inCall: 7 },
	]
	it('находит только свою, в этой комнате, в звонке', () => {
		expect(otherSessionsInCall(S, 't', 1, 'me')).toEqual(['old'])
		expect(otherSessionsInCall(S, 't', 3, 'me')).toEqual([])
		expect(otherSessionsInCall(S, 't', 1, 'me', true)).toEqual(['old', 'idle']) // сервер сказал «в звонке» — все мои другие сессии
	})
	it('take доверяем только от своей сессии и не гостю', () => {
		expect(isTrustedTake(S[1], 1, 'users', 't')).toBe(true)
		expect(isTrustedTake(S[3], 1, 'users', 't')).toBe(false)
		expect(isTrustedTake(S[1], 1, 'guests', 't')).toBe(false)
		expect(isTrustedTake(undefined, 1, 'users', 't')).toBe(false)
	})
})

describe('ссылки шапки', () => {
	const mk = (href, extra = {}) => {
		document.body.innerHTML = `<div id="header"><a id="a" href="${href}"><span id="s">x</span></a></div>`
		return { button: 0, target: document.getElementById('s'), ...extra }
	}
	const O = 'https://h.test'
	const here = '/index.php/call/abc'
	const app = '/index.php/apps/spreed'
	it('другое приложение — в новую вкладку', () => {
		expect(headerLinkToOpen(mk('/index.php/apps/files/'), O, here, app)).toBe(O + '/index.php/apps/files/')
		expect(headerLinkToOpen(mk('https://ext.test/'), O, here, app)).toBe('https://ext.test/')
	})
	it('не трогает приложение звонков, якорь, ctrl, среднюю кнопку', () => {
		expect(headerLinkToOpen(mk('/index.php/apps/spreed/'), O, here, app)).toBeNull()
		expect(headerLinkToOpen(mk('#x'), O, here, app)).toBeNull()
		expect(headerLinkToOpen(mk('/index.php/apps/files/', { ctrlKey: true }), O, here, app)).toBeNull()
		expect(headerLinkToOpen(mk('/index.php/apps/files/', { button: 1 }), O, here, app)).toBeNull()
	})
})

const deliver = (d) => [...h.subs].forEach((fn) => fn({ type: 'k4move', v: 2, ...d }))
const ops = (sid) => h.sent.filter(([s]) => !sid || s === sid).map(([, op]) => op)
function reset(inCall, leaveMs = 0) {
	vi.useFakeTimers()
	h.inCall = inCall
	h.sent = []
	h.subs.clear()
	h.store.getters.isInCall = () => h.inCall
	h.store.dispatch = vi.fn(() => new Promise((resolve) => setTimeout(() => {
		h.inCall = false
		resolve()
	}, leaveMs)))
	appPost.mockClear()
	showInfo.mockClear()
}

describe('перенос v2, исходная сторона (NAS_CLOUD#177)', () => {
	let unwatch
	beforeEach(() => {
		reset(true, 4000) // выход A идёт 4 с
		unwatch = watchMove()
		vi.advanceTimersByTime(2000)
	})
	afterEach(() => {
		unwatch()
		vi.useRealTimers()
	})
	it('offer → accept, joined → один выход, после него moved получателю и окну', async () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		expect(ops('b')).toEqual(['accept'])
		deliver({ op: 'joined', from: 'b', id: '1' })
		deliver({ op: 'joined', from: 'b', id: '1' })
		await vi.advanceTimersByTimeAsync(3999)
		expect(ops('b')).toEqual(['accept'])
		await vi.advanceTimersByTimeAsync(1)
		expect(ops('b')).toEqual(['accept', 'moved'])
		expect(h.store.dispatch).toHaveBeenCalledTimes(1)
		expect(appPost).toHaveBeenCalledWith('moved')
	})
	it('смешанные версии: v1 take от старой страницы — без реакции; чужая сессия — игнор', async () => {
		h.subs.forEach((fn) => fn({ type: 'k4move', v: 1, op: 'take', from: 'b' }))
		h.subs.forEach((fn) => fn({ type: 'k4move', op: 'take', from: 'b' }))
		deliver({ op: 'offer', from: 'stranger', id: '1' })
		deliver({ op: 'joined', from: 'stranger', id: '1' })
		await vi.advanceTimersByTimeAsync(5000)
		expect(h.sent).toEqual([])
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
	it('joined не пришёл за JOIN_WAIT: cancel получателю; поздний joined — снова cancel, звонок остаётся здесь', async () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		vi.advanceTimersByTime(JOIN_WAIT + 1)
		expect(ops('b')).toEqual(['accept', 'cancel'])
		deliver({ op: 'joined', from: 'b', id: '1' })
		await vi.advanceTimersByTimeAsync(5000)
		expect(ops('b')).toEqual(['accept', 'cancel', 'cancel'])
		expect(h.store.dispatch).not.toHaveBeenCalled()
		expect(appPost).not.toHaveBeenCalled()
	})
	it('C.offer при активном переносе B — busy, его joined — cancel', async () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		deliver({ op: 'offer', from: 'c', id: '2' })
		deliver({ op: 'joined', from: 'c', id: '2' })
		expect(ops('c')).toEqual(['busy', 'cancel'])
	})
	it('C.offer во время 4-секундного выхода A — busy; выход один', async () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		deliver({ op: 'joined', from: 'b', id: '1' })
		await vi.advanceTimersByTimeAsync(2000)
		h.inCall = false // звонок уже гаснет, выход ещё идёт
		deliver({ op: 'offer', from: 'c', id: '2' })
		deliver({ op: 'cancel', from: 'b', id: '1' }) // отмена во время выхода не снимает moving
		deliver({ op: 'offer', from: 'c', id: '3' })
		expect(ops('c')).toEqual(['busy', 'busy'])
		await vi.advanceTimersByTimeAsync(2000)
		expect(h.store.dispatch).toHaveBeenCalledTimes(1)
		expect(ops('b')).toEqual(['accept', 'moved'])
	})
	it('двойная отмена от получателя: перенос снят, следующий offer принят', () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		deliver({ op: 'cancel', from: 'b', id: '1' })
		deliver({ op: 'cancel', from: 'b', id: '1' })
		deliver({ op: 'offer', from: 'c', id: '2' })
		expect(ops('c')).toEqual(['accept'])
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
})

describe('перенос v2, принимающая сторона (NAS_CLOUD#177)', () => {
	beforeEach(() => reset(false))
	afterEach(() => vi.useRealTimers())
	const idOf = () => h.sent[0][2]
	const joinOk = () => vi.fn(async () => {
		h.inCall = true
	})
	it('входит только после accept; до входа ушёл лишь offer; moved от A — готово', async () => {
		const join = vi.fn(async () => {
			expect(ops()).toEqual(['offer'])
			h.inCall = true
		})
		const r = moveHere(['a'], 't', join)
		await vi.advanceTimersByTimeAsync(100)
		expect(join).not.toHaveBeenCalled()
		deliver({ op: 'accept', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(0)
		expect(ops()).toEqual(['offer', 'joined'])
		deliver({ op: 'moved', from: 'a', id: idOf() })
		expect(await r).toBe('joined')
		deliver({ op: 'cancel', from: 'a', id: h.sent[0][2] }) // после moved — уже не слушаем
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
	it('busy: не входит', async () => {
		const join = vi.fn()
		const r = moveHere(['a'], 't', join)
		deliver({ op: 'busy', from: 'a', id: idOf() })
		expect(await r).toBe('busy')
		expect(join).not.toHaveBeenCalled()
	})
	it('смешанные версии: старая исходная молчит на v2 — не входит, отмена и «Обновите страницу»', async () => {
		const join = joinOk()
		const r = moveHere(['a'], 't', join)
		await vi.advanceTimersByTimeAsync(ACCEPT_WAIT)
		expect(await r).toBe('stale')
		expect(join).not.toHaveBeenCalled()
		expect(ops()).toEqual(['offer', 'cancel'])
		expect(showInfo.mock.calls[0][0]).toMatch(/Обновите страницу/)
		deliver({ op: 'accept', from: 'a', id: idOf() }) // опоздавший accept — уже ничего
		await vi.advanceTimersByTimeAsync(0)
		expect(join).not.toHaveBeenCalled()
	})
	it('вход не удался: cancel, joined не уходит', async () => {
		const r = moveHere(['a'], 't', async () => {
			throw new Error('x')
		})
		deliver({ op: 'accept', from: 'a', id: idOf() })
		expect(await r).toBe('failed')
		expect(ops()).toEqual(['offer', 'cancel'])
	})
	it('cancel во время входа: один выход, joined не шлёт', async () => {
		const r = moveHere(['a'], 't', async () => {
			deliver({ op: 'cancel', from: 'a', id: idOf() })
			h.inCall = true
		})
		deliver({ op: 'accept', from: 'a', id: idOf() })
		const out = r
		await vi.advanceTimersByTimeAsync(0)
		expect(await out).toBe('cancelled')
		expect(ops()).toEqual(['offer'])
		expect(h.store.dispatch).toHaveBeenCalledTimes(1)
	})
	it('задержанный joined + cancel и двойная отмена: выходит сам, выход один', async () => {
		h.store.dispatch = vi.fn(() => new Promise((resolve) => setTimeout(() => {
			h.inCall = false
			resolve()
		}, 4000)))
		const r = moveHere(['a'], 't', joinOk())
		deliver({ op: 'accept', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(0)
		expect(ops()).toEqual(['offer', 'joined'])
		deliver({ op: 'cancel', from: 'a', id: idOf() })
		deliver({ op: 'cancel', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(4000)
		expect(await r).toBe('cancelled')
		expect(h.store.dispatch).toHaveBeenCalledTimes(1)
		expect(showInfo).toHaveBeenCalledTimes(1)
	})
	it('слушает cancel до таймаута исходной + LATE_CANCEL, не дольше', async () => {
		const r = moveHere(['a'], 't', joinOk())
		deliver({ op: 'accept', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(JOIN_WAIT + LATE_CANCEL - 1)
		let done = false
		r.then(() => {
			done = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(done).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect(await r).toBe('joined')
		deliver({ op: 'cancel', from: 'a', id: idOf() })
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
	it('cancel чужого переноса или от другой сессии — игнор', async () => {
		moveHere(['a'], 't', joinOk())
		deliver({ op: 'accept', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(0)
		deliver({ op: 'cancel', from: 'a', id: 'other' })
		deliver({ op: 'cancel', from: 'x', id: idOf() })
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
	it('leaveOnce: параллельные вызовы ждут один выход', async () => {
		h.inCall = true
		const p1 = leaveOnce('t')
		const p2 = leaveOnce('t')
		expect(p1).toBe(p2)
		await vi.advanceTimersByTimeAsync(0)
		await p1
		await leaveOnce('t')
		expect(h.store.dispatch).toHaveBeenCalledTimes(1)
	})
})
