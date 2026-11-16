/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#113): другая сессия того же пользователя и фильтр ссылок шапки
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	inCall: true,
	sent: [],
	onMsg: null,
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
		doSend: (m) => h.sent.push([m.message.recipient.sessionid, m.message.data.op]),
		on: (_e, fn) => {
			h.onMsg = fn
		},
		off: () => {},
	}),
}))

import { appPost } from '../k4draw/macBridge.js'
import { headerLinkToOpen, isTrustedTake, JOIN_WAIT, otherSessionsInCall, takeThenJoin, watchMove } from './useMove.js'

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

describe('перенос звонка: исходная выходит только после входа принимающей (NAS_CLOUD#177)', () => {
	let unwatch
	const msg = (op, from = 'b') => h.onMsg({ type: 'k4move', v: 1, op, from })
	beforeEach(() => {
		vi.useFakeTimers()
		h.inCall = true
		h.sent = []
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
	it('take без joined: остаётся в звонке, moved не уходит', async () => {
		msg('take')
		vi.advanceTimersByTime(JOIN_WAIT + 1)
		msg('joined') // запоздал — ожидание уже сброшено
		await Promise.resolve()
		expect(h.store.dispatch).not.toHaveBeenCalled()
		expect(appPost).not.toHaveBeenCalled()
	})
	it('joined без take или от другой сессии — игнор', async () => {
		msg('joined')
		msg('take', 'b')
		msg('joined', 'c')
		msg('joined', 'stranger')
		await Promise.resolve()
		expect(h.store.dispatch).not.toHaveBeenCalled()
	})
	it('take, затем joined той же сессии: выход и moved', async () => {
		msg('take')
		msg('joined')
		await Promise.resolve()
		await Promise.resolve()
		expect(h.store.dispatch).toHaveBeenCalledWith('leaveCall', expect.objectContaining({ token: 't', all: false }))
		expect(appPost).toHaveBeenCalledWith('moved')
	})
	it('принимающая: вход не удался — joined не уходит', async () => {
		h.inCall = false
		await takeThenJoin(['a'], 't', async () => {})
		await takeThenJoin(['a'], 't', async () => {
			throw new Error('x')
		})
		expect(h.sent).toEqual([['a', 'take'], ['a', 'take']])
	})
	it('принимающая: вошла — joined', async () => {
		await takeThenJoin(['a'], 't', async () => {})
		expect(h.sent).toEqual([['a', 'take'], ['a', 'joined']])
	})
})
