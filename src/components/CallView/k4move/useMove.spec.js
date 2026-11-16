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

import { appPost } from '../k4draw/macBridge.js'
import { ACCEPT_WAIT, headerLinkToOpen, isTrustedTake, JOIN_WAIT, moveHere, otherSessionsInCall, watchMove } from './useMove.js'

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

describe('перенос v2, исходная сторона (NAS_CLOUD#177)', () => {
	let unwatch
	beforeEach(() => {
		vi.useFakeTimers()
		h.inCall = true
		h.sent = []
		h.subs.clear()
		h.store.getters.isInCall = () => h.inCall
		h.store.dispatch = vi.fn(() => Promise.resolve())
		appPost.mockClear()
		unwatch = watchMove()
		vi.advanceTimersByTime(2000)
	})
	afterEach(() => {
		unwatch()
		vi.useRealTimers()
	})
	const flush = async () => {
		await Promise.resolve()
		await Promise.resolve()
	}
	it('offer → accept, joined → выход и moved', async () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		expect(ops('b')).toEqual(['accept'])
		expect(h.store.dispatch).not.toHaveBeenCalled()
		deliver({ op: 'joined', from: 'b', id: '1' })
		await flush()
		expect(h.store.dispatch).toHaveBeenCalledWith('leaveCall', expect.objectContaining({ token: 't', all: false }))
		expect(appPost).toHaveBeenCalledWith('moved')
	})
	it('старый take v1 и чужая сессия — игнор', async () => {
		h.subs.forEach((fn) => fn({ type: 'k4move', v: 1, op: 'take', from: 'b' }))
		deliver({ op: 'offer', from: 'stranger', id: '1' })
		deliver({ op: 'joined', from: 'stranger', id: '1' })
		await flush()
		expect(h.sent).toEqual([])
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
	it('joined не пришёл за JOIN_WAIT: cancel получателю; поздний joined — снова cancel, звонок остаётся здесь', async () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		vi.advanceTimersByTime(JOIN_WAIT + 1)
		expect(ops('b')).toEqual(['accept', 'cancel'])
		deliver({ op: 'joined', from: 'b', id: '1' })
		await flush()
		expect(ops('b')).toEqual(['accept', 'cancel', 'cancel'])
		expect(h.store.dispatch).not.toHaveBeenCalled()
		expect(appPost).not.toHaveBeenCalled()
	})
	it('второй перенос при активном первом: busy, его joined — cancel; выход один раз', async () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		deliver({ op: 'offer', from: 'c', id: '2' })
		expect(ops('c')).toEqual(['busy'])
		deliver({ op: 'joined', from: 'b', id: '1' })
		deliver({ op: 'joined', from: 'c', id: '2' })
		await flush()
		expect(ops('c')).toEqual(['busy', 'cancel'])
		expect(h.store.dispatch).toHaveBeenCalledTimes(1)
	})
	it('cancel от получателя освобождает перенос', () => {
		deliver({ op: 'offer', from: 'b', id: '1' })
		deliver({ op: 'cancel', from: 'b', id: '1' })
		deliver({ op: 'offer', from: 'c', id: '2' })
		expect(ops('c')).toEqual(['accept'])
	})
})

describe('перенос v2, принимающая сторона (NAS_CLOUD#177)', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		h.inCall = false
		h.sent = []
		h.subs.clear()
		h.store.getters.isInCall = () => h.inCall
		h.store.dispatch = vi.fn(() => {
			h.inCall = false
			return Promise.resolve()
		})
	})
	afterEach(() => vi.useRealTimers())
	const idOf = () => h.sent[0][2]
	it('входит только после accept; до входа ушёл лишь offer (никакого раннего take)', async () => {
		const join = vi.fn(async () => {
			expect(ops()).toEqual(['offer'])
			h.inCall = true
		})
		const r = moveHere(['a'], 't', join)
		await vi.advanceTimersByTimeAsync(100)
		expect(join).not.toHaveBeenCalled()
		deliver({ op: 'accept', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(0)
		expect(join).toHaveBeenCalled()
		expect(ops()).toEqual(['offer', 'joined'])
		await vi.advanceTimersByTimeAsync(10000)
		expect(await r).toBe('joined')
	})
	it('busy: не входит', async () => {
		const join = vi.fn()
		const r = moveHere(['a'], 't', join)
		deliver({ op: 'busy', from: 'a', id: idOf() })
		expect(await r).toBe('busy')
		expect(join).not.toHaveBeenCalled()
	})
	it('молчание (старая страница): после ACCEPT_WAIT входит как раньше', async () => {
		const join = vi.fn(async () => {
			h.inCall = true
		})
		moveHere(['a'], 't', join)
		await vi.advanceTimersByTimeAsync(ACCEPT_WAIT)
		expect(join).toHaveBeenCalled()
		expect(ops()).toEqual(['offer', 'joined'])
	})
	it('вход не удался: cancel, joined не уходит', async () => {
		const r = moveHere(['a'], 't', async () => {
			throw new Error('x')
		})
		deliver({ op: 'accept', from: 'a', id: idOf() })
		expect(await r).toBe('failed')
		expect(ops()).toEqual(['offer', 'cancel'])
	})
	it('cancel пришёл во время входа: выходит, joined не шлёт', async () => {
		const r = moveHere(['a'], 't', async () => {
			deliver({ op: 'cancel', from: 'a', id: idOf() })
			h.inCall = true
		})
		deliver({ op: 'accept', from: 'a', id: idOf() })
		expect(await r).toBe('cancelled')
		expect(ops()).toEqual(['offer'])
		expect(h.store.dispatch).toHaveBeenCalledWith('leaveCall', expect.anything())
	})
	it('cancel разминулся с joined: выходит', async () => {
		const r = moveHere(['a'], 't', async () => {
			h.inCall = true
		})
		deliver({ op: 'accept', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(0)
		expect(ops()).toEqual(['offer', 'joined'])
		deliver({ op: 'cancel', from: 'a', id: idOf() })
		expect(h.store.dispatch).toHaveBeenCalledWith('leaveCall', expect.anything())
		await vi.advanceTimersByTimeAsync(10000)
		expect(await r).toBe('cancelled')
	})
	it('cancel чужого переноса или от другой сессии — игнор', async () => {
		moveHere(['a'], 't', async () => {
			h.inCall = true
		})
		deliver({ op: 'accept', from: 'a', id: idOf() })
		await vi.advanceTimersByTimeAsync(0)
		deliver({ op: 'cancel', from: 'a', id: 'other' })
		deliver({ op: 'cancel', from: 'x', id: idOf() })
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
})
